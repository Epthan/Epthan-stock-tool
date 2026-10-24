import fs from "node:fs";
import { expect, test } from "@playwright/test";
import { at, audSigned, open, resetStore, watchErrors } from "./fixtures";

/** Australian tax report. Test titles start with requirement IDs (see tests/requirements.ts). */
test.beforeEach(() => resetStore());

test("T06 tax report: FIFO CGT event in AUD, myTax labels, CSV export", async ({ page }) => {
  const errors = watchErrors(page);
  await open(page, "/tax");
  await expect(page.locator("h1")).toContainText("2024–25");
  const gain = Math.round(10 * (at("NVDA", 200) - at("NVDA", 40)) * 1.5 * 100) / 100; // USD → AUD at the mocked 1.5
  const row = page.locator("tr", { hasText: "NVDA" }).first();
  await expect(row).toContainText(audSigned(gain));
  await expect(row.locator("td").last()).toContainText(gain > 0 ? "否" : "—"); // held < 12 months
  await expect(page.locator(".tax-labels")).toContainText("18H");
  await expect(page.locator(".tl-notice", { hasText: "没有记录佣金" })).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /导出 CSV/ }).click();
  const csv = fs.readFileSync((await (await download).path())!, "utf8");
  expect(csv).toContain("Net capital gain (18A)");
  expect(csv).toContain("NVDA");
  expect(errors).toEqual([]);
});
