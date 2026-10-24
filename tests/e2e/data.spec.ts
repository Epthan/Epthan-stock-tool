import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { PORTFOLIO, open, portfolios, resetStore, store } from "./fixtures";
import { dataDirFor } from "../support/servers";

/** Data integrity: validation, store, backup / restore, CSV round trip, multi-device sync. Test titles start with requirement IDs (see tests/requirements.ts). */
test.beforeEach(async ({ request }) => { await resetStore(request); });

test("B01 trade validation rejects oversell, future date", async ({ page }) => {
  await open(page, "/portfolio");
  await page.getByRole("button", { name: /交易 · 2/ }).first().click(); // NVDA row → editor
  const dialog = page.locator("dialog.pm-trades-dialog");
  await dialog.locator("select").first().selectOption("sell");
  await dialog.locator('input[type="date"]').fill("2024-03-01");
  await dialog.locator('input[type="number"]').nth(0).fill("100");
  await dialog.locator('input[type="number"]').nth(1).fill("999");
  await dialog.getByRole("button", { name: "保存交易" }).click();
  await expect(dialog.locator(".pm-error")).toBeVisible();
  await dialog.locator('input[type="number"]').nth(1).fill("1");
  await dialog.locator('input[type="date"]').fill("2999-01-01");
  await dialog.getByRole("button", { name: "保存交易" }).click();
  await expect(dialog.locator(".pm-error")).toContainText(/日期/);
  await page.waitForTimeout(900);
  expect((await portfolios(page))[0].trades).toHaveLength(3);
});

test("B02 store: first-run migration, persistence, whitelist", async ({ page }) => {
  await open(page, "/portfolio");
  await page.waitForTimeout(1000);
  const first = await store(page);
  expect(first.updatedAt).not.toBeNull();
  expect(JSON.parse(first.data["stock-tool.portfolios.v1"])[0].id).toBe("qa");
  const put = await page.request.put("/api/store", { data: { data: { "evil.key": "x", "stock-tool.active-portfolio.v1": "qa" } } });
  expect((await put.json()).keys).not.toContain("evil.key");
  await page.reload(); await page.waitForTimeout(1200);
  await expect(page.locator(".tl-metrics").first()).toContainText("3");
});

test("B03/B04 backup download and restore; invalid file rejected", async ({ page }) => {
  await open(page, "/portfolio");
  await page.waitForTimeout(1000);
  const download = page.waitForEvent("download");
  await page.getByText("备份数据").click();
  const file = await (await download).path();
  const backup = JSON.parse(fs.readFileSync(file!, "utf8"));
  expect(backup.app).toBe("stock-tool");
  // change data, then restore
  await page.request.put("/api/store", { data: { data: { "stock-tool.portfolios.v1": JSON.stringify([{ ...PORTFOLIO, trades: [] }]) } } });
  page.on("dialog", (d) => d.accept());
  await page.locator('label:has-text("恢复备份") input[type=file]').setInputFiles(file!);
  await page.waitForTimeout(2500);
  expect((await portfolios(page))[0].trades).toHaveLength(3);
  // invalid file
  const before = (await store(page)).data;
  let alerted = "";
  page.removeAllListeners("dialog"); page.on("dialog", (d) => { alerted = d.message(); d.accept(); });
  await page.locator('label:has-text("恢复备份") input[type=file]').setInputFiles({ name: "bad.json", mimeType: "application/json", buffer: Buffer.from('{"hello":1}') });
  await page.waitForTimeout(800);
  expect(alerted).toMatch(/无法读取/);
  expect((await store(page)).data).toEqual(before);
});

test("B06 CSV export → import round trip is all duplicates", async ({ page }) => {
  await open(page, "/portfolio");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 CSV" }).click();
  const csv = fs.readFileSync((await (await download).path())!, "utf8");
  expect(csv.split("\n")).toHaveLength(4);
  await page.getByRole("button", { name: "导入 CSV" }).click();
  await page.locator(".ci-dialog input[type=file]").setInputFiles({ name: "x.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await expect(page.locator(".ci-counts")).toContainText("3 条重复");
  await expect(page.locator(".ci-actions .tl-primary")).toBeDisabled();
});

test("B07/G02 store API: bad JSON → 400, oversized value dropped, file intact", async ({ page }) => {
  await open(page, "/portfolio"); await page.waitForTimeout(800);
  const bad = await page.request.put("/api/store", { headers: { "Content-Type": "application/json" }, data: Buffer.from("{not json") });
  expect(bad.status()).toBe(400);
  const big = await page.request.put("/api/store", { data: { data: { "stock-tool.active-portfolio.v1": "x".repeat(5_100_000) } } });
  expect((await big.json()).keys).toContain("stock-tool.portfolios.v1");
  expect((await store(page)).data["stock-tool.active-portfolio.v1"]?.length ?? 0).toBeLessThan(5_000_001);
  expect(fs.existsSync(path.join(dataDirFor("e2e"), "store.db"))).toBe(true);
  expect(fs.existsSync(path.join(process.cwd(), "data", "store.db.e2e-marker"))).toBe(false);
  expect((await (await page.request.get("/api/store/info")).json()).store.engine).toBe("sqlite");
});

test("C16 edit from a stale device is refused, newer data loaded, refused version restorable", async ({ page }) => {
  await open(page, "/portfolio");
  await page.waitForTimeout(1500); // first pull + migration push done
  // Another device saves first.
  const server = (await (await page.request.get("/api/store")).json()) as { data: Record<string, string>; revs: Record<string, number> };
  const key = "stock-tool.portfolios.v1";
  const other = JSON.parse(server.data[key]); other[0].name = "Other device";
  const saved = await page.request.put("/api/store", { data: { data: { [key]: JSON.stringify(other) }, revs: { [key]: server.revs[key] } } });
  expect(saved.status()).toBe(200);
  // This browser edits on top of the old revision.
  const form = page.locator("form.cl-form");
  await form.locator(".cl-money input").fill("123.45");
  await form.getByRole("button", { name: "添加" }).click();
  await expect(page.locator(".sync-conflict")).toBeVisible({ timeout: 5000 });
  await expect(page.locator(".tl-eyebrow")).toContainText("Other device");
  expect((await portfolios(page))[0].name).toBe("Other device");
  // Restore the refused edit from the history.
  await page.getByRole("button", { name: "历史版本" }).click();
  const row = page.locator(".sync-history tr", { hasText: "被拒绝的修改" }).first();
  await row.getByRole("button", { name: "恢复" }).click();
  await row.getByRole("button", { name: "确认恢复" }).click();
  await page.waitForLoadState("load"); await page.waitForTimeout(1500);
  expect((await portfolios(page))[0].cash.some((entry: { amount: number }) => entry.amount === 123.45)).toBe(true);
  const history = (await (await page.request.get("/api/store/snapshots")).json()).snapshots as { reason: string }[];
  expect(history.some((item) => item.reason === "before-restore")).toBe(true);
});
