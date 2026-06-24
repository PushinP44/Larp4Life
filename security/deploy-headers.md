# Production response headers (EdgeOne) — PENTEST F1

`<meta http-equiv>` covers the CSP for the offline bundle, but several headers are
**ignored inside `<meta>`** and MUST be set as real HTTP response headers on the
public origin (EdgeOne → Rules / Response Headers, or the WAF managed-headers).
Apply these to all `text/html` responses (the CSP can apply to all responses):

```
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self'; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
Permissions-Policy: geolocation=(), microphone=(), camera=(), interest-cohort=()
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Resource-Policy: same-origin
```

Notes
- `frame-ancestors 'none'` (CSP) + `X-Frame-Options: DENY` = anti-clickjacking (defense in depth across browsers).
- `nosniff` stops MIME-type sniffing of the JS modules / JSON.
- `Strict-Transport-Security` only meaningful over HTTPS (EdgeOne serves TLS) — forces HTTPS, blocks downgrade.
- Keep `script-src 'self'` with NO `'unsafe-inline'`/`'unsafe-eval'` — the bundle needs neither, and this is what neutralizes injected inline scripts.
- The dev `python -m http.server` sets none of these and must NOT be the public origin (PENTEST F6).

## Optional `_headers` file (Cloudflare/EdgeOne Pages-style static header config)
If the deploy target reads a `_headers` file at the site root, this is the equivalent — drop it next to `index.html`:

```
/*
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self'; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  Permissions-Policy: geolocation=(), microphone=(), camera=(), interest-cohort=()
  Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Resource-Policy: same-origin
```
