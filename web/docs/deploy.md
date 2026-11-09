# Deploy the page

The page is static: any host works. The one thing that matters is the **Content-Security-Policy**, because `connect-src 'none'` is what makes "your file is never uploaded" enforced by the browser rather than promised. Every build carries the policy in a `<meta>` tag, so even a plain file server enforces it. The options below also send it as an HTTP header, which adds `frame-ancestors 'none'` (anti-clickjacking).

Build first: `npm ci && npm run build:web` → `dist/`.

| Host | How | CSP as header |
|---|---|---|
| **GitHub Pages** | the repository's `pages` workflow (Settings → Pages → Source: GitHub Actions) | meta tag only |
| **Cloudflare Pages / Netlify** | build command `npm ci && npm run build:web`, output `dist` (root directory: this folder) | yes, via `dist/_headers` |
| **Docker** | `docker build -t gridanon-web .` then `docker run -p 8080:8080 gridanon-web` | yes, via `server.mjs` |
| **Railway / Fly / Render** | deploy this folder; `railway.json` uses the Dockerfile; health check `/healthz` | yes, via `server.mjs` |
| **Any VM / intranet** | `node server.mjs` (`PORT`, `DIST_DIR` env vars) | yes |
| **IIS / nginx / Apache** | copy `dist/` and add the header from `public/_headers` | if you add it |

`server.mjs` has zero dependencies: it serves `dist/` with the security headers, gzip, cache headers and a `/healthz` endpoint.

For machines with no network at all, skip hosting: hand out `gridanon-web.html` ([install.md](install.md)).
