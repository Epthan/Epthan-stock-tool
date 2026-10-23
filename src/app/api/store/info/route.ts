import { NextResponse } from "next/server";
import { storeInfo } from "@/lib/server-store";
import { archiveStats } from "@/lib/price-archive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Storage engine, file sizes and price-archive coverage (shown under Back up / Restore). */
export async function GET() {
  return NextResponse.json({ node: process.version, store: storeInfo(), prices: archiveStats() });
}
