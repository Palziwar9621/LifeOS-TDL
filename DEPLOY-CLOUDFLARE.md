# Deploying LifeOS to Cloudflare Pages

The app is a pure static SPA + PWA (backend is Supabase), so Cloudflare Pages
hosts it with zero functions. All deploy-time URLs (canonical links, sitemap,
robots.txt, download.html) are rewritten from the `VITE_SITE_URL` env var at
build time — see `scripts/prerender.mjs`.

## Option A — Git integration (recommended, same as Vercel)

1. Go to https://dash.cloudflare.com → **Workers & Pages → Create → Pages →
   Connect to Git** and pick `Palziwar9621/LifeOS-TDL`.
2. Build settings:
   - Framework preset: **None** (or Vite)
   - Build command: `npm run build`
   - Build output directory: `dist`
3. Environment variables (Production + Preview):
   - `VITE_SITE_URL` = `https://life-os.pages.dev` (adjust to your assigned
     subdomain, or set your custom domain here — see step 4)
   - `NODE_VERSION` = `20`
4. First deploy will land on `https://<project>.pages.dev`. If you own a
   custom domain, add it under the Pages project → **Custom domains** and set
   `VITE_SITE_URL` to `https://<your-domain>` so SEO files stay consistent.
5. Deploys now happen automatically on every push to `main`, same as Vercel.

## Option B — CLI (one-off deploys)

```bash
npx wrangler login
npm run deploy:cf     # = npm run build && npx wrangler pages deploy
```

## Files added for Cloudflare

- `public/_headers` — security headers + immutable caching for `/assets/*`
  (mirrors `vercel.json` headers)
- `public/_redirects` — `/home → /` 301, `/app → /index.html` SPA rewrite
  (mirrors `vercel.json` rewrites)
- `wrangler.toml` — Pages project config (`dist` output)

## Cutover checklist

- [ ] Deploy on Cloudflare and confirm `/app` boots, login works, delete a
      task, voice assistant works (mic permission prompt is per-origin!)
- [ ] **Supabase**: add the new origin to Auth → URL Configuration →
      Redirect URLs (and update Site URL if you cut over fully)
- [ ] **Google Search Console / sitemap**: resubmit the new sitemap URL
- [ ] **Installed Android app (TWA)**: it currently loads
      `https://life-os-tdl.vercel.app/app`. Do NOT delete the Vercel project
      until the APK is rebuilt with the new origin and re-hosted
      (`public/LifeOS.apk`). Best order: add a custom domain on Cloudflare,
      rebuild + re-sign the TWA pointing at it, publish, then retire Vercel.
- [ ] Keep both deployments running until step 4 is done; `VITE_SITE_URL`
      decides which origin the SEO files advertise.
