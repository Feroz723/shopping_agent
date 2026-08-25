import * as cheerio from "cheerio";
import type { Product } from "./types";

type BraveWebResult = { url: string; title: string };

export async function searchBraveLinks(query: string): Promise<string[]> {
  const key = process.env.BRAVE_SEARCH_API_KEY;
  if (!key) return [];
  try {
    const res = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=20`, {
      headers: { Accept: "application/json", "X-Subscription-Token": key },
      next: { revalidate: 3600 } as unknown as { revalidate: number },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { web?: { results?: BraveWebResult[] } };
    const urls = (data.web?.results ?? []).map((r) => r.url).filter(Boolean);
    return urls.filter((url) => /amazon|flipkart|myntra|ajio|nykaa|tatacliq|croma|reliance/i.test(url));
  } catch {
    return [];
  }
}

async function fetchWithUA(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36", Accept: "text/html" },
      next: { revalidate: 3600 } as unknown as { revalidate: number },
    } as unknown as RequestInit);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

export async function scrapeAmazon(url: string): Promise<Partial<Product> | null> {
  const html = await fetchWithUA(url);
  if (!html) return null;
  const $ = cheerio.load(html);
  const name = $("#productTitle").text().trim() || $("h1").first().text().trim();
  const priceText = $("#corePriceDisplay span.a-price-whole").first().text() || $(".a-price .a-offscreen").first().text();
  const price = parseFloat(priceText.replace(/[^\d.]/g, ""));
  if (!name || !price) return null;
  return { name, price, retailer: url.includes("amazon.in") ? "Amazon.in" : "Amazon", url, imageUrl: $("#landingImage").attr("src") || $("#imgTagWrapperId img").attr("src") };
}

export async function scrapeFlipkart(url: string): Promise<Partial<Product> | null> {
  const html = await fetchWithUA(url);
  if (!html) return null;
  const $ = cheerio.load(html);
  const name = $("span.B_NuCI").first().text().trim() || $("h1").first().text().trim();
  const priceText = $("div._30jeq3").first().text();
  const price = parseFloat(priceText.replace(/[^\d.]/g, ""));
  if (!name || !price) return null;
  return { name, price, retailer: "Flipkart", url, imageUrl: $("img._396cs4").attr("src") || $("img").first().attr("src") };
}

export async function scrapeGeneric(url: string): Promise<Partial<Product> | null> {
  const html = await fetchWithUA(url);
  if (!html) return null;
  const $ = cheerio.load(html);
  const name = $("h1").first().text().trim() || $("title").text().trim();
  const priceText = $("[class*='price']").first().text();
  const price = parseFloat(priceText.replace(/[^\d.]/g, ""));
  const retailer = (() => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return "Retailer"; } })();
  if (!name) return null;
  return { name, price: isNaN(price) ? 0 : price, retailer, url, imageUrl: $("img").first().attr("src") };
}

export async function scrapeProduct(url: string): Promise<Partial<Product> | null> {
  if (/amazon\./i.test(url)) return (await scrapeAmazon(url)) ?? (await scrapeGeneric(url));
  if (/flipkart\./i.test(url)) return (await scrapeFlipkart(url)) ?? (await scrapeGeneric(url));
  return scrapeGeneric(url);
}

export async function searchDuckDuckGoLinks(query: string): Promise<string[]> {
  try {
    const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36", Accept: "text/html" },
      next: { revalidate: 3600 } as unknown as { revalidate: number },
    } as unknown as RequestInit);
    if (!res.ok) return [];
    const html = await res.text();
    const $ = cheerio.load(html);
    const urls: string[] = [];
    $("a.result__url").each((_, el) => {
      let href = $(el).attr("href");
      if (!href) return;
      // Decode DuckDuckGo redirect //duckduckgo.com/l/?uddg=https%3A%2F%2F...
      if (href.includes("uddg=")) {
        try {
          const u = new URL(href.startsWith("//") ? `https:${href}` : href);
          const decoded = u.searchParams.get("uddg");
          if (decoded) href = decodeURIComponent(decoded);
        } catch {}
      }
      if (href) urls.push(href.startsWith("http") ? href : href.startsWith("//") ? `https:${href}` : `https://${href}`);
    });
    if (urls.length === 0) {
      $("a[href*='amazon.'], a[href*='flipkart.'], a[href*='myntra.'], a[href*='walmart.'], a[href*='target.'], a[href*='nike.']").each((_, el) => {
        let href = $(el).attr("href");
        if (!href) return;
        if (href.includes("uddg=")) {
          try {
            const u = new URL(href.startsWith("//") ? `https:${href}` : href);
            const d = u.searchParams.get("uddg");
            if (d) href = decodeURIComponent(d);
          } catch {}
        }
        if (href && href.startsWith("http")) urls.push(href);
      });
    }
    return urls.filter((url) => /amazon|flipkart|myntra|ajio|nykaa|tatacliq|croma|reliance|walmart|target|nike|adidas|puma|zappos|ebay/i.test(url)).slice(0, 20);
  } catch {
    return [];
  }
}

export async function scrapeAmazonSearch(query: string, domain: string = "www.amazon.in"): Promise<Partial<Product>[]> {
  try {
    const url = `https://${domain}/s?k=${encodeURIComponent(query)}`;
    const html = await fetchWithUA(url);
    if (!html) return [];
    const $ = cheerio.load(html);
    const results: Partial<Product>[] = [];
    const retailerName = domain.includes(".com") ? "Amazon" : "Amazon.in";
    $("div[data-component-type='s-search-result']").each((_, el) => {
      const name = $(el).find("h2 span").first().text().trim();
      const priceText = $(el).find("span.a-price-whole").first().text();
      const price = parseFloat(priceText.replace(/[^\d.]/g, ""));
      const link = $(el).find("h2 a").attr("href");
      const imageUrl = $(el).find("img.s-image").attr("src");
      const ratingText = $(el).find("span.a-icon-alt").first().text();
      const rating = parseFloat(ratingText);
      if (name && price && link) {
        results.push({
          name,
          price,
          retailer: retailerName,
          url: link.startsWith("http") ? link : `https://${domain}${link}`,
          imageUrl,
          rating: isNaN(rating) ? undefined : rating,
        });
      }
    });
    return results.slice(0, 30);
  } catch {
    return [];
  }
}

export async function braveFallbackProducts(query: string, market?: { currency: "USD" | "INR"; gl: string }): Promise<Partial<Product>[]> {
  let links = await searchBraveLinks(query);
  if (links.length === 0) links = await searchDuckDuckGoLinks(query);
  if (links.length > 0) {
    const results = await Promise.all(links.slice(0, 15).map((url) => scrapeProduct(url)));
    const filtered = results.filter((r): r is Partial<Product> => Boolean(r && r.name && r.price));
    if (filtered.length >= 10) return filtered;
  }
  // Direct Amazon search scrape — $0, no API key, works even when Brave/DuckDuckGo are thin
  const domain = market?.currency === "USD" ? "www.amazon.com" : "www.amazon.in";
  const amazonDirect = await scrapeAmazonSearch(query, domain);
  if (amazonDirect.length > 0) return amazonDirect;
  return [];
}
