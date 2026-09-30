import React from 'react';
import { renderToString } from 'react-dom/server';
import { HomePage } from './HomePage';
import { AboutPage, ContactPage, PrivacyPage, TermsPage, FaqPage } from './InfoPages';
import { SeoContext, type SeoOptions } from './SiteChrome';
export { SITE, canonicalUrl } from '../lib/site';

const pages = {
  '/': HomePage,
  '/about': AboutPage,
  '/contact': ContactPage,
  '/privacy': PrivacyPage,
  '/terms': TermsPage,
  '/faq': FaqPage,
};

export function renderPages() {
  return Object.entries(pages).map(([path, Page]) => {
    let seo: SeoOptions | undefined;
    const html = renderToString(
      <SeoContext.Provider value={(value) => { seo = value; }}><Page /></SeoContext.Provider>,
    );
    if (!seo) throw new Error(`Missing SEO metadata for ${path}`);
    return { path, html, seo };
  });
}
