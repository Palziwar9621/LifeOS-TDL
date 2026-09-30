# LifeOS — Full-Stack Audit Report (Phase 1 + Implementation Findings)

**Repo:** Palziwar9621/LifeOS-TDL (branch `main`) · **Live:** https://life-os-tdl.vercel.app · **Supabase:** `gzhqftvgvfqskatpqqie`
**Audit window:** Sept 2026 · Lead engineer pass over frontend, backend, edge functions, PWA, deployment.

---

## A. Baseline findings at audit start

| Area | Finding | Status at start |
|---|---|---|
| Framework | Vite + React + TypeScript SPA, local-first IndexedDB store with outbox sync to Supabase Postgres (RLS on all tables). PWA via vite-plugin-pwa (Workbox). Android TWA + Electron shells exist. | Healthy |
| Auth | Supabase email/password; session persisted in `lifeos.auth`; magic-link detection disabled (by design, PWA context). | Healthy |
| Sync | `db.ts` pull/flush with per-user cache under `<uid>:<table>`, realtime channel, offline outbox. | Healthy, 2 gaps found |
| Guest Mode | **Missing entirely.** | Implemented this pass |
| Account deletion | **Missing** (GDPR/DPDP compliance gap). | Implemented this pass |
| Public website / SEO | **Missing** — `/` served the app only; no marketing pages, no robots/sitemap, no OG tags. | Implemented this pass |
| ThreeUI Kage landing | Not integrated. | Implemented this pass |
| AI context | `buildAppContext` sent raw page params + unbounded row arrays to the assistant edge function (privacy + token cost). | Fixed |
| PWA precache | Package-root import of `@designcodeio/threeui` pulled `style.css` with inline base64 assets → Workbox precache over 2 MiB limit, build failed. | Fixed via subpath import + `globIgnores` |

## B. Root causes fixed (with evidence)

1. **Guest boot spinner-lock (2 bugs)**
   - *Concurrent init:* `continueAsGuest()` called `initStore(gid)` and the session-effect called it again → two concurrent `doInitStore` runs wiping shared state mid-init. Fix: `initPromise`/`lastInitUid` dedupe guard in `initStore` ([db.ts:110](src/lib/db.ts#L110)).
   - *Network guard staleness:* guest mode must never contact Supabase, but a module-load snapshot of the guest flag was `false` on the click path (flag written after module init), so `pull()`/`flush()` fired — and hung on unreachable endpoints, spinner-locking boot. Fix: `guestLocal()` re-read per call, OR'd into pull/flush/realtime guards ([db.ts:18-27](src/lib/db.ts#L18-L27)); dismissals sync blocked for guests via `dismissalsClient.ts`.

2. **Guest data loss on sign-out** — `signOut()` → `resetStore()` → `idbWipeUser(guest:<id>:)` deleted exactly the rows guest mode promises to keep ("data survives on this device"). Fix: `resetStore({ wipeCache })` — guest sign-out keeps the cache; account sign-out wipes as before ([db.ts:141](src/lib/db.ts#L141), [store.tsx:218](src/app/store.tsx#L218)). Verified E2E: guest rows survive sign-out, then migrate on sign-in.

3. **Migration race ("Not signed in")** — migration ran immediately after `signIn()` resolved, but store init (setting the store uid) runs later in the session effect. `migrateGuestData` bailed. Fix: bounded wait (≤5 s) for `currentUserId()` before copying ([store.tsx:271](src/app/store.tsx#L271)). Verified E2E via REST: guest task appeared in the account with correct `due_date`.

4. **Outbox cross-account leak** — `resetStore()` didn't clear the outbox; stale guest ops could flush into a different account. Fix: `await idbDel('outbox')` in `resetStore`.

## C. Guest data handling (design notes)

- Persistent per-browser guest id `guest:<uuid>` in localStorage; rows in IndexedDB under `guest:<id>:` prefix; zero server contact (verified: 0 supabase requests in a guest session).
- Sign-out keeps guest rows; returning to the auth screen and signing in/out later still migrates (`collectGuestSnapshot()` reads live store → per-guest IndexedDB cache → durable `guest-migration-backup`).
- Migration remaps ids across 16 tables in dependency order so relations (task→project, subtask→task, task_tags) survive; snapshot written before copying, cleared only on full success.

## D. Third-party bundle integrity (Kage / ThreeUI)

- `@designcodeio/threeui@1.2.0` (MIT) added as a real dependency; iframe-based `KageLandingPage` imported via subpath `@designcodeio/threeui/components/KageLandingPage`.
- Assets copied verbatim to `public/landing-pages/` and sha256-verified after copy: `kage.html` = `c8e06b90397ac246baf0ab6f32f5f6b570acc6fe03c7009f711b579fb72d9f49` (matches registered bundle), `three.min.js` = `8a5f7249…` (match), `fonts.css` = `985f85a9…` (match).
- **Caveat:** the npm package's TSX component files do not match the pinned prompt hashes — a different npm revision. The component exports and renders correctly (verified in browser); bytes under `public/landing-pages/` are the verified registered bundle and are never modified.

## E. Security posture

- RLS enforced on all tables; edge function `delete-account` derives the uid **only** from the verified JWT (`GET /auth/v1/user`), never from the request body; requires `SERVICE_ROLE_KEY` secret. E2E verified: user rows deleted, auth user revoked (`invalid_credentials` on re-login), other users' rows untouched, idempotent (404 = success).
- Security headers in `vercel.json`: `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy`, `Permissions-Policy` (mic self).
- Known limitation: Vite builds embed env vars at build time; anon key is public-by-design (RLS is the boundary). Service-role key only in edge function secrets, never bundled.

## F. Honest gaps (not fixed, by environment)

- **No Android device/emulator or Windows runtime** in this environment → platform-shell E2E (native alarms ring path, TWA install) untested; alarm ring logic untouched per standing rule.
- **Search Console / analytics** — no real property ID available; robots.txt + sitemap.xml shipped, verification pending the owner.
- **Legal copy** (Privacy/Terms) written factually but not lawyer-reviewed.
- **Assistant edge function context-min changes** written locally; must be redeployed (`npx supabase functions deploy assistant`) to take effect live.

## G. Files touched this pass (high level)

New: `src/lib/{site,guest,migrateGuest,deleteAccount}.ts`, `src/site/*` (public site), `src/lib/dismissalsClient.ts` (pre-existing, edited), `supabase/functions/delete-account/`, `vercel.json`, `public/robots.txt`, `public/sitemap.xml`, `public/landing-pages/` (verified bytes).
Edited: `src/main.tsx` (route split), `src/app/{Auth,store}.tsx`, `src/app/pages/SettingsPage.tsx`, `src/lib/{db,voice,supabase}.ts`-adjacent, `vite.config.ts`, `package.json`.

Full test evidence: [LifeOS-Test-Report.md](LifeOS-Test-Report.md).
