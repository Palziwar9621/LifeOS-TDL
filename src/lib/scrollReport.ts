// LifeOS — reports the app's scroll position to the Android shell so
// pull-to-refresh only triggers when every scroll container is at the top.
// No-op everywhere else. (Alarm logic untouched — this is its own bridge.)
let installed = false;

export function initScrollReporting(): void {
  if (installed || typeof window === 'undefined') return;
  const native = (window as any).LifeOSScroll;
  if (!native || typeof native.reportScrollTop !== 'function') return;
  installed = true;

  const report = () => {
    const main = document.querySelector('main');
    const mainTop = main ? main.scrollTop === 0 : true;
    const winTop = window.scrollY === 0;
    native.reportScrollTop(mainTop && winTop);
  };

  window.addEventListener('scroll', report, { passive: true });
  const attach = () => {
    const main = document.querySelector('main');
    if (main) main.addEventListener('scroll', report, { passive: true });
  };
  attach();
  // Pages mount/unmount <main> stays, but re-attach on route changes just in case.
  const obs = new MutationObserver(() => attach());
  obs.observe(document.body, { childList: true, subtree: true });
  report();
}
