import fs from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { PORTFOLIO, at, mockMarket, resetStore, seed, watchErrors } from "./fixtures";


test.beforeEach(() => resetStore());

async function open(page: Page, path: string, opts: Parameters<typeof seed>[1] = {}, mock: Parameters<typeof mockMarket>[1] = {}) {
  await seed(page, opts);
  await mockMarket(page, mock);
  await page.goto(path);
  await page.waitForTimeout(1200);
}
const store = async (page: Page) => (await (await page.request.get("/api/store")).json()) as { updatedAt: string | null; data: Record<string, string> };
const portfolios = async (page: Page) => JSON.parse((await store(page)).data["stock-tool.portfolios.v1"] ?? "[]");

// ---------------- B. Data integrity ----------------
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
  expect(fs.existsSync("data/store.db")).toBe(true);
  expect((await (await page.request.get("/api/store/info")).json()).store.engine).toBe("sqlite");
});

// ---------------- C. Functional ----------------
test("C01/C02 market tabs remembered; index click opens research", async ({ page }) => {
  const errors = watchErrors(page);
  await open(page, "/");
  await page.locator(".wpx-tools > div > nav button", { hasText: "市场概览" }).click();
  await expect(page.locator(".mo-panel")).toBeVisible();
  await page.reload(); await page.waitForTimeout(1000);
  await expect(page.locator(".mo-panel")).toBeVisible();
  await page.locator(".mo-tile").first().click();
  await expect(page.locator(".wpx-tools > div > nav button[aria-pressed=true]")).toHaveText("个股研究");
  await expect(page.locator(".wpx-quote-title h2")).toHaveText("^GSPC");
  await page.locator("button.wpx-index").nth(1).click();
  await expect(page.locator(".wpx-quote-title h2")).toHaveText("^DJI");
  expect(errors).toEqual([]);
});

test("C03 search adds symbol; watch list add/remove persists", async ({ page }) => {
  await open(page, "/", { portfolio: false });
  const search = page.locator(".shell-search input, header input").first();
  await search.fill("JPM"); await search.press("Enter");
  await expect(page.locator(".wpx-quote-title h2")).toHaveText("JPM");
  await page.locator('summary[aria-label="添加到自选列表"]').click();
  await page.locator(".wp-watchlist-menu button").first().click();
  await expect(page.locator(".wpx-watch-symbol", { hasText: "JPM" })).toBeVisible();
  await page.waitForTimeout(1200);
  await page.reload(); await page.waitForTimeout(1500);
  await expect(page.locator(".wpx-watch-symbol", { hasText: "JPM" })).toBeVisible();
  await page.locator(".wpx-watch-row", { hasText: "JPM" }).locator(".wpx-watch-remove").click({ force: true });
  await expect(page.locator(".wpx-watch-symbol", { hasText: "JPM" })).toHaveCount(0);
});

test("C04 chart range / type / indicators", async ({ page }) => {
  const errors = watchErrors(page);
  await open(page, "/");
  for (const label of ["1Y", "1M", "6M"]) await page.locator(".wpx-research button", { hasText: new RegExp(`^${label}$`) }).first().click();
  await page.locator(".wpx-research button", { hasText: /^折线$/ }).click();
  await page.locator(".wpx-research button", { hasText: /^K 线$|^K线$/ }).first().click();
  await expect(page.locator(".wpx-research canvas").first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("C05 backtest with real trades overlay", async ({ page }) => {
  await open(page, "/");
  await page.locator(".wpx-tools > div > nav button", { hasText: "策略回测" }).click();
  await page.locator(".bt-run").click();
  await expect(page.locator(".bt-metrics")).toContainText("你的实际交易");
  await expect(page.locator(".bt-real")).toBeVisible(); // your equity line legend (shares held from before the window)
  await expect(page.locator(".bt-marker-legend small").nth(1)).toContainText("区间开始前已持有");
});

test("C06 dashboard: 6 views × ranges × benchmark, no errors", async ({ page }) => {
  const errors = watchErrors(page);
  await open(page, "/dashboard");
  await expect(page.locator(".rd-hero")).toBeVisible();
  await expect(page.locator(".rd-account")).toBeVisible();
  const views = page.locator(".pd-topbar nav button");
  for (let v = 0; v < 6; v++) {
    await views.nth(v).click();
    for (const range of ["1M", "1Y", "ALL"]) { await page.locator(".pd-segments button", { hasText: range }).click(); await page.waitForTimeout(150); }
    await expect(page.locator(".pd-content")).not.toContainText("这个页面出错了");
  }
  await page.locator(".pd-benchmark select").selectOption("^AXJO");
  await page.waitForTimeout(500);
  expect(errors).toEqual([]);
});

test("C08 trades: add with tags, edit, delete", async ({ page }) => {
  await open(page, "/portfolio");
  await page.getByRole("button", { name: /交易 · 1/ }).first().click(); // AAPL
  const dialog = page.locator("dialog.pm-trades-dialog");
  await dialog.locator('input[type="date"]').fill("2025-03-03");
  await dialog.locator('input[type="number"]').nth(0).fill("150");
  await dialog.locator('input[type="number"]').nth(1).fill("5");
  await dialog.locator(".pm-trade-tags button", { hasText: "抄底" }).click();
  await dialog.getByRole("button", { name: "保存交易" }).click();
  await expect(dialog.locator(".pm-trade-status")).toContainText("已保存");
  await dialog.getByRole("button", { name: "编辑", exact: true }).first().click();
  await dialog.locator('input[type="number"]').nth(1).fill("6");
  await dialog.getByRole("button", { name: "保存交易" }).click();
  await expect(dialog.locator(".pm-trade-status")).toContainText("已更新");
  await page.waitForTimeout(900);
  let trades = (await portfolios(page))[0].trades;
  expect(trades).toHaveLength(4);
  expect(trades.find((t: { quantity: number }) => t.quantity === 6).tags).toEqual(["dip"]);
  await dialog.getByRole("button", { name: "删除", exact: true }).first().click();
  await dialog.getByRole("button", { name: "确认删除" }).click();
  await page.waitForTimeout(900);
  trades = (await portfolios(page))[0].trades;
  expect(trades).toHaveLength(3);
});

test("C09/C11 cash: deposit, FX, dividend suggestions", async ({ page }) => {
  await open(page, "/portfolio");
  const form = page.locator(".cl-form");
  await form.locator("select").first().selectOption("dividend");
  await form.locator('input[type="date"]').fill("2025-01-02");
  await form.locator('input[type="number"]').first().fill("12.5");
  await form.getByRole("button", { name: "添加" }).click();
  await expect(page.locator(".tl-metrics-cash")).toContainText("12.50");
  // dividend suggestion from mocked corporate actions
  await expect(page.locator(".cl-suggest")).toBeVisible();
  await page.locator(".cl-suggest").getByRole("button", { name: "全部添加" }).click();
  await expect(page.locator(".cl-suggest")).toHaveCount(0);
  // switch to per-currency and add an FX conversion
  await page.locator(".tl-section-heading select").selectOption("local");
  await form.locator("select").first().selectOption("fx");
  await form.locator('input[type="number"]').nth(0).fill("1000");
  await form.locator(".cl-money").nth(1).locator("select").selectOption("AUD");
  await form.locator('input[type="number"]').nth(1).fill("1500");
  await form.getByRole("button", { name: "添加" }).click();
  await expect(page.locator(".tl-metrics-cash article").first()).toContainText("AUD 1,500.00");
});

test("C10 ledger currency switch", async ({ page }) => {
  const errors = watchErrors(page);
  await open(page, "/portfolio");
  await page.locator(".tl-select-small select").first().selectOption("AUD");
  await expect(page.locator(".tl-metrics").first()).toContainText("AUD");
  await expect(page.locator(".trade-ledger table").first()).toContainText("市值 AUD");
  expect(errors).toEqual([]);
});

test("C12 compare: rebased chart and table, view switch", async ({ page }) => {
  await open(page, "/compare");
  await expect(page.locator(".cmp-chart svg path").first()).toBeVisible();
  const returns = await page.locator(".pg-table tbody tr td:nth-child(4)").allTextContents();
  const values = returns.map((t) => parseFloat(t.replace("−", "-").replace("%", "")));
  expect([...values].sort((a, b) => b - a)).toEqual(values);
  await page.locator(".pg-seg button", { hasText: "分图" }).click();
  await expect(page.locator(".cmp-card")).toHaveCount(6);
});

test("C13 heatmap: index, holdings sizing, tooltip", async ({ page }) => {
  await open(page, "/treemap");
  await expect(page.locator(".tm-tile")).toHaveCount(6);
  await page.locator(".tm-tile").first().hover();
  await expect(page.locator(".tm-tip")).toBeVisible();
  await page.locator(".pg-field select").first().selectOption("portfolio:qa");
  await expect(page.locator(".pg-field select").nth(1)).toHaveValue("holding");
});

test("C14 skin and language persist", async ({ page }) => {
  await open(page, "/");
  await page.locator(".shell-seg button", { hasText: "夜间" }).click();
  await page.locator("button", { hasText: /^中$/ }).click();
  await page.reload(); await page.waitForTimeout(800);
  expect(await page.locator("html").getAttribute("data-skin")).toBe("night");
  await expect(page.locator(".wpx-tools > div > nav")).toContainText("Research");
});

// ---------------- D. Errors ----------------
test("D01 Yahoo down: every page degrades gracefully", async ({ page }) => {
  const errors = watchErrors(page);
  await seed(page); await mockMarket(page, { down: true });
  for (const path of ["/", "/dashboard", "/portfolio", "/compare", "/treemap"]) {
    await page.goto(path); await page.waitForTimeout(1500);
    await expect(page.locator("text=这个页面出错了")).toHaveCount(0);
  }
  await page.goto("/"); await page.waitForTimeout(1500);
  await expect(page.locator(".wpx-index-note")).toContainText("暂不可用");
  await page.goto("/dashboard"); await page.waitForTimeout(2500);
  await expect(page.locator(".ui-state-error")).toBeVisible();
  expect(errors).toEqual([]);
});

test("D03 empty states", async ({ page }) => {
  await seed(page, { portfolio: false }); await mockMarket(page);
  await page.goto("/portfolio"); await page.waitForTimeout(1000);
  await expect(page.locator(".tl-empty")).toBeVisible();
  await page.goto("/compare"); await page.waitForTimeout(800);
});

// ---------------- E / G / H. UI, security, a11y ----------------
for (const skin of ["gray", "gold", "night"]) for (const [label, viewport] of [["desk", { width: 1440, height: 900 }], ["phone", { width: 390, height: 844 }]] as const) {
  test(`E01/E02 ${skin}-${label}: no horizontal overflow, no console errors`, async ({ page }) => {
    const errors = watchErrors(page);
    await page.setViewportSize(viewport);
    await seed(page, { skin }); await mockMarket(page);
    const overflow: string[] = [];
    for (const path of ["/", "/dashboard", "/portfolio", "/compare", "/treemap"]) {
      await page.goto(path); await page.waitForTimeout(1300);
      const { sw, vw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, vw: document.documentElement.clientWidth }));
      if (sw > vw + 1) overflow.push(`${path}: ${sw} > ${vw}`);
    }
    expect(overflow).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test("E03 Chinese UI has no untranslated English", async ({ page }) => {
  await open(page, "/");
  const allow = /^(SPY|QQQ|DIA|IWM|AAPL|MSFT|NVDA|AMZN|JPM|XOM|META|TSLA|USD|AUD|ETF|VIX|MA\d*|YTD|ALL|\dY|\dM|\dD|\dW|5Y|10Y|MAX|K|β|ROE|Sharpe|Sortino|Calmar|Alpha|Profit|Factor|Yahoo|SPDR|XL[A-Z]+|RSP|IWD|IWF|BETA|CSV|TWR|XIRR|FIFO|HHI|Inc|NMS|Software|Technology|Energy|QA|Portfolio|bp|pp|R²|vs|n|S|B|S&P|Nasdaq|Dow|Jones|Russell|NYSE|WTI|GSPC|DJI|IXIC|RUT|TNX|IRX|FVX|TYX|NDX|NYA|SP400|IWM|Visual|Test|ASX|CNY|HKD|EUR|GBP|CAD|JPY|SGD|NZD|PORTFOLIO|SMA|OHLC|PE|AX|Consumer|Electronics|Buy|buy|dip|momentum|long-term|breakout|core|Smoke|Equity|Stock|Tool|Cmd|Lightweight|Charts|TradingView|TV|Value|Growth|IBKR|CommSec|Stake|SelfWealth|GBK|JSON|ETFs?)$/;
  const found = new Set<string>();
  for (const path of ["/", "/dashboard", "/portfolio", "/compare", "/treemap"]) {
    await page.goto(path); await page.waitForTimeout(1200);
    if (path === "/") for (const tab of ["市场概览", "策略回测"]) { await page.locator(".wpx-tools > div > nav button", { hasText: tab }).click(); await page.waitForTimeout(500); }
    const text = await page.evaluate(() => document.body.innerText + " " + [...document.querySelectorAll("[aria-label],[title],[placeholder]")].map((e) => `${e.getAttribute("aria-label") ?? ""} ${e.getAttribute("title") ?? ""} ${e.getAttribute("placeholder") ?? ""}`).join(" "));
    for (const word of text.match(/[A-Za-z][A-Za-z'’-]{2,}/g) ?? []) if (!allow.test(word)) found.add(`${path} ${word}`);
  }
  console.log("UNTRANSLATED:", [...found].join(" | "));
  expect.soft([...found]).toEqual([]);
});

test.describe("touch", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test("E05/H02 phone touch targets ≥ 40px; controls have names", async ({ page }) => {
    const small: string[] = [], unnamed: string[] = [];
    await seed(page); await mockMarket(page);
    for (const path of ["/", "/dashboard", "/portfolio", "/compare", "/treemap"]) {
      await page.goto(path); await page.waitForTimeout(1300);
      const result = await page.evaluate(() => [...document.querySelectorAll("button, a[href], summary, select")].filter((e) => (e as HTMLElement).offsetParent && (e as HTMLElement).getClientRects().length).map((e) => { const r = e.getBoundingClientRect(); const name = (e.getAttribute("aria-label") || e.textContent || e.getAttribute("title") || "").trim(); const inMenu = !!e.closest("details:not([open]) > :not(summary)"); return { text: name.slice(0, 20), h: Math.round(r.height), named: !!name, inMenu, inline: !!e.closest(".rd-sentence, .pd-calculation-note p, p") || /tradingview/i.test((e as HTMLAnchorElement).href ?? "") }; }));
      for (const r of result) { if (!r.inMenu && !r.inline && r.h < 40) small.push(`${path} "${r.text}" h=${r.h}`); if (!r.named) unnamed.push(path); }
    }
    console.log("SMALL:", small.join(" | "));
    expect(unnamed).toEqual([]);
    expect(small).toEqual([]);
  });
});

test("G01 notes and tags render as text (no XSS)", async ({ page }) => {
  await seed(page); await mockMarket(page);
  await page.addInitScript(() => {
    const raw = localStorage.getItem("stock-tool.portfolios.v1"); if (!raw || sessionStorage.getItem("xss")) return; sessionStorage.setItem("xss", "1");
    const list = JSON.parse(raw); list[0].trades[0].note = "<img src=x onerror=window.__pwned=1>"; list[0].trades[0].tags = ["<b>x</b>"]; localStorage.setItem("stock-tool.portfolios.v1", JSON.stringify(list));
  });
  await page.goto("/portfolio"); await page.waitForTimeout(1200);
  await expect(page.locator("text=<img src=x onerror=window.__pwned=1>")).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
});

test("H01 keyboard: tab through market page, focus visible, Enter activates", async ({ page }) => {
  await open(page, "/");
  const noOutline: string[] = [];
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press("Tab");
    const info = await page.evaluate(() => { const e = document.activeElement as HTMLElement; const s = getComputedStyle(e); return { tag: e.tagName, text: (e.innerText || e.getAttribute("aria-label") || "").slice(0, 20), visible: s.outlineStyle !== "none" && s.outlineWidth !== "0px" || s.boxShadow !== "none" }; });
    if (!info.visible) noOutline.push(`${info.tag} ${info.text}`);
  }
  console.log("NO-FOCUS-RING:", noOutline.join(" | "));
  expect.soft(noOutline).toEqual([]);
});

// ---------------- J. Tax, brokerage, storage (v2) ----------------
const audSigned = (value: number) => `${value > 0 ? "+" : "−"}${Math.abs(value).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

test("J01 tax report: FIFO CGT event in AUD, myTax labels, CSV export", async ({ page }) => {
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

test("J02 brokerage on a trade: linked fee entry, cost base / proceeds adjusted", async ({ page }) => {
  await open(page, "/portfolio");
  await page.getByRole("button", { name: /交易 · 2/ }).first().click();
  const dialog = page.locator("dialog.pm-trades-dialog");
  await dialog.locator("tr", { hasText: "卖出" }).getByRole("button", { name: "编辑" }).click();
  await dialog.getByLabel("佣金币种").selectOption("USD");
  await dialog.locator(".cl-money input").fill("9.50");
  await dialog.getByRole("button", { name: "保存交易" }).click();
  await expect(dialog.locator(".pm-fee")).toContainText("9.50");
  await page.waitForTimeout(1500);
  const fee = (await portfolios(page))[0].cash.find((entry: { tradeId?: string }) => entry.tradeId === "t3");
  expect(fee).toMatchObject({ kind: "fee", amount: 9.5, symbol: "NVDA" });
  await page.goto("/tax"); await page.waitForTimeout(1500);
  const proceeds = Math.round((10 * at("NVDA", 200) - 9.5) * 1.5 * 100) / 100;
  await expect(page.locator("tr", { hasText: "NVDA" }).first()).toContainText(proceeds.toLocaleString("en-AU", { minimumFractionDigits: 2 }));
  // Deleting the trade removes its brokerage too.
  await page.goto("/portfolio"); await page.waitForTimeout(800);
  await page.getByRole("button", { name: /交易 · 2/ }).first().click();
  await dialog.locator("tr", { hasText: "卖出" }).getByRole("button", { name: "删除" }).click();
  await dialog.getByRole("button", { name: "确认删除" }).click();
  await page.waitForTimeout(1500);
  expect((await portfolios(page))[0].cash.some((entry: { tradeId?: string }) => entry.tradeId === "t3")).toBe(false);
});

test("J03 dividend franking / withholding fields are stored", async ({ page }) => {
  await open(page, "/portfolio");
  const form = page.locator("form.cl-form");
  await form.locator("select").first().selectOption("dividend");
  await form.locator('input[type="date"]').fill("2024-11-15");
  await form.locator(".cl-money input").fill("85");
  await form.getByLabel("代码（可选）").fill("AAPL");
  await form.getByLabel("预扣税").fill("15");
  await form.getByRole("button", { name: "添加" }).click();
  await page.waitForTimeout(1500);
  expect((await portfolios(page))[0].cash.find((entry: { kind: string }) => entry.kind === "dividend")).toMatchObject({ amount: 85, withheld: 15, symbol: "AAPL" });
  await page.goto("/tax"); await page.waitForTimeout(1500);
  await expect(page.locator(".tax-labels tr", { hasText: "20O" })).toContainText("22.50"); // 15 USD × 1.5
});

test("J04 edit from a stale device is refused, newer data loaded, refused version restorable", async ({ page }) => {
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

test("J05 fill missing brokerage from a fee schedule (IBKR fixed)", async ({ page }) => {
  await open(page, "/portfolio");
  await page.getByRole("button", { name: "补佣金" }).click();
  const dialog = page.locator("dialog.bf-dialog");
  await dialog.locator("select").first().selectOption("ibkr-fixed");
  await expect(dialog.locator(".ci-counts")).toContainText("3 笔将补上");
  await dialog.getByRole("button", { name: "补上 3 笔" }).click();
  await expect(page.locator(".tl-notice", { hasText: "已为 3 笔交易补上佣金" })).toBeVisible();
  await page.waitForTimeout(1500);
  const fees = (await portfolios(page))[0].cash.filter((entry: { kind: string; tradeId?: string }) => entry.kind === "fee" && entry.tradeId);
  expect(fees.map((fee: { tradeId: string; amount: number; currency?: string }) => [fee.tradeId, fee.amount, fee.currency ?? "USD"]).sort()).toEqual([["t1", 1, "USD"], ["t2", 1, "USD"], ["t3", 1, "USD"]]);
  await page.goto("/tax"); await page.waitForTimeout(1500);
  await expect(page.locator(".tl-notice", { hasText: "没有记录佣金" })).toHaveCount(0);
});
