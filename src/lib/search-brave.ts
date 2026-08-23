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

export async function braveFallbackProducts(query: string, _market: { currency: "USD" | "INR"; gl: string }): Promise<Partial<Product>[]> {
  void _market;
  const links = await searchBraveLinks(query);
  if (links.length === 0) return [];
  const results = await Promise.all(links.slice(0, 15).map((url) => scrapeProduct(url)));
  return results.filter((r): r is Partial<Product> => Boolean(r && r.name));
}
