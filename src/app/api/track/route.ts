import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function POST(request: NextRequest) {
  const body = (await request.json()) as { productId?: unknown; retailer?: unknown };
  if (typeof body.productId !== "string" || typeof body.retailer !== "string") {
    return NextResponse.json({ error: "Invalid click event." }, { status: 400 });
  }
  console.info("affiliate_click", { productId: body.productId, retailer: body.retailer, at: new Date().toISOString() });
  if (prisma) {
    try {
      await prisma.affiliateClick.create({
        data: {
          rawProductId: body.productId,
          retailer: body.retailer,
          affiliateNetwork: body.retailer.toLowerCase().includes("amazon") ? "amazon" : body.retailer,
          status: "pending",
        },
      });
    } catch {
      // ignore persistence errors in MVP
    }
  }
  return NextResponse.json({ ok: true });
}
