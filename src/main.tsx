// LifeOS — entry
import React from 'react';
import { createRoot } from 'react-dom/client';
import './ui/index.css';
import { AppProvider } from './app/store';
import { App } from './app/App';
import { SiteApp } from './site/SiteApp';

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
    <AppProvider>
      <App />
    </AppProvider>
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
