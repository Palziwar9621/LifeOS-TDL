// LifeOS — central site configuration.
// The production domain may change (currently the temporary Vercel domain).
// VITE_SITE_URL also controls generated HTML, sitemap and robots.txt at build time.

export const SITE = {
  name: 'LifeOS',
  tagline: 'Your life, organized',
  /** Canonical origin, no trailing slash. Temporary until a custom domain is configured. */
  url: ((import.meta.env.VITE_SITE_URL as string | undefined) || 'https://life-os-tdl.vercel.app').replace(/\/+$/, ''),
  /** Creator / support contact (verified by the product owner). */
  creator: 'Kratim Krishan Singh',
  email: 'kratimks@gmail.com',
  github: 'https://github.com/Palziwar9621',
  linkedin: 'https://www.linkedin.com/in/kratim-singh-567954382/',
  location: 'Uttar Pradesh, India',
  status: 'Beta' as const,
  /** App route users land on after "Open LifeOS" (PWA start_url matches). */
  appPath: '/app',
  /** Public marketing homepage path (canonical "/"; /home is a legacy alias). */
  homePath: '/',
} as const;

export const canonicalUrl = (path = '/') => {
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${SITE.url}${p}`;
};
