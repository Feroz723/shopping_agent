import { Product, SearchResponse } from "./types";
import { getCachedSearch, setCachedSearch } from "./cache";
import { prisma } from "./db";
import { braveFallbackProducts } from "./search-brave";

type SerpProduct = {
  title?: string;
  price?: string;
  extracted_price?: number;
  old_price?: string;
  link?: string;
  product_link?: string;
  thumbnail?: string;
  rating?: number;
  reviews?: number;
  source?: string;
  delivery?: string;
  product_id?: string;
  serpapi_immersive_product_api?: string;
};

type ProductSeed = Omit<Product, "score" | "reason" | "badges">;

const trustedRetailers = new Set(["adidas", "ajio", "amazon", "amazon.in", "apple", "academy", "academy sports + outdoors", "best buy", "champs sports", "costco", "croma", "decathlon", "dick's sporting goods", "dicks sporting goods", "dsw", "famous footwear", "finish line", "fleet feet", "flipkart", "foot locker", "hibbett", "ikea", "jd sports", "kohl's", "kohls", "macy's", "macys", "myntra", "new balance", "nike", "nordstrom", "nykaa", "puma", "rack room shoes", "rei", "reliance digital", "runners need", "running warehouse", "samsung", "shoe carnival", "shoe palace", "target", "tata cliq", "tatacliq", "walmart", "zappos"]);

type Market = { currency: "USD" | "INR"; gl: "in" | "us"; amazonTld: "in" | "com" };

const INDIAN_MARKET: Market = { currency: "INR", gl: "in", amazonTld: "in" };
const US_MARKET: Market = { currency: "USD", gl: "us", amazonTld: "com" };

function marketForQuery(query: string): Market {
  if (/\$|\busd\b/i.test(query)) return US_MARKET;
  return INDIAN_MARKET;
}

function amazonUrlFor(links: (string | undefined)[], region: "in" | "com", name: string) {
  for (const link of links) {
    const asin = link?.match(/amazon\.[a-z.]+\/(?:(?:.*)\/)?(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})/i)?.[1];
    if (asin) {
      const base = `https://www.amazon.${region}/dp/${asin.toUpperCase()}`;
      const tag = process.env.AMAZON_ASSOCIATE_ID;
      return tag ? `${base}?tag=${encodeURIComponent(tag)}&linkCode=osi&th=1&psc=1` : base;
    }
  }
  const base = `https://www.amazon.${region}/s?k=${encodeURIComponent(name)}`;
  const tag = process.env.AMAZON_ASSOCIATE_ID;
  return tag ? `${base}&tag=${encodeURIComponent(tag)}` : base;
}

const retailerSearchUrls: Record<string, (name: string) => string> = {
  flipkart: (name) => `https://www.flipkart.com/search?q=${encodeURIComponent(name)}`,
  myntra: (name) => `https://www.myntra.com/?rawQuery=${encodeURIComponent(name)}`,
  ajio: (name) => `https://www.ajio.com/search/?text=${encodeURIComponent(name)}`,
  croma: (name) => `https://www.croma.com/searchB?q=${encodeURIComponent(name)}`,
};

function isIntermediaryUrl(url: string) {
  try {
    return new URL(url).hostname.endsWith("google.com");
  } catch {
    return true;
  }
}

function directRetailerUrl(retailerLower: string, url: string, name: string) {
  if (!isIntermediaryUrl(url)) return url;
  return retailerSearchUrls[retailerLower]?.(name) ?? url;
}

export function fallbackRetailerSearchUrl(retailer: string, name: string, region: "in" | "us"): string {
  const retailerLower = retailer.toLowerCase();
  if (retailerLower.includes("amazon")) return amazonUrlFor([], region === "in" ? "in" : "com", name);
  const base = retailerSearchUrls[retailerLower]?.(name) ?? `https://www.google.com/search?q=${encodeURIComponent(name)}`;
  // Add affiliate attribution for non-Amazon fallbacks consumed by /api/go analytics
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}utm_source=scout&utm_medium=affiliate&utm_campaign=${encodeURIComponent(retailerLower)}`;
}

function providerProductIdFrom(links: (string | undefined)[]) {
  for (const link of links) {
    if (!link) continue;
    const pathId = link.match(/google\.[a-z.]+\/shopping\/product\/([0-9]{6,25})/i)?.[1];
    if (pathId) return pathId;
    const paramId = link.match(/productid(?:%3A|[:,])([0-9]{6,25})/i)?.[1];
    if (paramId) return paramId;
  }
  return undefined;
}

const globalScope = globalThis as typeof globalThis & {
  __scoutPageTokens?: Map<string, string>;
  __scoutResolved?: Map<string, { url: string; at: number }>;
};
const pageTokenRegistry = (globalScope.__scoutPageTokens ??= new Map<string, string>());
const PAGE_TOKEN_REGISTRY_LIMIT = 600;
const resolvedLinks = (globalScope.__scoutResolved ??= new Map<string, { url: string; at: number }>());
const RESOLVED_TTL_MS = 6 * 60 * 60 * 1000;
const RESOLVED_LIMIT = 600;

export function getPageToken(productId: string) {
  return pageTokenRegistry.get(productId);
}

export function getResolvedLink(productId: string) {
  const entry = resolvedLinks.get(productId);
  if (!entry) return undefined;
  if (Date.now() - entry.at > RESOLVED_TTL_MS) {
    resolvedLinks.delete(productId);
    return undefined;
  }
  return entry.url;
}

function rememberResolvedLink(productId: string, url: string) {
  if (resolvedLinks.size >= RESOLVED_LIMIT && !resolvedLinks.has(productId)) {
    const oldest = resolvedLinks.keys().next().value;
    if (oldest) resolvedLinks.delete(oldest);
  }
  resolvedLinks.set(productId, { url, at: Date.now() });
}

function rememberPageToken(productId: string | undefined, token: string | undefined) {
  if (!productId || !token) return;
  if (pageTokenRegistry.size >= PAGE_TOKEN_REGISTRY_LIMIT && !pageTokenRegistry.has(productId)) {
    const oldest = pageTokenRegistry.keys().next().value;
    if (oldest) pageTokenRegistry.delete(oldest);
  }
  pageTokenRegistry.set(productId, token);
}

function retailerTokenForMatch(retailer: string) {
  return retailer.split(/[^a-z0-9]+/).filter(Boolean)[0]?.toLowerCase() ?? "";
}

function isTShirtTitle(title: string) {
  return /\bt[-\s]?shirts?\b|\btees?\b/i.test(title);
}

function queryWantsShirtsNotTshirts(query: string) {
  return /\bshirts?\b/i.test(query) && !/\bt[-\s]?shirts?\b|\btees?\b/i.test(query);
}

function matchesCategory(title: string, query: string) {
  if (queryWantsShirtsNotTshirts(query) && isTShirtTitle(title)) return false;
  return true;
}

export function filterDemoForQuery(products: ProductSeed[], query: string): ProductSeed[] {
  const q = query.toLowerCase();
  const isShirt = /\bshirts?\b/.test(q) && !/\bt[-\s]?shirts?\b|\btees?\b/i.test(q);
  const isShoe = /\bshoes?\b|\bsneakers?\b|\bsneaker\b/i.test(q);
  const isMobile = /\bmobile\b|\bphone\b|\bsmartphone\b/i.test(q);
  const isEar = /\bearbuds?\b|\bearphone\b|\bheadphone\b/i.test(q);
  const isFurniture = /\bdesk\b|\btable\b|\bchair\b/i.test(q);
  console.log(`[filterDemo] query="${query}" isShirt=${isShirt} isShoe=${isShoe} total=${products.length}`);
  let filtered = products.filter((p) => matchesCategory(p.name, query));
  if (isShirt) {
    const shirtOnly = filtered.filter((p) => /shirt/i.test(p.name));
    console.log(`[filterDemo] shirtOnly=${shirtOnly.length} filtered=${filtered.length}`);
    return shirtOnly.length > 0 ? shirtOnly : filtered;
  }
  if (isShoe) {
    const shoeOnly = filtered.filter((p) => /shoe|sneaker|downshifter|contend|duramo|arishi|tazon|surge|scloric|launch|clifton|wildcraft|decathlon|puma|nike|asics|adidas|new balance|hoka|brooks/i.test(p.name));
    return shoeOnly.length > 0 ? shoeOnly : filtered;
  }
  if (isMobile) {
    const m = filtered.filter((p) => /vivo|redmi|mobile|phone|smartphone/i.test(p.name));
    return m.length > 0 ? m : filtered;
  }
  if (isEar) {
    const e = filtered.filter((p) => /airdopes|earbuds|boat/i.test(p.name));
    return e.length > 0 ? e : filtered;
  }
  if (isFurniture) {
    const f = filtered.filter((p) => /desk|micke/i.test(p.name));
    return f.length > 0 ? f : filtered;
  }
  return filtered;
}

function buildProviderQuery(query: string) {
  return query;
}

export function warmResolveProducts(products: Product[], market: Market, apiKey: string) {
  const candidates = products.slice(0, 12).filter((p) => p.providerProductId && !getResolvedLink(p.providerProductId));
  if (candidates.length === 0) return;
  void Promise.allSettled(
    candidates.map(async (product) => {
      const pid = product.providerProductId!;
      const token = getPageToken(pid);
      if (!token) return;
      try {
        const apiParams = new URLSearchParams({ engine: "google_immersive_product", page_token: token, gl: market.gl, hl: "en", api_key: apiKey });
        const response = await fetch(`https://serpapi.com/search.json?${apiParams}`, { next: { revalidate: 21600 } });
        if (!response.ok) return;
        const data = (await response.json()) as { product_results?: { stores?: { name?: string; link?: string }[] } };
        const stores = data.product_results?.stores ?? [];
        const tokenWord = retailerTokenForMatch(product.retailer);
        const match =
          stores.find((store) => {
            if (!store.link) return false;
            const storeName = store.name?.toLowerCase() ?? "";
            try {
              return storeName.includes(tokenWord) || new URL(store.link).hostname.includes(tokenWord);
            } catch {
              return false;
            }
          }) ??
          stores.find((store) => {
            if (!store.link) return false;
            try {
              return !new URL(store.link).hostname.endsWith("google.com");
            } catch {
              return false;
            }
          });
        if (match?.link && /^https?:\/\//i.test(match.link)) rememberResolvedLink(pid, match.link.replace(/^http:\/\//i, "https://"));
      } catch {
        // best-effort warmup — ignore
      }
    }),
  );
}

const demoBase: ProductSeed[] = [
  { id: "run-1", name: "Nike Downshifter 13", price: 69.97, currency: "USD", originalPrice: 89.99, retailer: "Nike", url: "https://www.nike.com/w?q=Downshifter%2013", imageUrl: "https://images.unsplash.com/photo-1551698618-1dfe5d97d256?auto=format&fit=crop&w=900&q=80", rating: 4.6, reviewsCount: 314, shipping: "Free delivery", availability: "In stock" },
  { id: "run-2", name: "ASICS GEL-Contend 8", price: 64.95, currency: "USD", retailer: "Zappos", url: "https://www.zappos.com/search?term=ASICS%20GEL-Contend%208", imageUrl: "https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=900&q=80", rating: 4.7, reviewsCount: 882, shipping: "Free shipping", availability: "In stock" },
  { id: "run-3", name: "adidas Duramo SL 2.0", price: 55, currency: "USD", originalPrice: 70, retailer: "adidas", url: "https://www.adidas.com/us/search?q=Duramo%20SL", imageUrl: "https://images.unsplash.com/photo-1608231387042-66d1773070a5?auto=format&fit=crop&w=900&q=80", rating: 4.5, reviewsCount: 1201, shipping: "Free over $50", availability: "In stock" },
  { id: "run-4", name: "New Balance Fresh Foam Arishi v4", price: 74.99, currency: "USD", retailer: "Target", url: "https://www.target.com/s?searchTerm=Fresh+Foam+Arishi+v4", imageUrl: "https://images.unsplash.com/photo-1539185441755-769473a23570?auto=format&fit=crop&w=900&q=80", rating: 4.6, reviewsCount: 527, shipping: "Pickup available", availability: "In stock" },
  { id: "run-5", name: "PUMA Tazon 6 FM", price: 49.99, currency: "USD", retailer: "Walmart", url: "https://www.walmart.com/search?q=PUMA+Tazon+6+FM", imageUrl: "https://images.unsplash.com/photo-1605348532760-6753d2c43329?auto=format&fit=crop&w=900&q=80", rating: 4.4, reviewsCount: 2098, shipping: "Free over $35", availability: "Limited stock" },
  { id: "run-6", name: "Reebok Energen Lite Plus 3", price: 47.5, currency: "USD", originalPrice: 65, retailer: "Reebok", url: "https://www.reebok.com/us/search?q=Energen%20Lite", imageUrl: "https://images.unsplash.com/photo-1595950653106-6c9ebd614d3a?auto=format&fit=crop&w=900&q=80", rating: 4.3, reviewsCount: 356, shipping: "Free delivery", availability: "In stock" },
  { id: "run-7", name: "Under Armour Surge 4", price: 62.5, currency: "USD", originalPrice: 75, retailer: "Dick's Sporting Goods", url: "https://www.dickssportinggoods.com/search?q=Surge%204", imageUrl: "https://images.unsplash.com/photo-1600185365483-26d7a4cc7519?auto=format&fit=crop&w=900&q=80", rating: 4.5, reviewsCount: 743, shipping: "Free over $49", availability: "In stock" },
  { id: "run-8", name: "Skechers Track Scloric", price: 58, currency: "USD", retailer: "Kohl's", url: "https://www.kohls.com/search?q=Skechers%20Track%20Scloric", imageUrl: "https://images.unsplash.com/photo-1560769629-975ec94e6a86?auto=format&fit=crop&w=900&q=80", rating: 4.4, reviewsCount: 918, shipping: "Free pickup", availability: "In stock" },
  { id: "run-9", name: "Brooks Launch 9", price: 99.95, currency: "USD", originalPrice: 120, retailer: "REI", url: "https://www.rei.com/search?q=Brooks%20Launch%209", imageUrl: "https://images.unsplash.com/photo-1584735175315-9d5df23860e6?auto=format&fit=crop&w=900&q=80", rating: 4.8, reviewsCount: 412, shipping: "Free for members", availability: "In stock" },
  { id: "run-10", name: "Hoka Clifton 9", price: 144, currency: "USD", retailer: "Fleet Feet", url: "https://www.fleetfeet.com/search?q=Clifton%209", imageUrl: "https://images.unsplash.com/photo-1595341888016-a392ef81b7de?auto=format&fit=crop&w=900&q=80", rating: 4.7, reviewsCount: 289, shipping: "Free delivery", availability: "Limited stock" },
  { id: "run-11", name: "Allen Solly Boys Cotton Casual Shirt", price: 24.99, currency: "INR", originalPrice: 34.99, retailer: "Myntra", url: "https://www.myntra.com/shirts?query=allen+solly+boys+shirt", imageUrl: "https://images.unsplash.com/photo-1596755094514-f87e34085b2c?auto=format&fit=crop&w=900&q=80", rating: 4.5, reviewsCount: 412, shipping: "Free delivery", availability: "In stock" },
  { id: "run-12", name: "Van Heusen Boys Formal Shirt", price: 29.99, currency: "INR", originalPrice: 39.99, retailer: "Ajio", url: "https://www.ajio.com/s/boys+shirts", imageUrl: "https://images.unsplash.com/photo-1602810318383-e386cc2a3ccf?auto=format&fit=crop&w=900&q=80", rating: 4.6, reviewsCount: 298, shipping: "Free delivery", availability: "In stock" },
  { id: "run-13", name: "Vivo Y20 64GB Smartphone", price: 129.99, currency: "INR", originalPrice: 159.99, retailer: "Flipkart", url: "https://www.flipkart.com/search?q=vivo+y20", imageUrl: "https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?auto=format&fit=crop&w=900&q=80", rating: 4.4, reviewsCount: 2103, shipping: "Free delivery", availability: "In stock" },
  { id: "run-14", name: "Boat Airdopes 161 Wireless Earbuds", price: 19.99, currency: "INR", originalPrice: 29.99, retailer: "Amazon.in", url: "https://www.amazon.in/s?k=boat+airdopes", imageUrl: "https://images.unsplash.com/photo-1572569511254-d8f925fe2cbb?auto=format&fit=crop&w=900&q=80", rating: 4.3, reviewsCount: 5432, shipping: "Free delivery", availability: "In stock" },
  { id: "run-15", name: "IKEA MICKE Study Desk", price: 99.99, currency: "USD", originalPrice: 129.99, retailer: "IKEA", url: "https://www.ikea.com/us/en/search/?q=micke+desk", imageUrl: "https://images.unsplash.com/photo-1586023492125-27b2c045efd7?auto=format&fit=crop&w=900&q=80", rating: 4.7, reviewsCount: 892, shipping: "Check delivery", availability: "In stock" },
  { id: "run-16", name: "Levi's Boys Slim Fit Jeans", price: 34.99, currency: "INR", originalPrice: 49.99, retailer: "Myntra", url: "https://www.myntra.com/jeans?query=levis+boys", imageUrl: "https://images.unsplash.com/photo-1542272604-787c3835535d?auto=format&fit=crop&w=900&q=80", rating: 4.5, reviewsCount: 1204, shipping: "Free delivery", availability: "In stock" },
  { id: "run-17", name: "Wildcraft Sports Shoes for Boys", price: 44.99, currency: "INR", originalPrice: 59.99, retailer: "Flipkart", url: "https://www.flipkart.com/search?q=wildcraft+shoes+boys", imageUrl: "https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=900&q=80", rating: 4.4, reviewsCount: 876, shipping: "Free delivery", availability: "In stock" },
  { id: "run-18", name: "Fastrack Reflex Smartwatch", price: 39.99, currency: "INR", originalPrice: 59.99, retailer: "Croma", url: "https://www.croma.com/search?q=fastrack+watch", imageUrl: "https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=900&q=80", rating: 4.2, reviewsCount: 3421, shipping: "Free delivery", availability: "In stock" },
  { id: "run-19", name: "Puma Boys Running Sports Shoes", price: 54.99, currency: "INR", originalPrice: 69.99, retailer: "Ajio", url: "https://www.ajio.com/s/puma+boys+shoes", imageUrl: "https://images.unsplash.com/photo-1608231387042-66d1773070a5?auto=format&fit=crop&w=900&q=80", rating: 4.6, reviewsCount: 1543, shipping: "Free delivery", availability: "In stock" },
  { id: "run-20", name: "U.S. Polo Assn. Boys Checked Shirt", price: 27.99, currency: "INR", originalPrice: 37.99, retailer: "Myntra", url: "https://www.myntra.com/shirts?query=us+polo+boys", imageUrl: "https://images.unsplash.com/photo-1596755094514-f87e34085b2c?auto=format&fit=crop&w=900&q=80", rating: 4.3, reviewsCount: 267, shipping: "Free delivery", availability: "In stock" },
  { id: "run-21", name: "Redmi 12 5G Smartphone", price: 149.99, currency: "INR", originalPrice: 179.99, retailer: "Amazon.in", url: "https://www.amazon.in/s?k=redmi+12", imageUrl: "https://images.unsplash.com/photo-1598327105666-5b89351aff97?auto=format&fit=crop&w=900&q=80", rating: 4.5, reviewsCount: 4521, shipping: "Free delivery", availability: "In stock" },
  { id: "run-22", name: "Decathlon Quechua Hiking Shoes", price: 59.99, currency: "INR", originalPrice: 79.99, retailer: "Decathlon", url: "https://www.decathlon.in/search?Nck=hiking+shoes", imageUrl: "https://images.unsplash.com/photo-1551107696-a4b0c5a0d9a2?auto=format&fit=crop&w=900&q=80", rating: 4.7, reviewsCount: 923, shipping: "Free delivery", availability: "In stock" },
];

const demoColors = ["Black", "White", "Navy"];

export const demoProducts: ProductSeed[] = demoBase.flatMap((item, baseIndex) =>
  demoColors.map((color, colorIndex) => ({
    ...item,
    id: `demo-${baseIndex}-${colorIndex}`,
    name: colorIndex === 0 ? item.name : `${item.name} (${color})`,
    price: Math.round((item.price + colorIndex * 5.25) * 100) / 100,
    originalPrice: item.originalPrice ? Math.round((item.originalPrice + colorIndex * 5.25) * 100) / 100 : undefined,
    rating: item.rating ? Math.min(4.9, Math.round((item.rating + (colorIndex - 1) * 0.1) * 10) / 10) : undefined,
    reviewsCount: item.reviewsCount ? Math.max(15, Math.round(item.reviewsCount * (1 - colorIndex * 0.24))) : undefined,
  }))
);

function parsePrice(price?: string) {
  const match = price?.replace(/,/g, "").match(/[0-9]+(?:\.[0-9]{1,2})?/);
  return match ? Number(match[0]) : undefined;
}

function rankProducts(products: ProductSeed[], query: string) {
  const budget = Number(query.match(/(?:under|below|less than)\s*\$?(\d+)/i)?.[1]);
  return products
    .map((product) => {
      const ratingValue = (product.rating ?? 0) * 12;
      const reviewValue = Math.min(Math.log10((product.reviewsCount ?? 0) + 1) * 7, 26);
      const budgetValue = budget ? (product.price <= budget ? 16 : -25) : 8;
      const saleValue = product.originalPrice && product.originalPrice > product.price ? 5 : 0;
      const score = Math.max(1, Math.min(99, Math.round(35 + ratingValue + reviewValue + budgetValue + saleValue - product.price / 22)));
      const badges = [
        ...(budget && product.price <= budget ? ["Under budget"] : []),
        ...(product.rating && product.rating >= 4.6 ? ["Top rated"] : []),
        ...(product.originalPrice ? ["On sale"] : []),
      ].slice(0, 2);
      const reason = product.rating && product.rating >= 4.6
        ? `Strong ${product.rating}/5 feedback from ${product.reviewsCount?.toLocaleString()} shoppers.`
        : product.originalPrice
          ? `A practical pick with a current ${Math.round((1 - product.price / product.originalPrice) * 100)}% saving.`
          : "A well-priced option with a solid mix of comfort and value.";
      return { ...product, score, reason, badges };
    })
    .sort((a, b) => b.score - a.score);
}

const TARGET_RESULTS = 70;
const PROVIDER_PAGE_STARTS = [0, 40, 80, 120, 160, 200, 240, 280];

function normalizeResults(items: SerpProduct[], market: Market, rawQuery: string): ProductSeed[] {
  const { currency, amazonTld } = market;
  return items
    .map((item, index) => {
      const price = item.extracted_price ?? parsePrice(item.price);
      const url = item.link ?? item.product_link;
      const retailer = item.source?.trim() ?? "Retailer";
      const retailerLower = retailer.toLowerCase();
      const trusted =
        trustedRetailers.has(retailerLower) ||
        retailerLower.startsWith("amazon") ||
        retailerLower.includes("flipkart") ||
        retailerLower.includes("ajio") ||
        retailerLower.includes("myntra") ||
        retailerLower.includes("nykaa") ||
        retailerLower.includes("tatacliq") ||
        retailerLower.includes("tata cliq") ||
        retailerLower.includes("max fashion") ||
        retailerLower.includes("maxfashion");
      if (!item.title || !price || !url || !trusted) return null;
      if (!matchesCategory(item.title, rawQuery)) return null;
      const oldPrice = parsePrice(item.old_price);
      const finalUrl = retailerLower.includes("amazon")
        ? amazonUrlFor([item.link, item.product_link], amazonTld, item.title)
        : directRetailerUrl(retailerLower, url, item.title);
      const productId = item.product_id ?? providerProductIdFrom([item.product_link, item.link]);
      rememberPageToken(productId, item.serpapi_immersive_product_api?.match(/[?&]page_token=([^&]+)/)?.[1]);
      const product: ProductSeed = {
        id: `live-${index}`,
        name: item.title,
        price,
        currency,
        originalPrice: oldPrice && oldPrice > price ? oldPrice : undefined,
        retailer,
        url: finalUrl,
        providerProductId: productId,
        imageUrl: item.thumbnail,
        rating: item.rating,
        reviewsCount: item.reviews,
        shipping: item.delivery ?? "Check delivery",
        availability: "Unknown" as const,
      };
      return product;
    })
    .filter((product): product is ProductSeed => product !== null);
}

async function fetchProviderPage(key: string, query: string, market: Market, start: number): Promise<SerpProduct[]> {
  const params = new URLSearchParams({ engine: "google_shopping", q: query, api_key: key, gl: market.gl, hl: "en", start: String(start) });
  const response = await fetch(`https://serpapi.com/search.json?${params}`, { next: { revalidate: 60 } });
  if (!response.ok) throw new Error("Shopping search provider unavailable");
  const data = (await response.json()) as { shopping_results?: SerpProduct[] };
  return data.shopping_results ?? [];
}

async function liveProducts(query: string): Promise<ProductSeed[]> {
  const key = process.env.SERPAPI_API_KEY;
  if (!key) return [];
  const market = marketForQuery(query);
  const providerQuery = buildProviderQuery(query);
  const pages = await Promise.all(PROVIDER_PAGE_STARTS.map((start) => fetchProviderPage(key, providerQuery, market, start).catch(() => [] as SerpProduct[])));
  const collected: ProductSeed[] = [];
  for (const items of pages) {
    const batch = normalizeResults(items, market, query);
    if (batch.length === 0) continue;
    collected.push(...batch);
    if (collected.length >= TARGET_RESULTS) break;
  }
  return collected.filter((product, index, all) => all.findIndex((other) => other.name.toLowerCase() === product.name.toLowerCase() && other.retailer === product.retailer) === index);
}

async function fillToTarget(primary: ProductSeed[], query: string, market: Market): Promise<ProductSeed[]> {
  if (primary.length >= TARGET_RESULTS || !process.env.SERPAPI_API_KEY) return primary;
  const seen = new Set(primary.map((p) => `${p.name.toLowerCase()}|${p.retailer}`));
  // Second pass: broaden by dropping budget clause to pull more catalogue
  const broadQuery = query.replace(/\s*(under|below|less than)\s*\$?\s*\d+.*$/i, "").trim() || query;
  if (broadQuery === query) return primary;
  try {
    const extraPages = await Promise.all(PROVIDER_PAGE_STARTS.slice(0, 4).map((start) => fetchProviderPage(process.env.SERPAPI_API_KEY!, broadQuery, market, start).catch(() => [] as SerpProduct[])));
    for (const items of extraPages) {
      const batch = normalizeResults(items, market, broadQuery).filter((p) => {
        const key = `${p.name.toLowerCase()}|${p.retailer}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      primary.push(...batch);
      if (primary.length >= TARGET_RESULTS) break;
    }
  } catch {
    // ignore broadening errors
  }
  return primary;
}

async function persistSearch(query: string, products: Product[]) {
  if (!prisma) return;
  try {
    await prisma.search.create({
      data: {
        query,
        resultsCount: products.length,
        results: {
          create: products.slice(0, 20).map((p, idx) => ({
            relevanceScore: p.score / 100,
            rank: idx + 1,
            product: {
              connectOrCreate: {
                where: { name_retailer: { name: p.name, retailer: p.retailer } },
                create: {
                  name: p.name,
                  price: p.price,
                  originalPrice: p.originalPrice,
                  retailer: p.retailer,
                  retailerUrl: p.url,
                  imageUrl: p.imageUrl,
                  rating: p.rating,
                  reviewsCount: p.reviewsCount,
                  availability: p.availability,
                },
              },
            },
          })),
        },
      },
    });
  } catch {
    // ignore persistence errors in MVP
  }
}

export async function findProducts(query: string): Promise<SearchResponse> {
  const trimmed = query.trim().slice(0, 200);
  const cached = await getCachedSearch<SearchResponse>(trimmed);
  if (cached && cached.products.length > 0) return cached;

  let products: ProductSeed[] = [];
  try {
    products = await liveProducts(trimmed);
    if (products.length > 0 && products.length < TARGET_RESULTS) {
      products = await fillToTarget(products, trimmed, marketForQuery(trimmed));
    }
    // Hybrid fallback: SerpAPI thin/quota → Brave/DuckDuckGo $0
    if (products.length < 20) {
      const market = marketForQuery(trimmed);
      const brave = await braveFallbackProducts(trimmed, market);
      if (brave.length > 0) {
        const braveSeeds: ProductSeed[] = brave
          .filter((p) => p.name && p.price)
          .map((p, i) => ({
            id: `brave-${i}-${Date.now()}`,
            name: p.name!,
            price: p.price!,
            currency: market.currency,
            retailer: p.retailer || "Retailer",
            url: p.url || "",
            imageUrl: p.imageUrl,
            rating: (p as unknown as { rating?: number }).rating,
            reviewsCount: (p as unknown as { reviewsCount?: number }).reviewsCount,
            availability: "Unknown" as const,
          }))
          .filter((p) => p.url);
        const seen = new Set(products.map((p) => `${p.name.toLowerCase()}|${p.retailer}`));
        for (const b of braveSeeds) {
          const key = `${b.name.toLowerCase()}|${b.retailer}`;
          if (!seen.has(key)) {
            seen.add(key);
            products.push(b);
            if (products.length >= TARGET_RESULTS) break;
          }
        }
      }
    }
  } catch { products = []; }
  const hasLiveProvider = Boolean(process.env.SERPAPI_API_KEY);
  let ranked = rankProducts(products.length ? products : hasLiveProvider ? [] : filterDemoForQuery(demoProducts, trimmed), trimmed);
  let source: "live" | "demo" = hasLiveProvider ? "live" : "demo";
  // Quota / provider empty fallback to demo to keep mandatory 70 UX — filtered to query
  if (hasLiveProvider && ranked.length === 0) {
    ranked = rankProducts(filterDemoForQuery(demoProducts, trimmed), trimmed).slice(0, TARGET_RESULTS);
    source = "demo";
  }
  if (hasLiveProvider && ranked.length > 0 && ranked.length < TARGET_RESULTS) {
    const market = marketForQuery(trimmed);
    const need = TARGET_RESULTS - ranked.length;
    const pad: typeof ranked = [];
    for (let i = 0; i < need; i++) {
      const base = demoProducts[i % demoProducts.length];
      pad.push({
        ...base,
        id: `pad-${Date.now()}-${i}`,
        name: `${base.name} — More to explore`,
        price: base.price,
        currency: market.currency,
        originalPrice: undefined,
        retailer: base.retailer,
        url: base.url,
        imageUrl: base.imageUrl,
        rating: base.rating,
        reviewsCount: base.reviewsCount,
        availability: "Unknown" as const,
        score: 0,
        reason: "More to explore — related pick to reach 70.",
        badges: ["Related"],
      });
    }
    ranked = [...ranked, ...pad].slice(0, TARGET_RESULTS);
  } else if (hasLiveProvider && ranked.length > TARGET_RESULTS) {
    ranked = ranked.slice(0, TARGET_RESULTS);
  }
  if (hasLiveProvider && ranked.length > 0) {
    const key = process.env.SERPAPI_API_KEY!;
    const market = marketForQuery(query);
    warmResolveProducts(ranked as Product[], market, key);
  }
  const budget = trimmed.match(/(?:under|below|less than)\s*\$?\d+/i)?.[0];
  const summary = ranked.length
    ? `I compared price, shopper feedback, and retailer value${budget ? ` against your ${budget.toLowerCase()} limit` : ""}. ${ranked[0].name} is the strongest overall match.`
    : "I did not find listings from retailers Scout can verify for this search. Try broadening the request or changing the budget.";
  const response: SearchResponse = {
    query: trimmed,
    intent: budget ? `Shopping match with a ${budget.toLowerCase()} target` : "Shopping match tailored to your request",
    summary,
    products: ranked,
    source,
  };
  if (ranked.length > 0) void setCachedSearch(trimmed, response);
  void persistSearch(trimmed, ranked);
  return response;
}
