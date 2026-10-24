import fs from "node:fs";
import path from "node:path";
import { dataDirFor } from "./servers";

/**
 * G04: the real ./data folder must still have every file it had before (your app may add or update files while
 * tests run, which is fine), and the test server must have written its own data under test-results/.
 */
export default function globalTeardown() {
  const suite = (process.env.STOCK_TOOL_TEST_SUITE ?? "e2e") as "e2e" | "smoke" | "live";
  const file = path.join(process.cwd(), "test-results", `data-guard-${suite}.json`);
  const record = JSON.parse(fs.readFileSync(file, "utf8")) as { before: string[] };
  const real = path.join(process.cwd(), "data");
  const after = fs.existsSync(real) ? fs.readdirSync(real) : [];
  const missing = record.before.filter((name) => !after.includes(name) && !/-(wal|shm|journal)$/.test(name));
  const isolated = fs.existsSync(dataDirFor(suite));
  const ok = missing.length === 0 && (suite === "smoke" || isolated);
  fs.writeFileSync(file, JSON.stringify({ suite, ok, before: record.before, after, missing, isolatedDataDir: dataDirFor(suite), isolated }, null, 2));
  if (!ok) throw new Error(`G04 data guard failed: missing ${missing.join(", ") || "-"}; isolated=${isolated}`);
}
