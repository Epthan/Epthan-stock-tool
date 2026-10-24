import fs from "node:fs";
import { NextResponse } from "next/server";
import { closeDatabases, dataDir } from "@/lib/server-sqlite";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Test servers only (STOCK_TOOL_TEST_MODE=1, set by tests/support/servers.ts): empty the server's data folder.
 * Databases are closed first because Windows refuses to delete open files. Returns 404 in normal use.
 */
export async function POST() {
  if (process.env.STOCK_TOOL_TEST_MODE !== "1") return NextResponse.json({ message: "Not found" }, { status: 404 });
  closeDatabases();
  fs.rmSync(dataDir(), { recursive: true, force: true });
  return NextResponse.json({ ok: true });
}
