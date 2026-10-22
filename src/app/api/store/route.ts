import { NextRequest, NextResponse } from "next/server";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { SYNCED_KEYS } from "@/lib/synced-keys";

/**
 * Shared data store for every device that opens this server (PC, phone on the same Wi-Fi).
 * Saved as data/store.json in the project folder. Only whitelisted keys are accepted.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";


type Store = { version: 1; updatedAt: string | null; data: Record<string, string> };

const dir = path.join(process.cwd(), "data");
const file = path.join(dir, "store.json");
let queue: Promise<unknown> = Promise.resolve();

async function readStore(): Promise<Store> {
  try {
    const parsed = JSON.parse(await readFile(file, "utf8")) as Store;
    return { version: 1, updatedAt: parsed.updatedAt ?? null, data: parsed.data ?? {} };
  } catch {
    return { version: 1, updatedAt: null, data: {} };
  }
}

async function writeStore(store: Store) {
  await mkdir(dir, { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(store, null, 2), "utf8");
  await rename(temp, file); // atomic replace: a crash never leaves a half-written file
}

function clean(input: unknown) {
  const out: Record<string, string | null> = {};
  if (!input || typeof input !== "object") return out;
  for (const key of SYNCED_KEYS) {
    const value = (input as Record<string, unknown>)[key];
    if (value === null) out[key] = null;
    else if (typeof value === "string" && value.length <= 5_000_000) out[key] = value;
  }
  return out;
}

export async function GET(request: NextRequest) {
  const store = await readStore();
  if (request.nextUrl.searchParams.get("download") === "1") {
    const stamp = new Date().toISOString().slice(0, 10);
    return new NextResponse(JSON.stringify({ app: "stock-tool", ...store }, null, 2), {
      headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="stock-tool-backup-${stamp}.json"` },
    });
  }
  return NextResponse.json(store);
}

/** Body: { data: { key: value | null }, replace?: boolean } — merges keys (or replaces everything on restore). */
export async function PUT(request: NextRequest) {
  try {
    const body = (await request.json()) as { data?: unknown; replace?: boolean };
    const changes = clean(body.data);
    const result = (queue = queue.then(async () => {
      const store = body.replace ? { version: 1 as const, updatedAt: null, data: {} } : await readStore();
      for (const [key, value] of Object.entries(changes)) {
        if (value === null) delete store.data[key];
        else store.data[key] = value;
      }
      store.updatedAt = new Date().toISOString();
      await writeStore(store);
      return store;
    }));
    const store = (await result) as Store;
    return NextResponse.json({ updatedAt: store.updatedAt, keys: Object.keys(store.data) });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "Unable to save." }, { status: 400 });
  }
}
