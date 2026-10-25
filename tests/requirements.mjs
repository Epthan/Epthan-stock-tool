/**
 * Requirement catalog. Every test names the requirement(s) it checks at the start of its title
 * (e2e / smoke / live: `"C04 chart …"`; unit: `describe("[A01] …")`), and checks run by the test runner
 * itself (lint, types, build, audit) are listed under `stage`. scripts/run-tests.mjs maps results back to
 * this list, so the report shows each requirement as passed, failed, or not covered.
 *
 * `title` is English (default report); `zh` is used by `--lang=zh`.
 *
 * Add a requirement here first, then a test whose title starts with its ID.
 */
/** @typedef {"calc"|"data"|"func"|"tax"|"error"|"ui"|"perf"|"security"|"a11y"|"live"|"build"} Area */
/** @typedef {{ id: string, area: Area, title: string, zh: string, stage?: "lint"|"types"|"build"|"audit" }} Requirement */

/** @type {Record<Area, { en: string, zh: string }>} */
export const AREAS = {
  calc: { en: "Calculations", zh: "计算正确性" }, data: { en: "Data integrity", zh: "数据完整性" }, func: { en: "Features", zh: "功能" },
  tax: { en: "Tax & brokerage", zh: "税务与佣金" }, error: { en: "Error handling", zh: "异常处理" }, ui: { en: "UI", zh: "界面" },
  perf: { en: "Performance", zh: "性能" }, security: { en: "Security", zh: "安全" }, a11y: { en: "Accessibility", zh: "无障碍" },
  live: { en: "Live data", zh: "真实行情" }, build: { en: "Build & code quality", zh: "构建与代码质量" },
};

/** @type {Requirement[]} */
export const REQUIREMENTS = [
  // ---- Calculations ----
  { id: "A01", area: "calc", title: "Parcel (FIFO) holdings, cost base and realised P&L", zh: "按批次（FIFO）持仓、成本、已实现盈亏" },
  { id: "A02", area: "calc", title: "Time-weighted return is unaffected by top-ups", zh: "时间加权收益不受加仓影响" },
  { id: "A03", area: "calc", title: "Per-stock P&L contributions sum to period P&L", zh: "各股盈亏贡献之和 = 区间盈亏" },
  { id: "A04", area: "calc", title: "Dividends and fees count in holding returns", zh: "分红 / 费用计入持仓收益" },
  { id: "A05", area: "calc", title: "Account TWR includes idle cash; money-weighted return (XIRR)", zh: "账户 TWR 含闲置现金；资金加权收益（XIRR）" },
  { id: "A06", area: "calc", title: "No account return while cash is negative", zh: "现金为负时不给账户收益" },
  { id: "A07", area: "calc", title: "Split restatement (including multiple splits)", zh: "拆股重述（含多次拆股）" },
  { id: "A08", area: "calc", title: "Multi-currency: cost at trade-date FX, value at today's FX, conversions", zh: "多币种：成本按成交日汇率、市值按今日汇率、换汇" },
  { id: "A09", area: "calc", title: "FIFO tag attribution and holding-period buckets", zh: "FIFO 标签归因、持有周期分组" },
  { id: "A10", area: "calc", title: "Sharpe / Sortino / beta / max drawdown match an independent implementation", zh: "Sharpe / Sortino / β / 最大回撤与独立实现一致" },
  { id: "A11", area: "calc", title: "Chart drawings anchored to date + price, stable across timeframes", zh: "图表画线按日期 + 价格锚定，换周期位置不变" },
  { id: "A12", area: "calc", title: "Backtest: MA-cross signals fill at next open, fees, matches an independent simulation; real trade curve", zh: "策略回测：均线交叉信号次日开盘成交、手续费、与独立模拟一致；真实交易曲线" },
  // ---- Data ----
  { id: "B01", area: "data", title: "Trade validation: overselling, future dates and duplicate IDs rejected", zh: "交易校验：卖超持仓、未来日期、重复 ID 被拒" },
  { id: "B02", area: "data", title: "Server storage: first-run migration, data survives reload, key allow-list", zh: "服务器存储：首次迁移、刷新后数据仍在、白名单" },
  { id: "B03", area: "data", title: "Backup download / restore overwrite", zh: "备份下载 / 恢复覆盖" },
  { id: "B04", area: "data", title: "Invalid backup file rejected, data unchanged", zh: "恢复非法备份文件被拒，数据不变" },
  { id: "B05", area: "data", title: "CSV import: IBKR / CommSec / Chinese headers / de-duplication", zh: "CSV 导入：IBKR / CommSec / 中文表头 / 去重" },
  { id: "B06", area: "data", title: "CSV export then re-import is all duplicates", zh: "CSV 导出 → 再导入全部判为重复" },
  { id: "B07", area: "data", title: "Storage API: non-JSON returns 400, oversized values dropped", zh: "存储 API：非 JSON 返回 400，超大值丢弃" },
  { id: "B08", area: "data", title: "SQLite store: migrate store.json, reject stale revisions, restore snapshots", zh: "SQLite 存储：迁移 store.json、版本冲突拒绝、历史快照恢复" },
  { id: "B09", area: "data", title: "Local price archive: incremental download, full refetch on new split, offline fallback", zh: "本地价格存档：增量下载、新拆股全量重下、离线兜底" },
  // ---- Functional ----
  { id: "C01", area: "func", title: "Market page: three tabs switch and are remembered", zh: "行情页三个 tab 切换并记住" },
  { id: "C02", area: "func", title: "Index row click opens stock research", zh: "指数行点击 → 打开个股研究" },
  { id: "C03", area: "func", title: "Search stocks, add / remove watchlist, kept after reload", zh: "搜索股票、加入 / 删除自选，刷新保留" },
  { id: "C04", area: "func", title: "Chart range / type / moving-average toggles", zh: "图表周期 / 类型 / 均线切换" },
  { id: "C05", area: "func", title: "Strategy backtest with real trades overlaid", zh: "策略回测 + 叠加真实交易" },
  { id: "C06", area: "func", title: "Portfolio page: 6 views × ranges × benchmarks", zh: "组合页 6 个视图 × 区间 × 基准" },
  { id: "C08", area: "func", title: "Trades: add / edit / delete, tags", zh: "交易：新增 / 编辑 / 删除、标签" },
  { id: "C09", area: "func", title: "Cash ledger: deposits / FX conversions / dividends", zh: "现金账本：入金 / 换汇 / 分红" },
  { id: "C10", area: "func", title: "Ledger currency and settlement mode switching", zh: "账本币种与结算方式切换" },
  { id: "C11", area: "func", title: "Possibly missed dividends: add one / add all", zh: "可能漏记分红：单条 / 全部添加" },
  { id: "C12", area: "func", title: "Compare stocks: normalised chart, table, view switch", zh: "多股对比：归一化图、表格、视图切换" },
  { id: "C13", area: "func", title: "Heatmap: index / holdings, size basis, hover tooltip; constituent parsing", zh: "热力图：指数 / 持仓、大小口径、悬停提示；成分股解析" },
  { id: "C14", area: "func", title: "Theme and language switching, remembered", zh: "皮肤与语言切换并记住" },
  { id: "C15", area: "func", title: "Chart drawing: draw, select and delete, cleared on stock change / page leave", zh: "图表画线：画、选中删除、换股票 / 离开页面清除" },
  { id: "C16", area: "func", title: "Concurrent edits across devices: stale write rejected, reload latest, recoverable", zh: "多设备同时编辑：旧版本写入被拒、载入最新、可恢复" },
  // ---- Tax & brokerage ----
  { id: "T01", area: "tax", title: "Financial year and 12-month discount date rule", zh: "财年、12 个月折扣日期规则" },
  { id: "T02", area: "tax", title: "Capital gains: per parcel, 50% discount, losses against non-discount gains first, carry-forward", zh: "资本利得：按批次、50% 折扣、亏损先抵无折扣利得、结转" },
  { id: "T03", area: "tax", title: "Brokerage in cost base / deducted from proceeds; no guessing unlinkable brokerage", zh: "佣金计入成本 / 从卖出所得扣除；不猜测无法确认的佣金" },
  { id: "T04", area: "tax", title: "Dividends: franked / unfranked / credits, foreign dividends grossed up for withholding", zh: "分红：franked / unfranked / 抵免、外国分红加回预扣税" },
  { id: "T05", area: "tax", title: "Foreign-currency trades converted to AUD at trade-date rate", zh: "外币交易按成交日汇率折算 AUD" },
  { id: "T06", area: "tax", title: "Tax page: capital gains detail, myTax labels, CSV export", zh: "税务页：资本利得明细、myTax 栏目、CSV 导出" },
  { id: "T07", area: "tax", title: "Trade brokerage linked to a fee entry, deleted with the trade", zh: "交易佣金：关联费用记录，删除交易一并删除" },
  { id: "T08", area: "tax", title: "Bulk brokerage fill: IBKR / Stake / CommSec / custom rule", zh: "批量补佣金：IBKR / Stake / CommSec / 自定义规则" },
  { id: "T09", area: "tax", title: "Dividend franking / withholding fields saved and used on the tax page", zh: "分红 franking / 预扣税字段保存并进入税务页" },
  // ---- Errors ----
  { id: "D01", area: "error", title: "Pages don't crash when market data is down; message and retry", zh: "行情不可用时各页不崩溃，有提示和重试" },
  { id: "D02", area: "error", title: "Error classification and friendly messages; retry only transient failures", zh: "错误分类与友好提示；只重试临时故障" },
  { id: "D03", area: "error", title: "Empty states for empty portfolio / watchlist", zh: "空组合 / 空自选的空状态" },
  { id: "D04", area: "error", title: "Render errors show a fallback page", zh: "页面渲染异常有兜底页" },
  // ---- UI ----
  { id: "E01", area: "ui", title: "3 themes × desktop / mobile with no horizontal overflow", zh: "3 皮肤 × 桌面 / 手机 无横向溢出" },
  { id: "E02", area: "ui", title: "No console errors", zh: "无控制台错误" },
  { id: "E03", area: "ui", title: "Chinese UI has no untranslated English", zh: "中文界面不夹杂未翻译英文" },
  { id: "E04", area: "ui", title: "Colours come only from design tokens (no literal colours in CSS)", zh: "颜色只来自设计变量（CSS 无硬编码色值）" },
  { id: "E05", area: "ui", title: "Mobile touch targets ≥ 40px", zh: "手机端触控目标 ≥ 40px" },
  // ---- Performance (live) ----
  { id: "F01", area: "perf", title: "API latency: < 300 ms when cached, first portfolio analysis < 5 s", zh: "接口响应：缓存后 < 300ms，组合分析首次 < 5s" },
  { id: "F02", area: "perf", title: "First page render < 3 s", zh: "页面首屏 < 3s" },
  // ---- Security ----
  { id: "G01", area: "security", title: "Notes / tags don't execute scripts (XSS)", zh: "备注 / 标签不执行脚本（XSS）" },
  { id: "G02", area: "security", title: "Storage API accepts only allow-listed keys within size limits", zh: "存储 API 只接受白名单键与大小限制" },
  { id: "G03", area: "security", title: "No high / critical vulnerabilities in runtime dependencies (known exceptions listed)", zh: "运行时依赖无 high / critical 漏洞（已知例外单列）", stage: "audit" },
  { id: "G04", area: "security", title: "Tests never touch real data (./data unchanged)", zh: "测试不触碰真实数据（./data 前后一致）" },
  // ---- Accessibility ----
  { id: "H01", area: "a11y", title: "Main controls keyboard-operable with visible focus", zh: "主要控件可键盘操作、有可见焦点" },
  { id: "H02", area: "a11y", title: "Every button has an accessible name", zh: "按钮都有可读名称" },
  // ---- Live data (real Yahoo) ----
  { id: "L01", area: "live", title: "Live quotes: US / ASX / indices", zh: "实时报价：美股 / 澳股 / 指数" },
  { id: "L02", area: "live", title: "Daily bars: exchange-local dates, no partial bar, increasing time", zh: "日线：交易所本地日期、无未完成 K 线、时间递增" },
  { id: "L03", area: "live", title: "Market overview: indices, 11 sectors, macro", zh: "市场概览：大盘、11 个行业、宏观" },
  { id: "L04", area: "live", title: "Heatmap: S&P 100 / Nasdaq 100 constituents", zh: "热力图：标普 100 / 纳指 100 成分股" },
  { id: "L05", area: "live", title: "FX series USD/AUD", zh: "汇率序列 USD/AUD" },
  { id: "L06", area: "live", title: "Portfolio analysis end to end: real prices, NVDA split, AUD ledger", zh: "组合分析端到端：真实价格、NVDA 拆股、AUD 账本" },
  { id: "L07", area: "live", title: "Company profile, search, split / dividend events", zh: "公司资料、搜索、拆股 / 分红事件" },
  { id: "L08", area: "live", title: "Every real page opens without errors", zh: "真实页面全部能打开且无报错" },
  // ---- Build ----
  { id: "I01", area: "build", title: "ESLint passes with no errors", zh: "ESLint 无错误", stage: "lint" },
  { id: "I02", area: "build", title: "TypeScript type check (including tests)", zh: "TypeScript 类型检查（含测试代码）", stage: "types" },
  { id: "I03", area: "build", title: "Production build succeeds", zh: "生产构建成功", stage: "build" },
];
