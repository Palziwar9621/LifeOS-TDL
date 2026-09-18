package app.lifeos.twa;

import android.webkit.JavascriptInterface;

/**
 * Minimal JS bridge for scroll reporting, exposed as window.LifeOSScroll.
 * Kept separate from AlarmBridge so alarm logic stays untouched.
 */
public class ScrollReporter {
    private final PageTopSwipeRefreshLayout swipe;

    public ScrollReporter(PageTopSwipeRefreshLayout swipe) { this.swipe = swipe; }

    @JavascriptInterface
    public void reportScrollTop(final boolean atTop) {
        if (swipe != null) {
            swipe.post(() -> swipe.setPageAtTop(atTop));
        }
    }
}
