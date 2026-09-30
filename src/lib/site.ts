// LifeOS — central site configuration.
// The production domain may change (currently the temporary Vercel domain).
// Update CANONICAL_URL here and every canonical URL, sitemap entry and
// structured-data reference follows. Do not hardcode the domain elsewhere.

export const SITE = {
  name: 'LifeOS',
  tagline: 'Your life, organized',
  /** Canonical origin, no trailing slash. Temporary until a custom domain is configured. */
  url: (import.meta.env.VITE_SITE_URL as string | undefined) ?? 'https://life-os-tdl.vercel.app',
  /** Creator / support contact (verified by the product owner). */
  creator: 'Kratim Krishan Singh',
  email: 'kratimks@gmail.com',
  github: 'https://github.com/Palziwar9621',
  linkedin: 'https://www.linkedin.com/in/kratim-singh-567954382/',
  location: 'Uttar Pradesh, India',
  status: 'Beta' as const,
  /** App route users land on after "Open LifeOS". */
  appPath: '/app',
  /** Public marketing homepage path ("/" is the app itself for installed shells). */
  homePath: '/home',
} as const;

export const canonicalUrl = (path = '/') => {
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${SITE.url}${p === '/' ? '' : p}`;
};
