import { NextRequest } from "next/server";

const allowedImageHostSuffixes = [
  ".gstatic.com",
  ".googleusercontent.com",
  ".ssl-images-amazon.com",
  ".media-amazon.com",
  ".flixcart.com",
  ".myntassets.com",
  ".ajio.com",
  ".croma.com",
  ".nike.com",
  ".adidas.com",
  ".unsplash.com",
];

export async function GET(request: NextRequest) {
  const source = request.nextUrl.searchParams.get("url");
  if (!source) return new Response("Missing url", { status: 400 });

  let parsed: URL;
  try {
    parsed = new URL(source);
  } catch {
    return new Response("Invalid url", { status: 400 });
  }

  if (parsed.protocol !== "https:" || !allowedImageHostSuffixes.some((suffix) => parsed.hostname.endsWith(suffix))) {
    return new Response("Host not allowed", { status: 403 });
  }

  try {
    const upstream = await fetch(parsed, {
      signal: AbortSignal.timeout(8000),
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
    });
    const contentType = upstream.headers.get("content-type") ?? "";
    if (!upstream.ok || !contentType.startsWith("image/")) {
      return new Response("Upstream image unavailable", { status: 502 });
    }
    const bytes = await upstream.arrayBuffer();
    return new Response(bytes, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch {
    return new Response("Upstream image unavailable", { status: 502 });
  }
}
