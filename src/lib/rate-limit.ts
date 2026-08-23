import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

let ratelimit: Ratelimit | null = null;

function getRatelimit() {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) return null;
  if (ratelimit) return ratelimit;
  try {
    const redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
    ratelimit = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(100, "1 h"),
      analytics: false,
    });
    return ratelimit;
  } catch {
    return null;
  }
}

export async function checkRateLimit(ip: string): Promise<{ success: boolean }> {
  const limiter = getRatelimit();
  if (!limiter) return { success: true };
  try {
    const result = await limiter.limit(ip);
    return { success: result.success };
  } catch {
    return { success: true };
  }
}
