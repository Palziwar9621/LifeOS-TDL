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
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebChromeClient;
import android.webkit.PermissionRequest;

import java.util.ArrayList;

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
    private SpeechBridge speechBridge;
    private static MainActivity instance;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private boolean resumed;
    private boolean trustedPage;
    private boolean destroyed;
    private PermissionRequest pendingWebPermission;
    private boolean webPermissionAnswered;
    private static final int REQ_WEB_MEDIA = 2010;
    private static final String APP_URL = "https://life-os-tdl.vercel.app/app";

    // Microphone/camera permissions are requested only by an explicit feature.
    // The existing notification/exact-alarm onboarding stays separate.
    private static final String PREFS = "lifeos.permissions";
    private static final int REQ_NOTIF = 1001;

    private android.content.SharedPreferences permPrefs() {
        return getSharedPreferences(PREFS, MODE_PRIVATE);
    }

    /** Kick off the first-open permission flow (after the page is touchable). */
    private void startPermissionFlow() {
        if (!resumed || !isTrustedPage()) return;
        if (permPrefs().getBoolean("done", false)) return;
        android.content.SharedPreferences p = permPrefs();
        if (Build.VERSION.SDK_INT >= 33 && !p.getBoolean("notifications", false)) {
            p.edit().putBoolean("notifications", true).apply();
            requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, REQ_NOTIF);
            return; // continue in onRequestPermissionsResult
        }
        if (!p.getBoolean("alarms", false) && Build.VERSION.SDK_INT >= 31) {
            p.edit().putBoolean("alarms", true).apply();
            // SCHEDULE_EXACT_ALARM is user-grantable via the settings screen —
            // sending the user there is the standard, store-safe flow.
            try {
                startActivity(new Intent(android.provider.Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,
                    android.net.Uri.parse("package:" + getPackageName())));
            } catch (Exception ignored) {}
        }
        p.edit().putBoolean("done", true).apply();
    }

    public static MainActivity get() { return instance; }

    private static boolean isTrustedOrigin(android.net.Uri uri) {
        return uri != null && "https".equalsIgnoreCase(uri.getScheme())
                && "life-os-tdl.vercel.app".equalsIgnoreCase(uri.getHost())
                && (uri.getPort() == -1 || uri.getPort() == 443)
                && uri.getUserInfo() == null;
    }

    public boolean isTrustedPage() {
        return !destroyed && trustedPage && web != null
                && isTrustedOrigin(android.net.Uri.parse(web.getUrl() == null ? "" : web.getUrl()));
    }

    /** Evaluate JS in the page (used by the speech bridge to deliver results). */
    public void evaluateJs(String js) {
        runOnUiThread(() -> {
            if (isTrustedPage() && !isFinishing() && !isDestroyed()) web.evaluateJavascript(js, null);
        });
    }

    private void denyWebPermission() {
        PermissionRequest pending = pendingWebPermission;
        pendingWebPermission = null;
        webPermissionAnswered = false;
        if (pending != null) { try { pending.deny(); } catch (Exception ignored) {} }
    }

    private void requestWebPermission(PermissionRequest request) {
        if (!resumed || !isTrustedPage() || !isTrustedOrigin(request.getOrigin())) { request.deny(); return; }
        denyWebPermission();
        ArrayList<String> permissions = new ArrayList<>();
        for (String resource : request.getResources()) {
            String permission;
            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)) permission = "android.permission.RECORD_AUDIO";
            else if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)) permission = "android.permission.CAMERA";
            else { request.deny(); return; }
            if (checkSelfPermission(permission) != android.content.pm.PackageManager.PERMISSION_GRANTED) permissions.add(permission);
        }
        pendingWebPermission = request;
        webPermissionAnswered = permissions.isEmpty();
        if (webPermissionAnswered) completeWebPermission();
        else requestPermissions(permissions.toArray(new String[0]), REQ_WEB_MEDIA);
    }

    private void completeWebPermission() {
        if (pendingWebPermission == null || !webPermissionAnswered || !resumed) return;
        if (!isTrustedPage() || !isTrustedOrigin(pendingWebPermission.getOrigin())) { denyWebPermission(); return; }
        ArrayList<String> resources = new ArrayList<>();
        for (String resource : pendingWebPermission.getResources()) {
            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)
                    && checkSelfPermission("android.permission.RECORD_AUDIO") == android.content.pm.PackageManager.PERMISSION_GRANTED) {
                // Release the native recognizer before giving WebView the microphone.
                if (speechBridge != null) speechBridge.onWebMicrophoneChanged(true);
                resources.add(resource);
            } else if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)
                    && checkSelfPermission("android.permission.CAMERA") == android.content.pm.PackageManager.PERMISSION_GRANTED) resources.add(resource);
        }
        PermissionRequest request = pendingWebPermission;
        pendingWebPermission = null;
        webPermissionAnswered = false;
        if (resources.isEmpty()) request.deny();
        else request.grant(resources.toArray(new String[0]));
    }

    /** Track actual WebView audio tracks, including stop() (which emits no ended event). */
    private void installMicrophoneTracker() {
        evaluateJs("(() => { const m = navigator.mediaDevices; if (!m || !m.getUserMedia || window.__lifeosMicTracker) return;"
                + "window.__lifeosMicTracker = true; const original = m.getUserMedia.bind(m); const tracks = new Set(); let pending = 0, epoch = 0;"
                + "const update = () => { for (const t of tracks) if (t.readyState === 'ended') tracks.delete(t);"
                + "window.LifeOSSpeech.setWebMicrophoneInUse(document.visibilityState !== 'hidden' && (pending > 0 || tracks.size > 0)); };"
                + "m.getUserMedia = async constraints => { if (!constraints || !constraints.audio) return original(constraints);"
                + "const token = epoch; pending++; update(); try { const stream = await original(constraints);"
                + "if (token !== epoch || document.visibilityState === 'hidden') { stream.getTracks().forEach(t => t.stop()); throw new DOMException('Capture cancelled', 'AbortError'); }"
                + "for (const t of stream.getAudioTracks()) { tracks.add(t); const stop = t.stop.bind(t);"
                + "t.stop = () => { stop(); tracks.delete(t); update(); }; t.addEventListener('ended', update); } return stream;"
                + "} finally { pending--; update(); } };"
                + "window.__lifeosReleaseMicrophone = () => { epoch++; for (const t of Array.from(tracks)) t.stop(); update(); };"
                + "document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') window.__lifeosReleaseMicrophone(); });"
                + "})()");
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        instance = this;
        AssistantService.setAppForeground(true);

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
        // The site scrolls inside an inner <main>, so PageTopSwipeRefreshLayout
        // relies on scroll reports from the page (see LifeOSNative bridge).
        app.lifeos.twa.PageTopSwipeRefreshLayout swipe = findViewById(R.id.swipe);
        swipe.attachWebView(web);
        swipe.setOnRefreshListener(() -> {
            web.reload();
            handler.postDelayed(() -> swipe.setRefreshing(false), 1500);
        });

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);          // IndexedDB / localStorage — LifeOS local cache
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false); // allow alarm sounds to ring
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setJavaScriptCanOpenWindowsAutomatically(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setSupportMultipleWindows(false);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setUserAgentString(s.getUserAgentString() + " LifeOSNative/1.0");

        // JS bridge: the web app pushes its upcoming alarms here; they ring
        // natively via AlarmManager even when this app is closed.
        web.addJavascriptInterface(new AlarmBridge(this), "LifeOSNative");
        // JS bridge: page reports its scroll position so pull-to-refresh only
        // fires when every scroll container is at the very top.
        web.addJavascriptInterface(new ScrollReporter(swipe), "LifeOSScroll");
        // JS bridge: native speech recognition (WebView has no Web Speech API).
        speechBridge = new SpeechBridge(this);
        web.addJavascriptInterface(speechBridge, "LifeOSSpeech");
        // JS bridge: background wake-word service control.
        web.addJavascriptInterface(new AssistantBridge(this), "LifeOSAssistant");

        // Gentle pulse on the logo while loading.
        View logo = findViewById(R.id.splash_logo);
        Animation pulse = AnimationUtils.loadAnimation(this, R.anim.pulse);
        logo.startAnimation(pulse);

        // Grant only trusted-origin media requests backed by Android permission.
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(() -> requestWebPermission(request));
            }
            @Override
            public void onPermissionRequestCanceled(PermissionRequest request) {
                if (pendingWebPermission == request) {
                    pendingWebPermission = null;
                    webPermissionAnswered = false;
                }
            }
        });

        // Keep navigation inside the app; external links go to the real browser.
        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                trustedPage = false;
                denyWebPermission();
                if (speechBridge != null) speechBridge.onPageChanged();
                if (!isTrustedOrigin(android.net.Uri.parse(url))) {
                    view.stopLoading();
                    openExternal(android.net.Uri.parse(url));
                }
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                trustedPage = isTrustedOrigin(android.net.Uri.parse(url));
                if (!isTrustedPage()) return;
                installMicrophoneTracker();
                hideSplash();
                // Notification/alarm onboarding waits for a touchable page.
                if (!askedNotif) {
                    askedNotif = true;
                    startPermissionFlow();
                }
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, android.webkit.WebResourceRequest req) {
                android.net.Uri u = req.getUrl();
                if (isTrustedOrigin(u)) return false;
                if (req.isForMainFrame()) openExternal(u);
                return true;
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                android.net.Uri uri = android.net.Uri.parse(url);
                if (isTrustedOrigin(uri)) return false;
                openExternal(uri);
                return true;
            }
        });

        // Safety: never let the splash stick longer than 12s (slow network etc.).
        handler.postDelayed(this::hideSplash, 12_000);

        web.loadUrl(APP_URL);
    }

    private void openExternal(android.net.Uri uri) {
        // Never forward javascript:, file:, intent: or arbitrary schemes from a page.
        if (!"https".equalsIgnoreCase(uri.getScheme()) && !"http".equalsIgnoreCase(uri.getScheme())
                && !"mailto".equalsIgnoreCase(uri.getScheme()) && !"tel".equalsIgnoreCase(uri.getScheme())) return;
        try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); } catch (Exception ignored) {}
    }

    /**
     * Removes the splash immediately — no fade animation. An animation's
     * onAnimationEnd can be skipped (activity paused mid-fade, animation
     * canceled), leaving this invisible-but-clickable overlay stuck on top
     * of the WebView eating every touch (the touch-freeze bug).
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
        resumed = false;
        if (speechBridge != null) speechBridge.onPause();
        if (pendingWebPermission == null) evaluateJs("window.__lifeosReleaseMicrophone && window.__lifeosReleaseMicrophone()");
        if (web != null) web.onPause();
        super.onPause();
    }

    @Override
    protected void onStop() {
        // A transient permission dialog must not hand the mic to a service.
        denyWebPermission();
        if (speechBridge != null) speechBridge.onPageChanged();
        AssistantService.setAppForeground(false);
        super.onStop();
    }

    @Override
    protected void onResume() {
        super.onResume();
        resumed = true;
        AssistantService.setAppForeground(true);
        if (web != null) web.onResume();
        if (speechBridge != null) speechBridge.onResume();
        completeWebPermission();
        // Belt-and-braces: if the splash somehow survived (paused mid-hide),
        // kill it on return so touch is never dead.
        if (splashGone && splash != null) splash.setVisibility(View.GONE);
        // App is open: the wake-word service must release the mic so in-app
        // features (voice notes on ideas, in-app recognizer) can record.
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (speechBridge != null) speechBridge.onPermissionResult(requestCode, grantResults);
        if (requestCode == REQ_WEB_MEDIA) {
            webPermissionAnswered = true;
            completeWebPermission();
        }
        if (requestCode == REQ_NOTIF) startPermissionFlow();
    }

    @Override
    public void onTrimMemory(int level) {
        super.onTrimMemory(level);
        if (level == android.content.ComponentCallbacks2.TRIM_MEMORY_RUNNING_CRITICAL
                || level >= android.content.ComponentCallbacks2.TRIM_MEMORY_COMPLETE) EmbeddedSpeechEngine.releaseIdleModel();
    }

    @Override
    protected void onDestroy() {
        destroyed = true;
        trustedPage = false;
        denyWebPermission();
        handler.removeCallbacksAndMessages(null);
        if (speechBridge != null) speechBridge.destroy();
        speechBridge = null;
        if (web != null) {
            web.removeJavascriptInterface("LifeOSSpeech");
            web.removeJavascriptInterface("LifeOSAssistant");
            web.removeJavascriptInterface("LifeOSNative");
            web.removeJavascriptInterface("LifeOSScroll");
            web.stopLoading();
            web.destroy();
            web = null;
        }
        if (instance == this) instance = null;
        super.onDestroy();
    }

    @Override
    public void onBackPressed() {
        // Navigate back through the site's history before leaving the app.
        if (web != null && web.canGoBack()) web.goBack();
        else moveTaskToBack(true); // keep process alive: alarms keep ticking
    }
}
