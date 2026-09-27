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
                // Module scripts need a JavaScript MIME type, which the asset loader does not know for .mjs.
                if (response != null && path.endsWith(".mjs")) response.setMimeType("text/javascript");
                return response;
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if (APP_HOST.equals(url.getHost())) return false;
                // Links to other sites (like an imported recipe's original page) open in the browser.
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, url));
                } catch (Exception ignored) {
                    // No browser installed; stay in the app.
                }
                return true;
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
        webView.loadUrl(APP_URL);

        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQUEST_NOTIFICATIONS);
        }
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
