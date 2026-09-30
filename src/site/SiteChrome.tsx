// LifeOS — public marketing site shell (header/footer) + SEO head helper.
import React, { useEffect } from 'react';
import { SITE, canonicalUrl } from '../lib/site';
import { Logo } from '../ui/components';
import './site.css';

/** Sets document title, meta description, canonical and OG/Twitter tags per public page. */
export function useSeo(opts: { title: string; description: string; path: string }) {
  useEffect(() => {
    document.title = opts.title;
    const set = (selector: string, attr: string, value: string, create: () => HTMLElement) => {
      let el = document.head.querySelector(selector) as HTMLElement | null;
      if (!el) { el = create(); document.head.appendChild(el); }
      el.setAttribute(attr, value);
    };
    set('meta[name="description"]', 'content', opts.description, () => {
      const m = document.createElement('meta'); m.setAttribute('name', 'description'); return m;
    });
    set('link[rel="canonical"]', 'href', canonicalUrl(opts.path), () => {
      const l = document.createElement('link'); l.setAttribute('rel', 'canonical'); return l;
    });
    set('meta[property="og:title"]', 'content', opts.title, () => {
      const m = document.createElement('meta'); m.setAttribute('property', 'og:title'); return m;
    });
    set('meta[property="og:description"]', 'content', opts.description, () => {
      const m = document.createElement('meta'); m.setAttribute('property', 'og:description'); return m;
    });
    set('meta[property="og:url"]', 'content', canonicalUrl(opts.path), () => {
      const m = document.createElement('meta'); m.setAttribute('property', 'og:url'); return m;
    });
    set('meta[name="twitter:title"]', 'content', opts.title, () => {
      const m = document.createElement('meta'); m.setAttribute('name', 'twitter:title'); return m;
    });
    set('meta[name="twitter:description"]', 'content', opts.description, () => {
      const m = document.createElement('meta'); m.setAttribute('name', 'twitter:description'); return m;
    });
  }, [opts.title, opts.description, opts.path]);
}

export function SiteChrome({ children }: { children: React.ReactNode }) {
  return (
    <div className="site-root">
      <SiteHeader />
      {children}
      <SiteFooter />
    </div>
  );
}

function SiteHeader() {
  return (
    <header className="site-header">
      <a className="brand" href="/home" aria-label="LifeOS home">
        <Logo size={26} />
      </a>
      <nav className="site-nav" aria-label="Site">
        <a className="nav-extra" href="/about">About</a>
        <a className="nav-extra" href="/contact">Contact</a>
        <a className="nav-extra" href="/faq">FAQ</a>
        <a className="site-cta secondary" href="/download.html">Download</a>
        <a className="site-cta" href={SITE.appPath}>Open LifeOS</a>
      </nav>
    </header>
  );
}

function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="cols">
        <div>
          <h3>Product</h3>
          <ul>
            <li><a href="/home">Home</a></li>
            <li><a href="/faq">FAQ</a></li>
            <li><a href="/download.html">Download</a></li>
            <li><a href={SITE.appPath}>Open the app</a></li>
          </ul>
        </div>
        <div>
          <h3>Company</h3>
          <ul>
            <li><a href="/about">About Us</a></li>
            <li><a href="/contact">Contact Us</a></li>
          </ul>
        </div>
        <div>
          <h3>Legal</h3>
          <ul>
            <li><a href="/privacy">Privacy Policy</a></li>
            <li><a href="/terms">Terms &amp; Conditions</a></li>
          </ul>
        </div>
        <div>
          <h3>Connect</h3>
          <ul>
            <li><a href={SITE.github} rel="noopener noreferrer">GitHub</a></li>
            <li><a href={SITE.linkedin} rel="noopener noreferrer">LinkedIn</a></li>
            <li><a href={`mailto:${SITE.email}`}>{SITE.email}</a></li>
          </ul>
        </div>
      </div>
      <p className="fine">
        © {new Date().getFullYear()} {SITE.creator}. LifeOS is in Beta and free to use.
        Built in {SITE.location}.
      </p>
    </footer>
  );
}
