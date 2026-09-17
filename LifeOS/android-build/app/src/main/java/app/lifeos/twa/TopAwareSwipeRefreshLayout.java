package app.lifeos.twa;

import android.content.Context;
import android.util.AttributeSet;
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;

/**
 * SwipeRefreshLayout that knows whether the page's INNER scroll container
 * (the app scrolls inside <main>, the WebView itself never scrolls) is at
 * the top. The web page reports its scroll state via the JS bridge;
 * canChildScrollUp() — consulted synchronously before every gesture —
 * returns that state. JS callbacks are async, so we cache.
 */
public class TopAwareSwipeRefreshLayout extends SwipeRefreshLayout {

    /** True while the page reports any scroll container away from the top. */
    private boolean pageScrolled = false;

    public TopAwareSwipeRefreshLayout(Context ctx) { super(ctx); }
    public TopAwareSwipeRefreshLayout(Context ctx, AttributeSet attrs) { super(ctx, attrs); }

    public void setPageScrolled(boolean scrolled) {
        pageScrolled = scrolled;
        // Re-arm/kill the gesture to match the new state immediately.
        setEnabled(!scrolled);
    }

    @Override
    public boolean canChildScrollUp() {
        return pageScrolled || super.canChildScrollUp();
    }
}
