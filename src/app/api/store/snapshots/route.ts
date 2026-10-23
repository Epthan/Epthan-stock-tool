import { NextRequest, NextResponse } from "next/server";
import { listSnapshots, readSnapshot, restoreSnapshot } from "@/lib/server-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET: snapshot list. GET ?id=N: that snapshot as a backup file. */
export async function GET(request: NextRequest) {
  const id = Number(request.nextUrl.searchParams.get("id"));
  if (Number.isInteger(id) && id > 0) {
    const data = readSnapshot(id);
    if (!data) return NextResponse.json({ message: "Snapshot not found." }, { status: 404 });
    return new NextResponse(JSON.stringify({ app: "stock-tool", version: 1, snapshot: id, data }, null, 2), {
      headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="stock-tool-snapshot-${id}.json"` },
    });
  }
  return NextResponse.json({ snapshots: listSnapshots() });
}

/** POST { id }: restore that snapshot (the current data is snapshotted first). */
export async function POST(request: NextRequest) {
  let id: number;
  try { id = Number(((await request.json()) as { id?: unknown }).id); }
  catch { return NextResponse.json({ message: "Body must be JSON." }, { status: 400 }); }
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ message: "id is required." }, { status: 400 });
  const result = restoreSnapshot(id);
  if (!result) return NextResponse.json({ message: "Snapshot not found." }, { status: 404 });
  return NextResponse.json(result.state);
}
