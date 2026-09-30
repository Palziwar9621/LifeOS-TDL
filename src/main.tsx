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

// The app itself: /app, the legacy root "/" (existing bookmarks, installed
// PWAs, Android/Windows shells), and any .html asset page (#demo trials).
// Everything else is the public marketing site (/, /about, /contact,
// /privacy, /terms, and a 404 for unknown paths).
const isAppRoute =
  path === '/' ||
  path === '/app' ||
  path.startsWith('/app/') ||
  path === '/index.html' ||
  path === '/download.html' ||
  path.includes('.html') ||
  hash.includes('demo');

const PUBLIC_PATHS = ['/home', '/about', '/contact', '/privacy', '/terms'];

if (isAppRoute || !PUBLIC_PATHS.some((p) => path === p || path.startsWith(p + '/'))) {
  root.render(
    <AppProvider>
      <App />
    </AppProvider>
  );
} else {
  root.render(<SiteApp />);
}
