import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createServer } from 'vite';

// Use Vite's TSX loader without starting a listener or running build/PWA plugins.
const server = await createServer({
  configFile: false,
  mode: 'production',
  server: { middlewareMode: true },
  appType: 'custom',
});
const escape = (value) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

try {
  const { renderPages, canonicalUrl, SITE } = await server.ssrLoadModule('/src/site/prerender.tsx');
  const template = await readFile('dist/index.html', 'utf8');
  const pages = renderPages();
  for (const { path, html, seo } of pages) {
    let output = template
      .replace(/<title>[\s\S]*?<\/title>/, `<title>${escape(seo.title)}</title>`)
      .replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g, '')
      .replace(/<meta\s+(?:name|property)="(?:description|robots|og:[^"]+|twitter:[^"]+)"[^>]*>/g, '')
      .replace(/<link rel="canonical"[^>]*>/g, '')
      .replace('<div id="root"></div>', () => `<div id="root">${html}</div>`);
    const meta = [
      `<link rel="canonical" href="${escape(canonicalUrl(path))}" />`,
      `<meta name="description" content="${escape(seo.description)}" />`,
      '<meta name="robots" content="index, follow" />',
      '<meta property="og:type" content="website" />',
      '<meta property="og:site_name" content="LifeOS" />',
      `<meta property="og:url" content="${escape(canonicalUrl(path))}" />`,
      '<meta name="twitter:card" content="summary_large_image" />',
      ...['og', 'twitter'].flatMap((prefix) => ['title', 'description', 'image'].map((key) =>
        `<meta ${prefix === 'og' ? 'property' : 'name'}="${prefix}:${key}" content="${escape(key === 'image' ? canonicalUrl('/og.png') : seo[key])}" />`,
      )),
    ].join('\n    ');
    output = output.replace('</head>', () => `${meta}\n  </head>`);
    const directory = path === '/' ? 'dist' : `dist${path}`;
    await mkdir(directory, { recursive: true });
    await writeFile(`${directory}/index.html`, output);
  }
  // Keep all deploy-time URLs on the configured canonical origin.
  for (const file of ['download.html', 'sitemap.xml', 'robots.txt']) {
    const content = await readFile(`dist/${file}`, 'utf8');
    await writeFile(`dist/${file}`, content.replaceAll('https://life-os-tdl.vercel.app', SITE.url));
  }
  console.log(`Prerendered ${pages.length} public pages with content and route-specific metadata.`);
} finally {
  await server.close();
}
