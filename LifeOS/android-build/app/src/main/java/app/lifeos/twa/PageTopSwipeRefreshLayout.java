package app.lifeos.twa;

import android.content.Context;
import android.util.AttributeSet;
import android.webkit.WebView;

import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;

/**
 * Pull-to-refresh that respects the page's real scroll position.
 *
 * LifeOS scrolls inside an inner <main> element, so the WebView's own
 * scrollY is always 0 and stock SwipeRefreshLayout would trigger a refresh
 * on a swipe from ANYWHERE on the page. Instead, the web page pushes its
 * scroll state through the LifeOSNative bridge on every scroll event, and
 * the gesture is enabled only when every scroll container sits at the top.
 */
public class PageTopSwipeRefreshLayout extends SwipeRefreshLayout {

    private WebView web;
    /** Last at-top report from the page; defaults to true so the very first pull works. */
    private volatile boolean pageAtTop = true;

    public PageTopSwipeRefreshLayout(Context context) { super(context); }
    public PageTopSwipeRefreshLayout(Context context, AttributeSet attrs) { super(context, attrs); }

    public void attachWebView(WebView view) { this.web = view; }

    /** Called from the JS bridge whenever the page scrolls. */
    public void setPageAtTop(boolean atTop) { pageAtTop = atTop; }

    @Override
    public boolean canChildScrollUp() {
        // If the WebView itself is scrolled down, stock behavior applies.
        if (web != null && web.getScrollY() > 0) return true;
        // Otherwise defer to the page's own report about inner containers.
        return !pageAtTop;
    }
}
