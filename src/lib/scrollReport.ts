// LifeOS — reports the app's scroll position to the Android shell so
// pull-to-refresh only triggers when every scroll container is at the top.
// No-op everywhere else. Uses a document-level capture listener so it
// keeps working no matter how many times React re-creates <main>.
let installed = false;

export function initScrollReporting(): void {
  if (installed || typeof window === 'undefined') return;
  const native = (window as any).LifeOSScroll;
  if (!native || typeof native.reportScrollTop !== 'function') return;
  installed = true;

  const report = () => {
    // Any real scroll container away from the top (or the window itself)
    // disables pull-to-refresh. Capture phase catches scroll events from
    // every element, including ones created after this ran.
    let atTop = window.scrollY === 0;
    if (atTop) {
      for (const el of document.querySelectorAll('main, [data-scroll-root]')) {
        if (el.scrollTop > 0) { atTop = false; break; }
      }
    }
    native.reportScrollTop(atTop);
  };

  // Capture is essential: scroll events don't bubble, but they DO fire the
  // document capture phase for every scrolling element.
  document.addEventListener('scroll', report, { capture: true, passive: true });
  window.addEventListener('resize', report, { passive: true });
  document.addEventListener('visibilitychange', report, { passive: true });
  // Initial state, after layout settles.
  requestAnimationFrame(report);
  window.addEventListener('load', report, { passive: true });
}
