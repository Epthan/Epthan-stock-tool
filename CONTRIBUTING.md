# Contributing

Thanks for your interest! This is a personal project, but issues and pull requests are welcome.

## Setup

```bash
git clone <this repository>
cd stock-tool
npm install            # Node.js 22.13+ required (SQLite is built in)
npm run dev            # http://localhost:3000
```

Windows users can double-click `start-localhost.bat` instead.

## Before opening a pull request

```bash
npm run test:quick     # lint, types, unit tests, audit  (< 1 min)
npm run test:all       # + production build, smoke and end-to-end suites  (5–8 min)
```

CI runs `test:all` on every pull request. The live suite (`npm run test:full`) needs internet and is optional.

## Conventions

- **TypeScript everywhere.** Calculations live in `src/lib` as pure functions with unit tests. Components stay thin.
- **Every user-visible string is bilingual.** Write it as `text("English", "中文")`, or `zh ? "中文" : "English"`.
  Test E03 fails if the Chinese UI shows untranslated English.
- **Colours only through design tokens** (`--ui-*` in `src/app/theme.css`). Test E04 fails on literal colours in CSS.
- **No simulated prices shown as real.** When market data is unavailable, show an error state with retry, not a
  fallback number.
- **Money and tax logic must be explainable.** Document new formulas in [docs/METHODOLOGY.md](docs/METHODOLOGY.md)
  or [docs/TAX.md](docs/TAX.md), and cross-check them in a unit test against a hand-worked example or an
  independent implementation.
- **Tests are traceable.** Add or pick a requirement in `tests/requirements.mjs`, then start the test title with its
  ID (`test("C04 …")`, `describe("[A01] …")`). See [docs/TESTING.md](docs/TESTING.md).
- **Code, comments, commit messages and documentation are in English.**

## Project layout

```
src/app/            pages (/, /dashboard, /portfolio, /tax, /compare, /treemap) and API routes (src/app/api)
src/components/     React components
src/hooks/          use-portfolios (portfolio, trade and cash state)
src/lib/            calculations, tax, storage, market data access
tests/unit|smoke|e2e|live|docs   test layers (docs = README screenshots)
scripts/run-tests.mjs           test runner and report
analytics/          Power BI dataset export (npm run bi:export), DAX measures, report (.pbip) and theme
docs/               user guide, methodology, tax, data, architecture, testing
```

More detail: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Releases

Versions follow semantic versioning: a feature bumps MINOR, a fix bumps PATCH.

1. Run `npm run test:all` (and `npm run test:full` when market-data code changed).
2. Bump `version` in `package.json` and `package-lock.json`.
3. Add an entry at the top of [CHANGELOG.md](CHANGELOG.md).
4. Commit as `Release X.Y.Z: <summary>`, tag `vX.Y.Z`, and push with `--tags`.

If you changed the UI, regenerate the screenshots with `npm run build:test && npm run docs:screenshots`. They only use
the mocked market from the test fixtures, never real portfolio data.
