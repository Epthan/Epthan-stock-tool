# Security

Stock Tool is a single-user application meant to run on your own computer. It holds sensitive personal financial
data (trades, balances, dividends), so where and how you run it matters.

## Threat model

| Assumption | Consequence |
| --- | --- |
| **No authentication.** Anyone who can reach the server can read, change, back up or restore all data | Only expose it to people you trust with your portfolio |
| `start-localhost.bat` binds to `127.0.0.1` | Only this computer can connect |
| `start-phone.bat` binds to `0.0.0.0:3001` | Every device on the same network can connect. Use it only on a private network you control (home Wi-Fi), never on public, hotel or office Wi-Fi |
| Data is stored unencrypted in `data/` | Protect the computer with a login and disk encryption (BitLocker / FileVault). Store backups somewhere equally safe |
| Outbound traffic: Yahoo Finance (prices), Wikipedia (index membership for the heatmap), Google Fonts (loaded by the browser) | Requests contain ticker symbols and date ranges, never trades or balances |

Do **not** expose the app to the internet: no port forwarding, no tunnels, no reverse proxy without authentication
in front. If you need remote access, use a VPN to your home network or an authenticating proxy.

## What the app does to protect itself

- The storage API accepts only allow-listed keys, with values up to 5 MB each. Requests that aren't JSON are
  rejected.
- Writes based on stale data are refused (409) instead of overwriting.
- History snapshots make accidental or malicious changes recoverable, as long as the database file survives.
- Notes and tags are rendered as text, never as HTML. This is covered by an XSS test (G01).
- The test-only reset endpoint is disabled unless `STOCK_TOOL_TEST_MODE=1`.
- The test suites never touch the real `data/` folder. A guard (G04) fails the run if they do.
- The dependency audit runs with every test run. Any high or critical advisory in a runtime dependency fails the
  run (G03).

## Reporting a vulnerability

Please report security problems privately through GitHub's **Security → Report a vulnerability** on this repository,
rather than in a public issue. Include the steps to reproduce and the version (shown in the logo tooltip). You can
expect an answer within a week.
