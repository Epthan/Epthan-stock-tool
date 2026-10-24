#!/usr/bin/env node
/**
 * Stock Tool test runner — runs every check and writes one report.
 *
 *   node scripts/run-tests.mjs            lint, types, unit (+coverage), audit, build, smoke, e2e
 *   node scripts/run-tests.mjs --live     … plus the live suite against real Yahoo data (needs internet)
 *   node scripts/run-tests.mjs --quick    lint, types, unit, audit only (no build / browser)
 *   node scripts/run-tests.mjs --only=unit,e2e
 *
 * Output: test-results/report.html, report.md, summary.json. Exit code 1 when anything failed.
 * Test servers use .next-test and test-results/data-* — your ./data and a running `npm run dev` are untouched.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AREAS, REQUIREMENTS } from "../tests/requirements.mjs";

const root = process.cwd();
const out = path.join(root, "test-results");
const args = process.argv.slice(2);
const live = args.includes("--live");
const quick = args.includes("--quick");
const only = args.find((arg) => arg.startsWith("--only="))?.slice(7).split(",");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
fs.mkdirSync(out, { recursive: true });

const STAGES = [
  { id: "lint", label: "ESLint", cmd: "npx eslint . -f json -o test-results/eslint.json" },
  { id: "types", label: "TypeScript", cmd: "npx tsc --noEmit -p tsconfig.test.json" },
  { id: "unit", label: "Unit tests + coverage", cmd: "npx vitest run --reporter=default --reporter=json --outputFile.json=test-results/unit.json --coverage.enabled --coverage.provider=v8 --coverage.include=\"src/lib/**\" --coverage.reporter=json-summary --coverage.reportsDirectory=test-results/coverage" },
  { id: "audit", label: "Dependency audit", cmd: "npm audit --json", capture: "test-results/audit.json", allowFail: true },
  { id: "build", label: "Production build (.next-test)", cmd: "npx next build", env: { NEXT_DIST_DIR: ".next-test" }, browser: true },
  { id: "smoke", label: "Smoke (every page, mocked market)", cmd: "npx playwright test -c playwright.config.ts", browser: true },
  { id: "e2e", label: "Functional end-to-end (mocked market)", cmd: "npx playwright test -c playwright.qa.config.ts", browser: true },
  { id: "live", label: "Live (real Yahoo data)", cmd: "npx playwright test -c playwright.live.config.ts", browser: true, live: true },
];
const plan = STAGES.filter((stage) => (only ? only.includes(stage.id) : (!stage.live || live) && !(quick && stage.browser)));

function run(stage) {
  const started = Date.now();
  process.stdout.write(`\n▶ ${stage.label}\n  $ ${stage.cmd}\n`);
  const result = spawnSync(stage.cmd, { shell: true, cwd: root, env: { ...process.env, ...stage.env, FORCE_COLOR: "0" }, stdio: stage.capture ? ["ignore", "pipe", "inherit"] : "inherit", maxBuffer: 64 * 1024 * 1024 });
  if (stage.capture) fs.writeFileSync(path.join(root, stage.capture), result.stdout?.toString() ?? "");
  const seconds = (Date.now() - started) / 1000;
  process.stdout.write(`  ${result.status === 0 ? "✓" : "✗"} ${stage.label} (${seconds.toFixed(1)}s)\n`);
  return { id: stage.id, label: stage.label, exit: result.status ?? 1, seconds };
}

// Stale results from a previous run must not leak into this report.
for (const name of ["unit.json", "e2e.json", "smoke.json", "live.json", "eslint.json", "audit.json", "data-guard-e2e.json", "data-guard-smoke.json", "data-guard-live.json"]) fs.rmSync(path.join(out, name), { force: true });
const results = [];
for (const stage of plan) {
  const result = run(stage);
  results.push(result);
  if (stage.id === "build" && result.exit !== 0) { process.stdout.write("  build failed — skipping browser suites\n"); break; }
}

// ---------------------------------------------------------------- collect test cases
const read = (name) => { try { return JSON.parse(fs.readFileSync(path.join(out, name), "utf8")); } catch { return null; } };
const ids = (text) => [...new Set(text.match(/\b[A-Z]\d{2}\b/g) ?? [])].filter((id) => REQUIREMENTS.some((req) => req.id === id));
/** @type {{ suite: string, file: string, title: string, status: "passed"|"failed"|"skipped"|"flaky", ms: number, error?: string, ids: string[] }[]} */
const cases = [];
const unit = read("unit.json");
for (const file of unit?.testResults ?? []) for (const test of file.assertionResults ?? []) {
  const title = [...(test.ancestorTitles ?? []), test.title].join(" › ");
  cases.push({ suite: "unit", file: path.relative(root, file.name), title, status: test.status === "passed" ? "passed" : test.status === "failed" ? "failed" : "skipped", ms: test.duration ?? 0, error: test.failureMessages?.join("\n"), ids: ids(title) });
}
function walk(suite, node, file) {
  for (const spec of node.specs ?? []) for (const test of spec.tests ?? []) {
    const last = test.results?.at(-1);
    const status = test.status === "expected" ? "passed" : test.status === "flaky" ? "flaky" : test.status === "skipped" ? "skipped" : "failed";
    cases.push({ suite, file: spec.file ?? file, title: spec.title, status, ms: (test.results ?? []).reduce((sum, item) => sum + (item.duration ?? 0), 0), error: last?.error?.message ?? last?.errors?.map((item) => item.message).join("\n"), ids: ids(spec.title) });
  }
  for (const child of node.suites ?? []) walk(suite, child, child.file ?? file);
}
for (const suite of ["smoke", "e2e", "live"]) { const report = read(`${suite}.json`); for (const node of report?.suites ?? []) walk(suite, node, node.file); }

// ---------------------------------------------------------------- stage verdicts
const stageResult = (id) => results.find((item) => item.id === id);
const eslint = read("eslint.json");
const lintErrors = eslint ? eslint.reduce((sum, file) => sum + file.errorCount, 0) : null;
const audit = read("audit.json");
const vulns = Object.entries(audit?.vulnerabilities ?? {}).map(([name, info]) => ({ name, severity: info.severity, dev: !isRuntime(name), via: (info.via ?? []).map((via) => (typeof via === "string" ? via : via.title)).slice(0, 2).join("; ") }));
function isRuntime(name) {
  // A package is runtime when `npm ls --omit=dev` still lists it.
  const result = spawnSync(`npm ls ${name} --omit=dev --all --json`, { shell: true, cwd: root, stdio: ["ignore", "pipe", "ignore"] });
  try { return JSON.stringify(JSON.parse(result.stdout.toString()).dependencies ?? {}).includes(`"${name}"`); } catch { return true; }
}
const runtimeSevere = vulns.filter((item) => !item.dev && ["high", "critical"].includes(item.severity));
const guards = ["e2e", "smoke", "live"].map((suite) => read(`data-guard-${suite}.json`)).filter(Boolean);
const coverage = read("coverage/coverage-summary.json");

/** @type {Record<string, { status: "passed"|"failed"|"not run"|"not covered", tests: typeof cases, note?: string }>} */
const verdict = {};
for (const req of REQUIREMENTS) {
  const tests = cases.filter((item) => item.ids.includes(req.id));
  let status = "not covered", note;
  if (req.stage) {
    const stage = stageResult(req.stage);
    if (!stage) status = "not run";
    else if (req.stage === "lint") { status = stage.exit === 0 && lintErrors === 0 ? "passed" : "failed"; note = `${lintErrors ?? "?"} errors`; }
    else if (req.stage === "audit") { status = runtimeSevere.length ? "failed" : "passed"; note = `runtime high/critical: ${runtimeSevere.length}; dev-only: ${vulns.filter((item) => item.dev).length}`; }
    else status = stage.exit === 0 ? "passed" : "failed";
  } else if (req.id === "G04") {
    status = guards.length ? (guards.every((guard) => guard.ok) ? "passed" : "failed") : "not run";
    note = guards.map((guard) => `${guard.suite}: ${guard.ok ? "ok" : `missing ${guard.missing.join(", ")}`}`).join("; ");
  } else if (tests.length) {
    status = tests.some((item) => item.status === "failed") ? "failed" : tests.every((item) => item.status === "skipped") ? "not run" : "passed";
  } else if (req.area === "live" || ["F01", "F02"].includes(req.id)) status = stageResult("live") ? "not covered" : "not run";
  else if (!["unit", "smoke", "e2e"].every((suite) => stageResult(suite))) status = "not run"; // some suites were skipped this run
  verdict[req.id] = { status, tests, note };
}

// ---------------------------------------------------------------- write reports
const count = (status) => Object.values(verdict).filter((item) => item.status === status).length;
const totals = { requirements: REQUIREMENTS.length, passed: count("passed"), failed: count("failed"), notRun: count("not run"), notCovered: count("not covered"), tests: cases.length, testsFailed: cases.filter((item) => item.status === "failed").length, testsFlaky: cases.filter((item) => item.status === "flaky").length };
const ok = results.every((item) => item.exit === 0 || STAGES.find((stage) => stage.id === item.id)?.allowFail) && totals.failed === 0;
const meta = { app: `Stock Tool v${pkg.version}`, date: new Date().toISOString(), node: process.version, platform: `${os.type()} ${os.release()}`, live, quick, only: only ?? null };
fs.writeFileSync(path.join(out, "summary.json"), JSON.stringify({ ok, meta, totals, stages: results, requirements: Object.fromEntries(Object.entries(verdict).map(([id, item]) => [id, { status: item.status, tests: item.tests.length, note: item.note }])), vulnerabilities: vulns, coverage: coverage?.total ?? null }, null, 2));

/** The audit stage exits non-zero for any advisory; it only fails when a runtime dependency is high / critical (G03). */
const stageStatus = (item) => (item.id === "audit" ? verdict.G03.status : item.exit === 0 ? "passed" : "failed");
const label = { passed: "通过", failed: "失败", "not run": "未运行", "not covered": "无测试", flaky: "不稳定", skipped: "跳过" };
const pct = (value) => (value == null ? "—" : `${value.toFixed(1)}%`);
const md = [];
md.push(`# 测试报告 · ${meta.app}`, "", `${meta.date.replace("T", " ").slice(0, 19)} UTC · Node ${meta.node} · ${meta.platform}${live ? " · 含真实行情" : ""}`, "");
md.push(`**结论：${ok ? "全部通过" : "有失败项"}** — 需求 ${totals.requirements} 条：通过 ${totals.passed}，失败 ${totals.failed}，未运行 ${totals.notRun}，无测试 ${totals.notCovered}；测试用例 ${totals.tests} 个，失败 ${totals.testsFailed}${totals.testsFlaky ? `，不稳定 ${totals.testsFlaky}` : ""}。`, "");
md.push("## 阶段", "", "| 阶段 | 结果 | 用时 |", "| --- | --- | --- |", ...results.map((item) => `| ${item.label}${item.id === "audit" ? `（${verdict.G03.note}）` : ""} | ${label[stageStatus(item)]} | ${item.seconds.toFixed(1)}s |`), "");
md.push("## 按类别", "", "| 类别 | 需求 | 通过 | 失败 | 未运行 / 无测试 |", "| --- | --- | --- | --- | --- |");
for (const [area, name] of Object.entries(AREAS)) {
  const list = REQUIREMENTS.filter((req) => req.area === area).map((req) => verdict[req.id].status);
  md.push(`| ${name} | ${list.length} | ${list.filter((s) => s === "passed").length} | ${list.filter((s) => s === "failed").length} | ${list.filter((s) => s === "not run" || s === "not covered").length} |`);
}
md.push("", "## 逐条需求", "", "| ID | 需求 | 结果 | 测试 | 说明 |", "| --- | --- | --- | --- | --- |");
for (const req of REQUIREMENTS) { const item = verdict[req.id]; md.push(`| ${req.id} | ${req.title} | ${label[item.status]} | ${item.tests.length || (req.stage ? "阶段" : "—")} | ${item.note ?? (item.tests.filter((t) => t.status === "failed").map((t) => t.title).join("; ") || "")} |`); }
const failures = cases.filter((item) => item.status === "failed" || item.status === "flaky");
if (failures.length) { md.push("", "## 失败 / 不稳定的用例", ""); for (const item of failures) md.push(`### [${item.suite}] ${item.title}`, "", `\`${item.file}\` · ${label[item.status]}`, "", "```", (item.error ?? "").replace(/\u001b\[[0-9;]*m/g, "").slice(0, 1500), "```", ""); }
if (coverage) {
  md.push("", "## 计算代码覆盖率（src/lib）", "", `语句 ${pct(coverage.total.statements.pct)} · 分支 ${pct(coverage.total.branches.pct)} · 函数 ${pct(coverage.total.functions.pct)} · 行 ${pct(coverage.total.lines.pct)}`, "", "| 文件 | 行 | 分支 |", "| --- | --- | --- |");
  for (const [file, item] of Object.entries(coverage).filter(([file]) => file !== "total").sort((a, b) => a[1].lines.pct - b[1].lines.pct)) md.push(`| ${path.relative(root, file)} | ${pct(item.lines.pct)} | ${pct(item.branches.pct)} |`);
}
if (vulns.length) { md.push("", "## 依赖漏洞", "", "| 包 | 级别 | 范围 | 说明 |", "| --- | --- | --- | --- |", ...vulns.map((item) => `| ${item.name} | ${item.severity} | ${item.dev ? "仅开发" : "运行时"} | ${item.via.replace(/\|/g, "/")} |`)); }
md.push("", "## 全部用例", "", "| 套件 | 用例 | 结果 | 用时 |", "| --- | --- | --- | --- |", ...cases.map((item) => `| ${item.suite} | ${item.title.replace(/\|/g, "/")} | ${label[item.status]} | ${(item.ms / 1000).toFixed(1)}s |`));
fs.writeFileSync(path.join(out, "report.md"), md.join("\n") + "\n");

const esc = (text) => String(text ?? "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
const chip = (status) => `<span class="chip ${status.replace(" ", "-")}">${label[status] ?? status}</span>`;
const html = `<!doctype html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>测试报告 · ${esc(meta.app)}</title><style>
:root{--bg:#f5f6f8;--panel:#fff;--ink:#16202b;--muted:#5d6875;--line:#dde2e8;--ok:#0b7a55;--ok-bg:#e3f4ec;--bad:#b4322a;--bad-bg:#fbe7e5;--warn:#8a6100;--warn-bg:#fbf0d6;--off:#5d6875;--off-bg:#eceff3}
@media (prefers-color-scheme:dark){:root{--bg:#0f1318;--panel:#171c23;--ink:#e6ebf0;--muted:#9aa5b1;--line:#2a323c;--ok:#4cc597;--ok-bg:#163428;--bad:#f07a6e;--bad-bg:#3a1d1a;--warn:#e6c063;--warn-bg:#352b12;--off:#9aa5b1;--off-bg:#232a33}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.55 system-ui,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}main{max-width:1180px;margin:0 auto;padding:24px 16px 60px}
h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:28px 0 10px}.muted{color:var(--muted)}.panel{background:var(--panel);border:1px solid var(--line);border-radius:10px;overflow:auto}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-top:16px}.card{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:12px 14px}.card b{display:block;font-size:24px;font-variant-numeric:tabular-nums}
table{border-collapse:collapse;width:100%;font-size:13px}th,td{text-align:left;padding:7px 10px;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--muted);font-weight:600;position:sticky;top:0;background:var(--panel)}td.num{font-variant-numeric:tabular-nums;white-space:nowrap}
.chip{display:inline-block;padding:1px 8px;border-radius:999px;font-size:12px;font-weight:600;white-space:nowrap}.passed{color:var(--ok);background:var(--ok-bg)}.failed{color:var(--bad);background:var(--bad-bg)}.flaky{color:var(--warn);background:var(--warn-bg)}.not-run,.not-covered,.skipped{color:var(--off);background:var(--off-bg)}
.verdict{display:inline-block;margin-top:12px;padding:6px 12px;border-radius:8px;font-weight:700}pre{white-space:pre-wrap;font-size:12px;margin:6px 0 0;color:var(--muted)}details summary{cursor:pointer}
</style></head><body><main>
<h1>测试报告 · ${esc(meta.app)}</h1><div class="muted">${esc(meta.date.replace("T", " ").slice(0, 19))} UTC · Node ${esc(meta.node)} · ${esc(meta.platform)}${live ? " · 含真实行情" : ""}</div>
<div class="verdict ${ok ? "passed" : "failed"}">${ok ? "全部通过" : "有失败项"}</div>
<div class="cards"><div class="card">需求<b>${totals.requirements}</b></div><div class="card">通过<b style="color:var(--ok)">${totals.passed}</b></div><div class="card">失败<b style="color:var(--bad)">${totals.failed}</b></div><div class="card">未运行 / 无测试<b>${totals.notRun + totals.notCovered}</b></div><div class="card">测试用例<b>${totals.tests}</b></div>${coverage ? `<div class="card">src/lib 行覆盖<b>${pct(coverage.total.lines.pct)}</b></div>` : ""}</div>
<h2>阶段</h2><div class="panel"><table><tr><th>阶段</th><th>结果</th><th>用时</th></tr>${results.map((item) => `<tr><td>${esc(item.label)}${item.id === "audit" ? `<div class="muted">${esc(verdict.G03.note ?? "")}</div>` : ""}</td><td>${chip(stageStatus(item))}</td><td class="num">${item.seconds.toFixed(1)}s</td></tr>`).join("")}</table></div>
<h2>逐条需求</h2><div class="panel"><table><tr><th>ID</th><th>类别</th><th>需求</th><th>结果</th><th>测试</th><th>说明</th></tr>${REQUIREMENTS.map((req) => { const item = verdict[req.id]; return `<tr><td class="num">${req.id}</td><td>${esc(AREAS[req.area])}</td><td>${esc(req.title)}</td><td>${chip(item.status)}</td><td class="num">${item.tests.length ? `<details><summary>${item.tests.length}</summary>${item.tests.map((test) => `<div>${chip(test.status)} <span class="muted">${test.suite}</span> ${esc(test.title)}</div>`).join("")}</details>` : req.stage ? "阶段" : "—"}</td><td>${esc(item.note ?? "")}</td></tr>`; }).join("")}</table></div>
${failures.length ? `<h2>失败 / 不稳定的用例</h2><div class="panel"><table>${failures.map((item) => `<tr><td>${chip(item.status)} <b>${esc(item.title)}</b><div class="muted">${item.suite} · ${esc(item.file)}</div><pre>${esc((item.error ?? "").replace(/\u001b\[[0-9;]*m/g, "").slice(0, 2000))}</pre></td></tr>`).join("")}</table></div>` : ""}
${coverage ? `<h2>计算代码覆盖率（src/lib）</h2><div class="muted">语句 ${pct(coverage.total.statements.pct)} · 分支 ${pct(coverage.total.branches.pct)} · 函数 ${pct(coverage.total.functions.pct)} · 行 ${pct(coverage.total.lines.pct)}</div><div class="panel" style="margin-top:8px;max-height:420px"><table><tr><th>文件</th><th>行</th><th>分支</th></tr>${Object.entries(coverage).filter(([file]) => file !== "total").sort((a, b) => a[1].lines.pct - b[1].lines.pct).map(([file, item]) => `<tr><td>${esc(path.relative(root, file))}</td><td class="num">${pct(item.lines.pct)}</td><td class="num">${pct(item.branches.pct)}</td></tr>`).join("")}</table></div>` : ""}
${vulns.length ? `<h2>依赖漏洞</h2><div class="panel"><table><tr><th>包</th><th>级别</th><th>范围</th><th>说明</th></tr>${vulns.map((item) => `<tr><td>${esc(item.name)}</td><td>${esc(item.severity)}</td><td>${item.dev ? "仅开发" : "运行时"}</td><td>${esc(item.via)}</td></tr>`).join("")}</table></div>` : ""}
<h2>全部用例（${cases.length}）</h2><div class="panel" style="max-height:600px"><table><tr><th>套件</th><th>用例</th><th>结果</th><th>用时</th></tr>${cases.map((item) => `<tr><td>${item.suite}</td><td>${esc(item.title)}</td><td>${chip(item.status)}</td><td class="num">${(item.ms / 1000).toFixed(1)}s</td></tr>`).join("")}</table></div>
</main></body></html>`;
fs.writeFileSync(path.join(out, "report.html"), html);

process.stdout.write(`\n${ok ? "✓ 全部通过" : "✗ 有失败项"} — 需求 ${totals.passed}/${totals.requirements} 通过，失败 ${totals.failed}，未运行 ${totals.notRun}，无测试 ${totals.notCovered}；用例 ${totals.tests} 个，失败 ${totals.testsFailed}\n报告：${path.join(out, "report.html")}\n`);
process.exit(ok ? 0 : 1);
