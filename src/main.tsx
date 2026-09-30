// LifeOS — entry
import React, { Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import './ui/index.css';
import { SiteApp } from './site/SiteApp';

// Route-level code splitting: the productivity app (store, db, sync, pages)
// is a separate chunk. Public-site visitors never download it; app users
// fetch it on demand. The fallback paints the ink background instantly.
const AppRoot = lazy(() => import('./app/AppRoot'));

const root = createRoot(document.getElementById('root')!);

const path = window.location.pathname;
const hash = window.location.hash;

// The PUBLIC site: "/" (marketing homepage), /home (legacy alias), /about,
// /contact, /privacy, /terms, and a 404 for unknown paths.
// The app itself: /app (and /app/*), plus .html asset pages and #demo trials.
// Installed PWAs / Android & Windows shells point at /app — see the manifest
// start_url and vercel.json rewrites.
const isAppRoute =
  path === '/app' ||
  path.startsWith('/app/') ||
  path === '/index.html' ||
  path === '/download.html' ||
  path.includes('.html') ||
  hash.includes('demo');

if (isAppRoute) {
  root.render(
    <Suspense fallback={
      <div style={{
        position: 'fixed', inset: 0,
        background: 'radial-gradient(1200px 800px at 70% -10%, #1a0d0a 0%, #0a0a0c 55%, #08090b 100%)',
      }} aria-hidden="true" />
    }>
      <AppRoot />
    </Suspense>
  );
} else {
  root.render(<SiteApp />);
}

// Service-worker takeover: when a new SW purges caches and claims clients
// (sw-custom.js activate), reload once so users are never stuck on a stale
// bundle after a deploy. Guarded by sessionStorage so it can't loop.
try {
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.type === 'lifeos-sw-updated' && !sessionStorage.getItem('lifeos.swReloaded')) {
      sessionStorage.setItem('lifeos.swReloaded', '1');
      location.reload();
    }
  });
} catch { /* no SW support */ }
