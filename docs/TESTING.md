# Testing

One command runs everything and writes one report:

| How | What runs | Time |
| --- | --- | --- |
| double-click `run-tests.bat` (Windows) | everything below incl. live data, then opens the report | 6–10 min |
| `npm run test:full` | lint, types, unit + coverage, audit, build, smoke, e2e, **live** | 6–10 min |
| `npm run test:all` | same without the live suite (no internet needed) | 5–8 min |
| `npm run test:quick` | lint, types, unit, audit (no browser) | < 1 min |
| `node scripts/run-tests.mjs --only=unit,e2e` | chosen stages | — |
| `node scripts/run-tests.mjs --lang=zh` | any of the above, report in Chinese (`run-tests.bat` does this) | — |

Report: `test-results/report.html` (also `report.md`, `summary.json`). Exit code is 1 when anything failed.

## Layers

| Folder | Runner | What it checks | Market data |
| --- | --- | --- | --- |
| `tests/unit` | Vitest | calculations, tax, storage, price archive, parsing, error handling — plus code hygiene (no literal colours) | none / mocked |
| `tests/smoke` | Playwright | every page opens | mocked, market "down" |
| `tests/e2e` | Playwright | user flows by feature: `data`, `market`, `portfolio`, `trades`, `tax`, `resilience`, `ui`, `security` | mocked (deterministic) |
| `tests/live` | Playwright | real Yahoo answers: quotes, daily bars, overview, heatmap, FX, full analysis with a split and AUD, response times | real |
| `tests/docs` | Playwright | regenerates the README screenshots in `docs/images` (not part of the run) | mocked |

## Requirements and traceability

`tests/requirements.mjs` lists every requirement with an ID (A = calculations, B = data, C = features, T = tax & brokerage,
D = errors, E = UI, F = performance, G = security, H = accessibility, L = live data, I = build). Each test title starts with
the IDs it checks — `test("C04 chart range …")`, `describe("[A01] parcel …")`. The runner maps results back, so the report
shows every requirement as passed / failed / not run / not covered. Lint, types, build and the dependency audit are
requirements too. Each requirement has an English `title` and a Chinese `zh` used by `--lang=zh`.

To add a test: add (or pick) a requirement ID, then start the test title with it.

## Safety

- Test servers use their own build folder (`.next-test`) and ports (3100 smoke, 3200 e2e, 3300 live), so a running
  `start-localhost.bat` (port 3000) keeps working.
- Each suite has its own data folder under `test-results/data-*`; e2e wipes only that folder between tests.
- A guard (requirement G04) records the files in your real `data/` folder before each browser suite and fails the run if
  any disappeared afterwards.
- The live suite only reads market data; it never writes your portfolios.

## Running single suites

The browser suites run against a production build in `.next-test`:

```bash
npm run build:test          # once after code changes
npm run test:smoke          # port 3100
npm run test:e2e            # port 3200
npm run test:live           # port 3300, needs internet
npm test                    # unit tests only (Vitest)
npm run docs:screenshots    # port 3400, rewrites docs/images/*.png
```

Set `PW_CHROMIUM=/path/to/chrome` to use an existing Chromium instead of Playwright's download.

## Continuous integration

`.github/workflows/ci.yml` runs `node scripts/run-tests.mjs` (everything except the live suite) on Ubuntu with
Node 22 for every push and pull request, and uploads `test-results/` (HTML report, coverage) as a build artifact.
The live suite is left out of CI because it depends on Yahoo's availability and rate limits.

## Writing tests

- Unit tests (`tests/unit`) compare against hand-worked examples or an independent
  re-implementation (for example `tests/unit/statistics.test.ts` re-derives Sharpe / beta from scratch).
- End-to-end tests use the deterministic market in `tests/e2e/fixtures.ts` (`open(page, url)` seeds the browser and
  mocks every `/api/market/*` route; `/api/store` is real but isolated). Most e2e tests run with the Chinese UI, so
  selectors use Chinese labels.
- Call `resetStore(request)` in `beforeEach` for a clean store.
