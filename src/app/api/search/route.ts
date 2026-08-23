import { NextRequest, NextResponse } from "next/server";
import { findProducts } from "@/lib/search";
import { checkRateLimit } from "@/lib/rate-limit";

export async function POST(request: NextRequest) {
  try {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const { success } = await checkRateLimit(ip);
    if (!success) {
      return NextResponse.json({ error: "Rate limit exceeded. Try again in an hour." }, { status: 429 });
    }
    const { query } = (await request.json()) as { query?: unknown };
    if (typeof query !== "string" || query.trim().length < 3) {
      return NextResponse.json({ error: "Enter at least 3 characters to search." }, { status: 400 });
    }
    return NextResponse.json(await findProducts(query.trim().slice(0, 250)));
  } catch {
    return NextResponse.json({ error: "We could not complete that search. Please try again." }, { status: 500 });
  }
}
