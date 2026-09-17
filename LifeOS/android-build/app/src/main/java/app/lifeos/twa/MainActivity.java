package app.lifeos.twa;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.animation.Animation;
import android.view.animation.AnimationUtils;
import android.view.Window;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebChromeClient;
import android.webkit.PermissionRequest;

/**
 * LifeOS standalone app — native WebView shell with a branded splash screen.
 *
 * The splash (navy screen, centered logo, gentle pulse) covers the WebView
 * until the site finishes loading, then fades out. Unlike a TWA, everything
 * runs in this app's own process: always standalone, no Chrome, no
 * verification, no URL bar.
 *
 * Touch-input rule: NEVER launch another activity or system dialog from
 * onCreate — a permission/settings screen stealing focus before the WebView
 * is attached leaves touch dead after returning. All prompts happen after
 * the page has fully loaded.
 */
public class MainActivity extends Activity {
    private WebView web;
    private View splash;
    private boolean splashGone = false;
    private boolean askedNotif = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        Window w = getWindow();
        w.setStatusBarColor(Color.parseColor("#0F172A"));
        w.setNavigationBarColor(Color.parseColor("#0F172A"));
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            w.setStatusBarContrastEnforced(false);
            w.setNavigationBarContrastEnforced(false);
        }

        setContentView(R.layout.activity_main);
        web = findViewById(R.id.webview);
        splash = findViewById(R.id.splash);

        // Pull-to-refresh: only when the page's inner scroll container (the
        // app scrolls inside <main>; WebView scrollY stays 0) is at the top.
        // The page reports its scroll state through the LifeOSScroll bridge;
        // TopAwareSwipeRefreshLayout reads it synchronously at gesture start.
        TopAwareSwipeRefreshLayout swipe = findViewById(R.id.swipe);
        swipe.setOnRefreshListener(() -> {
            web.reload();
            new Handler(Looper.getMainLooper()).postDelayed(() -> swipe.setRefreshing(false), 1500);
        });
        web.addJavascriptInterface(new Object() {
            @JavascriptInterface
            public void setScrolled(final boolean scrolled) {
                runOnUiThread(() -> swipe.setPageScrolled(scrolled));
            }
        }, "LifeOSScroll");

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);          // IndexedDB / localStorage — LifeOS local cache
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false); // allow alarm sounds to ring
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setJavaScriptCanOpenWindowsAutomatically(true);
        s.setSupportMultipleWindows(false);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setUserAgentString(s.getUserAgentString() + " LifeOSNative/1.0");

        // JS bridge: the web app pushes its upcoming alarms here; they ring
        // natively via AlarmManager even when this app is closed.
        web.addJavascriptInterface(new AlarmBridge(this), "LifeOSNative");

        // Gentle pulse on the logo while loading.
        View logo = findViewById(R.id.splash_logo);
        Animation pulse = AnimationUtils.loadAnimation(this, R.anim.pulse);
        logo.startAnimation(pulse);

        // Render full screen; grant camera/mic prompts (idea photo/voice).
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(() -> request.grant(request.getResources()));
            }
        });

        // ONE WebViewClient for everything page-load related. (A second
        // setWebViewClient call elsewhere overwrote this one before — the
        // scroll hook silently never ran.)
        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                // Scroll-state reporter: watches every scroll container and
                // pushes true/false to the native pull-to-refresh gate.
                view.evaluateJavascript(
                    "(function(){if(window.__lifeosScrollHook)return;window.__lifeosScrollHook=1;" +
                    "var f=function(){var els=document.querySelectorAll('main,.overflow-y-auto,[class*=overflow-y-auto]');" +
                    "for(var i=0;i<els.length;i++){var e=els[i];" +
                    "if(e.scrollHeight>e.clientHeight+4&&e.scrollTop>4){window.LifeOSScroll&&LifeOSScroll.setScrolled(true);return;}}" +
                    "window.LifeOSScroll&&LifeOSScroll.setScrolled(false);};" +
                    "window.addEventListener('scroll',f,true);f();})();", null);
                hideSplash();
                maybeAskNotifPermission();
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, android.webkit.WebResourceRequest req) {
                android.net.Uri u = req.getUrl();
                if ("life-os-tdl.vercel.app".equals(u.getHost())) return false; // in-app
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, u));
                } catch (Exception ignored) {}
                return true;
            }
        });

        // Safety: never let the splash stick longer than 12s (slow network etc.).
        new Handler(Looper.getMainLooper()).postDelayed(this::hideSplash, 12_000);

        web.loadUrl("https://life-os-tdl.vercel.app/");
    }

    /**
     * Ask for the notification permission if not already granted — retried
     * on every page load until granted (a dismissed system prompt used to
     * leave the app permanently silent). Only after the page is touchable,
     * never from onCreate (touch-freeze bug).
     */
    private void maybeAskNotifPermission() {
        if (Build.VERSION.SDK_INT < 33) return;
        if (checkSelfPermission("android.permission.POST_NOTIFICATIONS")
                == android.content.pm.PackageManager.PERMISSION_GRANTED) return;
        if (askedNotif) return; // once per app-open; re-ask next launch
        askedNotif = true;
        requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, 1001);
    }

    /**
     * Removes the splash immediately — no fade animation. An animation's
     * onAnimationEnd can be skipped (activity paused mid-hide), leaving this
     * invisible-but-clickable overlay stuck on top of the WebView eating
     * every touch (the touch-freeze bug).
     */
    private void hideSplash() {
        if (splashGone || splash == null) return;
        splashGone = true;
        splash.setClickable(false);
        splash.setFocusable(false);
        splash.setVisibility(View.GONE);
    }


    @Override
    protected void onPause() {
        super.onPause();
        if (web != null) web.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) web.onResume();
        // Belt-and-braces: if the splash somehow survived (paused mid-hide),
        // kill it on return so touch is never dead.
        if (splashGone && splash != null) splash.setVisibility(View.GONE);
    }

    @Override
    public void onBackPressed() {
        // Navigate back through the site's history before leaving the app.
        if (web != null && web.canGoBack()) web.goBack();
        else moveTaskToBack(true); // keep process alive: alarms keep ticking
    }
}
