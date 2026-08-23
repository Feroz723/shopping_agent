import { kv } from "@vercel/kv";

function normalizeKey(q: string) {
  return `search:${q.toLowerCase().replace(/\s+/g, "-").slice(0, 100)}`;
}

export async function getCachedSearch<T>(query: string): Promise<T | null> {
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) return null;
  try {
    return (await kv.get<T>(normalizeKey(query))) ?? null;
  } catch {
    return null;
  }
}

export async function setCachedSearch<T>(query: string, value: T): Promise<void> {
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) return;
  try {
    await kv.set(normalizeKey(query), value, { ex: 86400 });
  } catch {
    // ignore cache errors
  }
}
