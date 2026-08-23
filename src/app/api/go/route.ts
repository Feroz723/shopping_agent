import { NextRequest, NextResponse } from "next/server";
import { fallbackRetailerSearchUrl, getPageToken, getResolvedLink } from "@/lib/search";

type StoreResult = { name?: string; link?: string };

function retailerToken(retailer: string) {
  return retailer.split(/[^a-z0-9]+/).filter(Boolean)[0]?.toLowerCase() ?? "";
}

const retailerDomainMap: Record<string, string> = {
  myntra: "myntra.com",
  flipkart: "flipkart.com",
  amazon: "amazon.in",
  "amazon.in": "amazon.in",
  ajio: "ajio.com",
  nykaa: "nykaa.com",
  tatacliq: "tatacliq.com",
  "tata cliq": "tatacliq.com",
  croma: "croma.com",
  reliance: "reliancedigital.in",
  decathlon: "decathlon.in",
  nike: "nike.com",
  adidas: "adidas.co.in",
  puma: "in.puma.com",
  zara: "zara.com",
};

function addAffiliateTag(url: string): string {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.includes("amazon")) return url;
    const tag = process.env.AMAZON_ASSOCIATE_ID;
    if (!tag || parsed.searchParams.has("tag")) return url;
    parsed.searchParams.set("tag", tag);
    if (!parsed.searchParams.has("linkCode")) parsed.searchParams.set("linkCode", "osi");
    return parsed.toString();
  } catch {
    return url;
  }
}

function rememberResolvedLinkInline(productId: string, url: string) {
  // delegated to lib/search via getResolvedLink path — keep inline for go route self-healing
  try {
    const g = globalThis as typeof globalThis & { __scoutResolved?: Map<string, { url: string; at: number }> };
    const map = (g.__scoutResolved ??= new Map());
    if (map.size >= 600 && !map.has(productId)) {
      const oldest = map.keys().next().value;
      if (oldest) map.delete(oldest);
    }
    map.set(productId, { url, at: Date.now() });
  } catch {
    // ignore
  }
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const pid = params.get("pid");
  const retailer = params.get("r") ?? "";
  const region = params.get("g") === "in" ? "in" as const : "us" as const;
  const name = params.get("q") ?? "";
  const lastResortRaw = params.get("u");

  let safeLastResort: string | null = null;
  if (lastResortRaw && /^https:\/\//i.test(lastResortRaw)) {
    try {
      const parsed = new URL(lastResortRaw);
      if (!parsed.hostname.endsWith("google.com")) safeLastResort = lastResortRaw;
    } catch {
      safeLastResort = null;
    }
  }

  let target: string | null = null;
  const key = process.env.SERPAPI_API_KEY;
  if (pid) {
    const cached = getResolvedLink(pid);
    if (cached) target = cached;
  }
  const token = !target && pid ? getPageToken(pid) : undefined;

  if (!target && key && token && /^[0-9]{6,25}$/.test(pid ?? "")) {
    try {
      const apiParams = new URLSearchParams({ engine: "google_immersive_product", page_token: token, gl: region, hl: "en", api_key: key });
      const response = await fetch(`https://serpapi.com/search.json?${apiParams}`, { next: { revalidate: 21600 } });
      if (response.ok) {
        const data = (await response.json()) as { product_results?: { stores?: StoreResult[] } };
        const stores = data.product_results?.stores ?? [];
        const tokenWord = retailerToken(retailer);
        if (tokenWord) {
          const match = stores.find((store) => {
            const storeName = store.name?.toLowerCase() ?? "";
            if (!store.link) return false;
            try {
              return storeName.includes(tokenWord) || new URL(store.link).hostname.includes(tokenWord);
            } catch {
              return false;
            }
          }) ?? stores.find((store) => {
            if (!store.link) return false;
            try {
              return !new URL(store.link).hostname.endsWith("google.com");
            } catch {
              return false;
            }
          });
          if (match?.link && /^https?:\/\//i.test(match.link)) {
            target = addAffiliateTag(match.link.replace(/^http:\/\//i, "https://"));
            if (pid) rememberResolvedLinkInline(pid, target);
          }
        }
      }
    } catch {
      target = null;
    }
  }

  // Site-search fallback for exact product page when immersive misses that retailer
  if (!target && key && name && retailer) {
    const domain = retailerDomainMap[retailer.toLowerCase()] ?? (retailerToken(retailer) ? `${retailerToken(retailer)}.com` : null);
    if (domain) {
      try {
        const siteQuery = `site:${domain} "${name.replace(/"/g, "")}"`;
        const siteParams = new URLSearchParams({ engine: "google", q: siteQuery, gl: region, hl: "en", api_key: key, num: "3" });
        const siteResponse = await fetch(`https://serpapi.com/search.json?${siteParams}`, { next: { revalidate: 3600 } });
        if (siteResponse.ok) {
          const siteData = (await siteResponse.json()) as { organic_results?: { link?: string }[] };
          const siteMatch = siteData.organic_results?.find((r) => {
            if (!r.link) return false;
            try {
              return new URL(r.link).hostname.includes(domain.replace(/^www\./, "").split(".")[0]);
            } catch {
              return false;
            }
          });
          if (siteMatch?.link && /^https?:\/\//i.test(siteMatch.link)) {
            target = addAffiliateTag(siteMatch.link.replace(/^http:\/\//i, "https://"));
            if (pid) rememberResolvedLinkInline(pid, target);
          }
        }
      } catch {
        // ignore site-search errors
      }
    }
  }

  if (!target && name) target = fallbackRetailerSearchUrl(retailer, name, region);
  if (!target) target = safeLastResort;
  if (!target || !/^https?:\/\//i.test(target)) {
    const query = name || retailer || "shopping";
    target = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
  } else {
    if (/^http:\/\//i.test(target)) target = target.replace(/^http:\/\//i, "https://");
    target = addAffiliateTag(target);
  }

  const hasAffiliate = /tag=|utm_source=scout/i.test(target);
  console.info("affiliate_click_redirect", { productId: pid, retailer, resolved: Boolean(target && pid && getResolvedLink(pid)), hasAffiliate, at: new Date().toISOString() });
  return NextResponse.redirect(target, 302);
}
