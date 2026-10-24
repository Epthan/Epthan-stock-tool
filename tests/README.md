# Test framework

One command runs everything and writes one report:

| How | What runs | Time |
| --- | --- | --- |
| double-click `run-tests.bat` (Windows) | everything below incl. live data, then opens the report | 6–10 min |
| `npm run test:full` | lint, types, unit + coverage, audit, build, smoke, e2e, **live** | 6–10 min |
| `npm run test:all` | same without the live suite (no internet needed) | 5–8 min |
| `npm run test:quick` | lint, types, unit, audit (no browser) | < 1 min |
| `node scripts/run-tests.mjs --only=unit,e2e` | chosen stages | — |

Report: `test-results/report.html` (also `report.md`, `summary.json`). Exit code is 1 when anything failed.

## Layers

| Folder | Runner | What it checks | Market data |
| --- | --- | --- | --- |
| `tests/unit` | Vitest | calculations, tax, storage, price archive, parsing, error handling — plus code hygiene (no literal colours) | none / mocked |
| `tests/smoke` | Playwright | every page opens | mocked, market "down" |
| `tests/e2e` | Playwright | user flows by feature: `data`, `market`, `portfolio`, `trades`, `tax`, `resilience`, `ui`, `security` | mocked (deterministic) |
| `tests/live` | Playwright | real Yahoo answers: quotes, daily bars, overview, heatmap, FX, full analysis with a split and AUD, response times | real |

## Requirements and traceability

`tests/requirements.mjs` lists every requirement with an ID (A = calculations, B = data, C = features, T = tax & brokerage,
D = errors, E = UI, F = performance, G = security, H = accessibility, L = live data, I = build). Each test title starts with
the IDs it checks — `test("C04 chart range …")`, `describe("[A01] parcel …")`. The runner maps results back, so the report
shows every requirement as 通过 / 失败 / 未运行 / 无测试. Lint, types, build and the dependency audit are requirements too.

To add a test: add (or pick) a requirement ID, then start the test title with it.

## Safety

- Test servers use their own build folder (`.next-test`) and ports (3100 smoke, 3200 e2e, 3300 live), so a running
  `start-localhost.bat` (port 3000) keeps working.
- Each suite has its own data folder under `test-results/data-*`; e2e wipes only that folder between tests.
- A guard (requirement G04) records the files in your real `data/` folder before each browser suite and fails the run if
  any disappeared afterwards.
- The live suite only reads market data; it never writes your portfolios.
