import { expect, test } from "@playwright/test";
import { PORTFOLIO, mockMarket, open, resetStore, seed, watchErrors } from "./fixtures";

/** Layout, i18n, touch targets, keyboard, skins. Test titles start with requirement IDs (see tests/requirements.ts). */
test.beforeEach(() => resetStore());

test("C14 skin and language persist", async ({ page }) => {
  await open(page, "/");
  await page.locator(".shell-seg button", { hasText: "夜间" }).click();
  await page.locator("button", { hasText: /^中$/ }).click();
  await page.reload(); await page.waitForTimeout(800);
  expect(await page.locator("html").getAttribute("data-skin")).toBe("night");
  await expect(page.locator(".wpx-tools > div > nav")).toContainText("Research");
});

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
