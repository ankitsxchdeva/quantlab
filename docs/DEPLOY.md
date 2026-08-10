# Deploying

quantlab splits in two, because GitHub Pages can only serve static files and
this app needs a server to call LLM providers, Yahoo Finance and Kalshi.

```
GitHub Pages (static UI)        Tailscale Funnel          home server
ankitsxchdeva.github.io  ──────▶ raspberrypi...ts.net ──▶  quantlab container
        /quantlab/                :10000/quantlab           host 8002 → :3000
```

Local `npm run dev` is unaffected: `NEXT_PUBLIC_API_BASE` is unset, so the UI
calls `/api/*` on its own origin exactly as before.

## 1. The API, on the home server

Lives in [ankitsxchdeva/home-server](https://github.com/ankitsxchdeva/home-server)
under `quantlab/`. That compose file builds this repo's `Dockerfile` straight
from GitHub, so there is no vendored copy of the source.

Port 3000 on that box already belongs to the homepage dashboard, so the
container listens on 3000 and the host publishes 8002.

## 2. The tunnel

Tailscale Funnel, which already publishes two other GitHub Pages sites from
that box. It offers only ports 443, 8443 and 10000: 8443 and 10000 are taken,
and 443 cannot be funneled at all because Caddy binds `0.0.0.0:443`, covering
the tailnet address tailscaled would need. So quantlab path-mounts onto the
:10000 funnel alongside kalshi-pnl:

```bash
sshhome
cd ~/home-server && docker compose up -d --build quantlab
sudo tailscale funnel --bg --https=10000 --set-path=/quantlab http://127.0.0.1:8002
```

`/` on :10000 stays kalshi-pnl; `/quantlab` is this app. The mount strips its
own prefix, so the container sees `/api/run` — no server-side basePath needed.

The funnel is tailscaled state, not Docker state: it outlives
`docker compose down` but is not recreated by a rebuild.

A cleaner arrangement (its own hostname via a Cloudflare Tunnel, so it does not
share a port and bandwidth with kalshi-pnl) is deferred, not rejected.

## 3. The UI, on GitHub Pages

`.github/workflows/pages.yml` deploys on every push to `main`.

1. Repo → Settings → Pages → Source: **GitHub Actions**.
2. Repo → Settings → Secrets and variables → Actions → Variables → new
   repository variable `API_BASE` =
   `https://raspberrypi.tail9476fb.ts.net:10000/quantlab`.

Without `API_BASE` the site builds and renders, but every run fails: it will be
calling `/api/run` on `github.io`, where nothing is listening.

### Why the build is not just `next build`

`output: "export"` refuses to build POST route handlers, and both of ours are
POST. `npm run build:static` moves `src/app/api` aside for the duration of the
export and restores it afterwards. It also writes `out/.nojekyll`, without which
Pages' Jekyll step silently drops the `_next` directory and the whole site 404s
on its own JavaScript.

`basePath` is `/quantlab` for the project-site URL. On a custom domain, set the
`PAGES_BASE_PATH` env var to an empty string.

## 4. CORS

The API only answers browsers whose `Origin` is on `ALLOWED_ORIGINS` (set in the
home-server compose file). Add any new UI origin there or the browser will
discard otherwise-successful responses.

This bounds other *websites*, not other *clients* — CORS is enforced in the
browser, so it does nothing against curl. What actually bounds abuse is the
per-IP rate limiting already in both routes: 10/min on `/api/run`, 6/min on
`/api/arb`. Neither route stores an API key; `/api/run` forwards the caller's
key to their chosen provider and forgets it.

## Pointing the deployed UI somewhere else

The baked-in origin can be overridden per-browser without a rebuild — useful for
testing against a laptop:

```js
localStorage.setItem("quantlab.apiBase", "http://localhost:3000")
```

Remove the key to go back to the deployed API.
