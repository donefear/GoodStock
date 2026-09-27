package com.donefear.goodstock;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.webkit.WebViewAssetLoader;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.Collections;

/**
 * Hosts the Goodstock web app from files bundled in the APK. There is no server: data stays in the WebView's
 * storage on the phone, and {@link NativeBridge} provides alarms, notifications, sharing and page fetching.
 */
public class MainActivity extends Activity {
    static final String APP_HOST = "appassets.androidplatform.net";
    static final String APP_URL = "https://" + APP_HOST + "/index.html";
    static final int REQUEST_FILE_CHOOSER = 1;
    static final int REQUEST_SAVE_FILE = 2;
    static final int REQUEST_NOTIFICATIONS = 3;

    /** True while the app is on screen; timer alarms then ring in the app instead of as a notification. */
    static volatile boolean visible;

    private WebView webView;
    private NativeBridge bridge;
    private ValueCallback<Uri[]> fileChooserCallback;

    @SuppressLint({"SetJavaScriptEnabled", "JavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Notifications.ensureChannels(this);
        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) WebView.setWebContentsDebuggingEnabled(true);

        webView = new WebView(this);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);

        WebViewAssetLoader assetLoader = new WebViewAssetLoader.Builder()
                .setDomain(APP_HOST)
                .addPathHandler("/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if (!APP_HOST.equals(url.getHost())) return null;
                String path = url.getPath() == null ? "/" : url.getPath();
                if (path.startsWith("/api/")) {
                    // No server in the app: answer at once instead of letting the request time out.
                    return new WebResourceResponse("application/json", "utf-8", 404, "Not Found",
                            Collections.emptyMap(), new ByteArrayInputStream("{}".getBytes(StandardCharsets.UTF_8)));
                }
                if (path.equals("/")) url = Uri.parse(APP_URL);
                WebResourceResponse response = assetLoader.shouldInterceptRequest(url);
                if (response == null) {
                    // Not a bundled file (e.g. favicon.ico): answer "not found" instead of trying the internet.
                    return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found",
                            Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
                }
                // Module scripts need a JavaScript MIME type, which the asset loader does not know for .mjs.
                if (path.endsWith(".mjs")) response.setMimeType("text/javascript");
                return response;
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return openOutside(request.getUrl());
            }

            // Android 5–6 call this older version instead.
            @Override
            @SuppressWarnings("deprecation")
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return openOutside(Uri.parse(url));
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, android.webkit.WebResourceError error) {
                if (Build.VERSION.SDK_INT >= 23 && request.isForMainFrame()) {
                    onPageFailed(error.getErrorCode() + " " + error.getDescription());
                }
            }

            // Android 5 reports errors through this older version (main page only).
            @Override
            @SuppressWarnings("deprecation")
            public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
                if (Build.VERSION.SDK_INT < 23) onPageFailed(errorCode + " " + description);
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileChooserCallback != null) fileChooserCallback.onReceiveValue(null);
                fileChooserCallback = callback;
                try {
                    startActivityForResult(params.createIntent(), REQUEST_FILE_CHOOSER);
                } catch (Exception e) {
                    fileChooserCallback = null;
                    return false;
                }
                return true;
            }
        });

        bridge = new NativeBridge(this, webView);
        webView.addJavascriptInterface(bridge, "GoodstockNative");
        setContentView(webView);

        // The page needs a reasonably recent WebView (Chrome 80+ engine). Old tablets often still have the one
        // they shipped with; say so plainly instead of showing an empty page.
        int engine = webViewMajorVersion();
        if (engine > 0 && engine < MIN_WEBVIEW_VERSION) {
            showNotice("Please update Android System WebView",
                    "Goodstock runs inside Android System WebView, and the version on this device (" + engine
                            + ") is too old for it. Update \"Android System WebView\" (and Chrome) in the Play Store, then open Goodstock again.",
                    true);
        } else {
            webView.loadUrl(APP_URL);
        }

        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQUEST_NOTIFICATIONS);
        }
    }

    /** Oldest WebView (Chrome engine) major version the web app is tested with. */
    private static final int MIN_WEBVIEW_VERSION = 80;
    private boolean triedDirectLoad;

    // Version names look like "83.0.4103.120" or, on old Android, "39 (4174727-x86_64)"; take the leading number.
    private static final java.util.regex.Pattern LEADING_NUMBER = java.util.regex.Pattern.compile("^\\s*(\\d+)");
    private static final java.util.regex.Pattern CHROME_VERSION = java.util.regex.Pattern.compile("Chrome/(\\d+)");

    private int webViewMajorVersion() {
        try {
            android.content.pm.PackageInfo info = androidx.webkit.WebViewCompat.getCurrentWebViewPackage(this);
            java.util.regex.Matcher match = LEADING_NUMBER.matcher(info == null || info.versionName == null ? "" : info.versionName);
            if (match.find()) return Integer.parseInt(match.group(1));
        } catch (Exception ignored) {
            // Fall back to the browser engine's own user agent below.
        }
        try {
            java.util.regex.Matcher match = CHROME_VERSION.matcher(WebSettings.getDefaultUserAgent(this));
            if (match.find()) return Integer.parseInt(match.group(1));
        } catch (Exception ignored) {
            // Unknown: try to run the app anyway.
        }
        return 0;
    }

    private boolean openOutside(Uri url) {
        if (APP_HOST.equals(url.getHost())) return false;
        // Links to other sites (like an imported recipe's original page) open in the browser.
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, url));
        } catch (Exception ignored) {
            // No browser installed; stay in the app.
        }
        return true;
    }

    /**
     * The start page did not load. First try handing the page over directly (its files still come from the APK),
     * then show what went wrong instead of Android's bare "Webpage not available".
     */
    private void onPageFailed(String reason) {
        if (!triedDirectLoad) {
            triedDirectLoad = true;
            try (java.io.InputStream in = getAssets().open("index.html")) {
                java.io.ByteArrayOutputStream buffer = new java.io.ByteArrayOutputStream();
                byte[] chunk = new byte[8192];
                int read;
                while ((read = in.read(chunk)) != -1) buffer.write(chunk, 0, read);
                webView.loadDataWithBaseURL(APP_URL, buffer.toString("UTF-8"), "text/html", "utf-8", null);
                return;
            } catch (Exception ignored) {
                // Fall through to the notice.
            }
        }
        showNotice("Goodstock could not start",
                "The app's start page did not load (" + reason + "). Android " + Build.VERSION.RELEASE
                        + ", WebView " + webViewMajorVersion() + ". Updating \"Android System WebView\" in the Play Store usually fixes this.",
                true);
    }

    private void showNotice(String title, String message, boolean offerUpdate) {
        runOnUiThread(() -> {
            android.widget.LinearLayout layout = new android.widget.LinearLayout(this);
            layout.setOrientation(android.widget.LinearLayout.VERTICAL);
            int pad = (int) (32 * getResources().getDisplayMetrics().density);
            layout.setPadding(pad, pad, pad, pad);
            layout.setBackgroundColor(0xFFF4F5EF);
            android.widget.TextView heading = new android.widget.TextView(this);
            heading.setText(title);
            heading.setTextSize(22);
            heading.setTextColor(0xFF28342F);
            android.widget.TextView body = new android.widget.TextView(this);
            body.setText(message);
            body.setTextSize(16);
            body.setTextColor(0xFF28342F);
            body.setPadding(0, pad / 2, 0, pad / 2);
            layout.addView(heading);
            layout.addView(body);
            if (offerUpdate) {
                android.widget.Button update = new android.widget.Button(this);
                update.setText("Update Android System WebView");
                update.setOnClickListener((view) -> {
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=com.google.android.webview")));
                    } catch (Exception noStore) {
                        startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps/details?id=com.google.android.webview")));
                    }
                });
                layout.addView(update);
            }
            android.widget.Button retry = new android.widget.Button(this);
            retry.setText("Try again");
            retry.setOnClickListener((view) -> recreate());
            layout.addView(retry);
            setContentView(layout);
        });
    }

    @Override
    protected void onResume() {
        super.onResume();
        visible = true;
        webView.resumeTimers();
        webView.onResume();
        // The app is on screen again, so it rings any finished timer itself.
        Notifications.cancelTimerAlerts(this);
        webView.evaluateJavascript("window.goodstockResume && window.goodstockResume()", null);
    }

    @Override
    protected void onPause() {
        visible = false;
        // Pause the page so it does not ring alongside the system alarm while in the background.
        webView.onPause();
        webView.pauseTimers();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        webView.destroy();
        super.onDestroy();
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        webView.evaluateJavascript("window.goodstockBack ? window.goodstockBack() : false", result -> {
            if (!"true".equals(result)) finish();
        });
    }

    @Override
    @SuppressWarnings("deprecation")
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQUEST_FILE_CHOOSER && fileChooserCallback != null) {
            fileChooserCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
            fileChooserCallback = null;
        } else if (requestCode == REQUEST_SAVE_FILE) {
            bridge.onSaveFileResult(resultCode, data);
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQUEST_NOTIFICATIONS) {
            bridge.onNotificationPermissionResult(grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED);
        }
    }
}
