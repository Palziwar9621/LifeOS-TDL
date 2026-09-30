// LifeOS — public marketing site shell (header/footer) + SEO head helper.
import React, { useEffect, useState } from 'react';
import { SITE, canonicalUrl } from '../lib/site';
import { Logo } from '../ui/components';
import { KageAmbient } from './KageAmbient';
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
    set('meta[property="og:image"]', 'content', '/og.png', () => {
      const m = document.createElement('meta'); m.setAttribute('property', 'og:image'); return m;
    });
    set('meta[name="twitter:image"]', 'content', '/og.png', () => {
      const m = document.createElement('meta'); m.setAttribute('name', 'twitter:image'); return m;
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
  useKageInteractions();
  return (
    <div className="site-root">
      <KageAmbient enabled />
      <SiteHeader />
      {children}
      <SiteFooter />
    </div>
  );
}

/** Site-wide Kage interactions: scroll-reveal sections, 3D tilt on feature
 * cards toward the cursor, and magnetic CTAs. All rAF/observer-based and
 * no-ops under prefers-reduced-motion. */
function useKageInteractions() {
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    // 1) Scroll reveal — sections and card grids fade/slide in as they enter.
    const revealables = document.querySelectorAll('.site-section, .prose-page > *');
    revealables.forEach((el) => el.classList.add('reveal'));
    const io = new IntersectionObserver((entries) => {
      for (const en of entries) if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
    }, { threshold: 0.12 });
    revealables.forEach((el) => io.observe(el));

    // 2) Card tilt — feature cards lean toward the cursor (perspective).
    let raf = 0; let lastCard: HTMLElement | null = null;
    const onCardMove = (e: PointerEvent) => {
      const card = (e.target as HTMLElement).closest?.('.card-s') as HTMLElement | null;
      if (lastCard && lastCard !== card) lastCard.style.transform = '';
      lastCard = card;
      if (!card) return;
      const r = card.getBoundingClientRect();
      const rx = ((e.clientY - r.top) / r.height - 0.5) * -6;
      const ry = ((e.clientX - r.left) / r.width - 0.5) * 6;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        card.style.transform = `perspective(700px) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg) translateY(-3px)`;
      });
    };
    const onCardLeave = () => { if (lastCard) { lastCard.style.transform = ''; lastCard = null; } };
    document.addEventListener('pointermove', onCardMove, { passive: true });
    document.addEventListener('pointerleave', onCardLeave);

    // 3) Magnetic CTAs — buttons drift a few px toward the cursor.
    const onCtaMove = (e: PointerEvent) => {
      const cta = (e.target as HTMLElement).closest?.('.site-cta') as HTMLElement | null;
      document.querySelectorAll<HTMLElement>('.site-cta').forEach((b) => { b.style.setProperty('--mag-x', '0px'); b.style.setProperty('--mag-y', '0px'); });
      if (!cta) return;
      const r = cta.getBoundingClientRect();
      const dx = ((e.clientX - r.left) / r.width - 0.5) * 8;
      const dy = ((e.clientY - r.top) / r.height - 0.5) * 6;
      cta.style.setProperty('--mag-x', `${dx.toFixed(1)}px`);
      cta.style.setProperty('--mag-y', `${dy.toFixed(1)}px`);
    };
    document.addEventListener('pointermove', onCtaMove, { passive: true });

    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
      document.removeEventListener('pointermove', onCardMove);
      document.removeEventListener('pointerleave', onCardLeave);
      document.removeEventListener('pointermove', onCtaMove);
    };
  }, []);
}

function SiteHeader() {
  return (
    <header className="site-header">
      <a className="brand" href="/" aria-label="LifeOS home">
        <Logo size={26} light />
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
            <li><a href="/">Home</a></li>
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
