import fs from "node:fs";
import path from "node:path";

/** Records which files exist in the real ./data folder before a browser suite runs (checked again afterwards). */
export default function globalSetup() {
  const suite = process.env.STOCK_TOOL_TEST_SUITE ?? "e2e";
  const real = path.join(process.cwd(), "data");
  const files = fs.existsSync(real) ? fs.readdirSync(real) : [];
  fs.mkdirSync(path.join(process.cwd(), "test-results"), { recursive: true });
  fs.writeFileSync(path.join(process.cwd(), "test-results", `data-guard-${suite}.json`), JSON.stringify({ suite, before: files }, null, 2));
}
