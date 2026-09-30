// LifeOS — public site entry: path-based router for marketing/legal pages.
// Mounted from main.tsx. App routes (/app, #demo) hand off to the app shell.
import React, { useEffect, useState } from 'react';
import { HomePage } from './HomePage';
import { AboutPage, ContactPage, PrivacyPage, TermsPage, FaqPage, NotFoundPage } from './InfoPages';

function isAppRoute(pathname: string): boolean {
  return pathname === '/app' || pathname.startsWith('/app/');
}

export function SiteApp() {
  const [path, setPath] = useState(() => window.location.pathname);

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPop);
    // Intercept in-site link clicks for SPA navigation (keeps Kage state intact)
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement).closest('a');
      if (!a) return;
      const href = a.getAttribute('href') ?? '';
      if (!href.startsWith('/') || href.startsWith('//') || a.target || a.hasAttribute('download')) return;
      const url = new URL(href, window.location.origin);
      // Only public React routes are SPA navigations. Static downloads must load normally.
      if (!['/', '/home', '/about', '/contact', '/privacy', '/terms', '/faq'].includes(url.pathname.replace(/\/+$/, '') || '/')) return;
      e.preventDefault();
      window.history.pushState({}, '', href);
      setPath(url.pathname);
      window.scrollTo(0, 0);
    };
    document.addEventListener('click', onClick);
    return () => { window.removeEventListener('popstate', onPop); document.removeEventListener('click', onClick); };
  }, []);

  if (isAppRoute(path)) return null; // main.tsx mounts the app shell instead

  const clean = path.replace(/\/+$/, '') || '/';
  switch (clean) {
    // "/" is the public homepage; /home kept as a legacy alias so old
    // bookmarks and previously-shared links don't break.
    case '/':
    case '/home': return <HomePage />;
    case '/about': return <AboutPage />;
    case '/contact': return <ContactPage />;
    case '/privacy': return <PrivacyPage />;
    case '/terms': return <TermsPage />;
    case '/faq': return <FaqPage />;
    default: return <NotFoundPage />;
  }
}
