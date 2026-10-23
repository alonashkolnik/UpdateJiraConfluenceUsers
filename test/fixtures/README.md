Test-only TLS material for the Electron tests. Never used by the app.

- `allowlisted.*` — certificate the test launcher tells Chromium to accept via
  `--ignore-certificate-errors-spki-list` (`allowlisted.spki` is its SPKI hash),
  so the mock instances can serve working HTTPS.
- `self-signed.*` — untrusted certificate; the certificate tests expect the app
  to reject it (or ask, for a Data Center host).
