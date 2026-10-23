import { NextRequest, NextResponse } from "next/server";
import { cleanChanges, readStore, writeStore } from "@/lib/server-store";

/**
 * Shared data store for every device that opens this server (PC, phone on the same Wi-Fi).
 * SQLite at data/store.db (JSON fallback on older Node). Only whitelisted keys are accepted.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const store = readStore();
  if (request.nextUrl.searchParams.get("download") === "1") {
    const stamp = new Date().toISOString().slice(0, 10);
    return new NextResponse(JSON.stringify({ app: "stock-tool", version: 1, updatedAt: store.updatedAt, data: store.data }, null, 2), {
      headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="stock-tool-backup-${stamp}.json"` },
    });
  }
  return NextResponse.json(store);
}

/**
 * Body: { data: { key: value | null }, revs?: { key: revision }, replace?: boolean }.
 * Merges keys (or replaces everything on restore). With `revs`, a key changed elsewhere since that revision
 * is refused with 409 and the current state, so the client can reload instead of overwriting it.
 */
export async function PUT(request: NextRequest) {
  let body: { data?: unknown; revs?: unknown; replace?: boolean };
  try { body = (await request.json()) as typeof body; }
  catch { return NextResponse.json({ message: "Body must be JSON." }, { status: 400 }); }
  try {
    const expected = body.revs && typeof body.revs === "object" ? Object.fromEntries(Object.entries(body.revs as Record<string, unknown>).filter(([, value]) => Number.isInteger(value)) as [string, number][]) : undefined;
    const result = writeStore(cleanChanges(body.data), { replace: !!body.replace, expected: body.replace ? undefined : expected });
    if (!result.ok) return NextResponse.json({ message: "Changed on another device.", conflicts: result.conflicts, ...result.state }, { status: 409 });
    return NextResponse.json({ updatedAt: result.state.updatedAt, revs: result.state.revs, keys: Object.keys(result.state.data) });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "Unable to save." }, { status: 500 });
  }
}
