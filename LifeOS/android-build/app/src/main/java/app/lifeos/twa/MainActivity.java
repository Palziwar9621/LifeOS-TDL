package app.lifeos.twa;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.animation.AlphaAnimation;
import android.view.animation.Animation;
import android.view.animation.AnimationUtils;
import android.view.Window;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebChromeClient;
import android.webkit.PermissionRequest;

/**
 * LifeOS standalone app — native WebView shell with a branded splash screen.
 *
 * The splash (navy screen, centered logo, gentle pulse) covers the WebView
 * until the site finishes loading, then fades out over 300ms. Unlike a TWA,
 * everything runs in this app's own process: always standalone, no Chrome,
 * no verification, no URL bar.
 *
 * Touch-input rule: NEVER launch another activity or system dialog from
 * onCreate — a permission/settings screen stealing focus before the WebView
 * is attached leaves touch dead after returning. All prompts happen after
 * the page has fully loaded, once.
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

        // Pull-to-refresh: swipe down at the top of the page reloads the site.
        androidx.swiperefreshlayout.widget.SwipeRefreshLayout swipe = findViewById(R.id.swipe);
        swipe.setOnRefreshListener(() -> {
            web.reload();
            new Handler(Looper.getMainLooper()).postDelayed(() -> swipe.setRefreshing(false), 1500);
        });
        web.getViewTreeObserver().addOnScrollChangedListener(() ->
            swipe.setEnabled(web.getScrollY() == 0));

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

        // Keep navigation inside the app; external links go to the real browser.
        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                hideSplash();
                // Ask for the notification permission once, AFTER the page is
                // loaded and touchable — never from onCreate (touch-freeze bug).
                if (!askedNotif && Build.VERSION.SDK_INT >= 33) {
                    askedNotif = true;
                    requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, 1001);
                }
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

    private void hideSplash() {
        if (splashGone || splash == null) return;
        splashGone = true;
        AlphaAnimation fade = new AlphaAnimation(1f, 0f);
        fade.setDuration(300);
        fade.setFillAfter(true);
        fade.setAnimationListener(new Animation.AnimationListener() {
            @Override public void onAnimationStart(Animation a) {}
            @Override public void onAnimationEnd(Animation a) { splash.setVisibility(View.GONE); }
            @Override public void onAnimationRepeat(Animation a) {}
        });
        splash.startAnimation(fade);
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
    }

    @Override
    public void onBackPressed() {
        // Navigate back through the site's history before leaving the app.
        if (web != null && web.canGoBack()) web.goBack();
        else moveTaskToBack(true); // keep process alive: alarms keep ticking
    }
}
