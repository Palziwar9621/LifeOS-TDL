// LifeOS — Kage WebGL hero integration.
// Renders the ThreeUI KageLandingPage component (MIT, @designcodeio/threeui)
// exactly as authored: the component mounts a sandboxed iframe that loads
// /landing-pages/kage.html (source hashes verified against the registered
// bundle). LifeOS content lives in the semantic sections around the frame,
// so search engines and assistive tech always get real text.
// NOTE: imports the component subpath (not the package root) to avoid
// pulling the library's full style.css into the bundle.
import React, { Suspense, lazy } from 'react';

const KageLandingPage = lazy(() =>
  import('@designcodeio/threeui/components/KageLandingPage').then((m) => ({ default: m.KageLandingPage })),
);

export function KageScene({ reducedMotion }: { reducedMotion?: boolean }) {
  // Reduced motion / no-JS-visuals fallback: static art from the same asset
  // pack instead of the live WebGL scene.
  if (reducedMotion) {
    return (
      <div className="kage-fallback" role="img" aria-label="Kage — a night scene of a Kyoto mountain temple rendered in dark tones with a vermilion moon">
        <img src="/landing-pages/secret-pathways-assets/generated/kage-sanmon-preview.webp" alt="" loading="eager" />
      </div>
    );
  }
  return (
    <div className="kage-frame" aria-label="Kage interactive scene">
      <Suspense
        fallback={
          <div className="kage-fallback" aria-hidden="true">
            <img src="/landing-pages/secret-pathways-assets/generated/kage-sanmon-preview.webp" alt="" loading="eager" />
          </div>
        }
      >
        <KageLandingPage
          headingFont="onest"
          bodyFont="onest"
          headingWeight="400"
          bodyWeight="300"
          primaryColor="#e0231c"
          headingSize={46}
          bodySize={17}
          headingLetterSpacing={-0.012}
        />
      </Suspense>
    </div>
  );
}
