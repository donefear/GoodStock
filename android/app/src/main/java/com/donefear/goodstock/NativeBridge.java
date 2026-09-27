package com.donefear.goodstock;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Exposed to the page as window.GoodstockNative. Async methods take a callback id first and answer through
 * window.__goodstockNativeCallback(id, ok, payload).
 */
final class NativeBridge {
    private static final int MAX_PAGE_BYTES = 4_000_000;
    private static final Pattern CHARSET = Pattern.compile("charset=([\\w.-]+)", Pattern.CASE_INSENSITIVE);

    private final Activity activity;
    private final WebView webView;
    private final ExecutorService network = Executors.newSingleThreadExecutor();
    private String pendingSaveId;
    private String pendingSaveContent;
    private String pendingPermissionId;

    NativeBridge(Activity activity, WebView webView) {
        this.activity = activity;
        this.webView = webView;
    }

    /** Replaces the scheduled timer alarms with this list: [{id, endsAt, done, title, text}]. */
    @JavascriptInterface
    public void setTimers(String json) {
        TimerAlarms.sync(activity.getApplicationContext(), json);
    }

    @JavascriptInterface
    public void notify(String title, String text) {
        Notifications.showReminder(activity.getApplicationContext(), title, text);
    }

    @JavascriptInterface
    public boolean notificationsAllowed() {
        return Notifications.allowed(activity);
    }

    @JavascriptInterface
    public void requestNotifications(String callbackId) {
        if (Build.VERSION.SDK_INT < 33 || Notifications.allowed(activity)) {
            callback(callbackId, true, Notifications.allowed(activity) ? "granted" : "denied");
            return;
        }
        pendingPermissionId = callbackId;
        activity.runOnUiThread(() -> activity.requestPermissions(
                new String[]{Manifest.permission.POST_NOTIFICATIONS}, MainActivity.REQUEST_NOTIFICATIONS));
    }

    void onNotificationPermissionResult(boolean granted) {
        if (pendingPermissionId == null) return;
        callback(pendingPermissionId, true, granted ? "granted" : "denied");
        pendingPermissionId = null;
    }

    @JavascriptInterface
    public void keepScreenOn(boolean on) {
        activity.runOnUiThread(() -> {
            if (on) activity.getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            else activity.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        });
    }

    @JavascriptInterface
    @SuppressWarnings("deprecation")
    public void vibrate(long milliseconds) {
        Vibrator vibrator = (Vibrator) activity.getSystemService(Context.VIBRATOR_SERVICE);
        if (vibrator == null || !vibrator.hasVibrator()) return;
        long duration = Math.max(1, Math.min(milliseconds, 3000));
        if (Build.VERSION.SDK_INT >= 26) vibrator.vibrate(VibrationEffect.createOneShot(duration, VibrationEffect.DEFAULT_AMPLITUDE));
        else vibrator.vibrate(duration);
    }

    @JavascriptInterface
    public void share(String text) {
        Intent send = new Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text);
        activity.runOnUiThread(() -> activity.startActivity(Intent.createChooser(send, "Share shopping list")));
    }

    /** Fetches a web page for recipe import. Answers with JSON {status, url, body}. */
    @JavascriptInterface
    public void fetchPage(String callbackId, String address) {
        request(callbackId, "GET", address, null, null);
    }

    /**
     * A GET request with the given headers (JSON object), for talking to Mealie straight from the phone. Unlike the
     * page's own fetch it is not limited by CORS. Answers with JSON {status, url, body}.
     */
    @JavascriptInterface
    public void httpRequest(String callbackId, String address, String headersJson) {
        request(callbackId, "GET", address, headersJson, null);
    }

    /** A request with a body (like a DeepL translation), answered as JSON {status, url, body}. */
    @JavascriptInterface
    public void httpSend(String callbackId, String method, String address, String headersJson, String body) {
        request(callbackId, method, address, headersJson, body);
    }

    private void request(String callbackId, String method, String address, String headersJson, String body) {
        network.execute(() -> {
            try {
                JSONObject headers = headersJson == null || headersJson.isEmpty() ? new JSONObject() : new JSONObject(headersJson);
                callback(callbackId, true, download(address, headers, method, body).toString());
            } catch (Exception error) {
                String message = error.getMessage();
                callback(callbackId, false, message == null ? error.getClass().getSimpleName() : message);
            }
        });
    }

    private JSONObject download(String address, JSONObject headers) throws Exception {
        return download(address, headers, "GET", null);
    }

    private JSONObject download(String address, JSONObject headers, String method, String body) throws Exception {
        URL url = new URL(address);
        String originalHost = url.getHost();
        String verb = method == null || method.isEmpty() ? "GET" : method.toUpperCase();
        for (int redirects = 0; redirects < 6; redirects++) {
            if (!"http".equals(url.getProtocol()) && !"https".equals(url.getProtocol())) throw new IllegalArgumentException("Only http and https links are supported");
            HttpURLConnection connection = (HttpURLConnection) url.openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(12_000);
            connection.setReadTimeout(20_000);
            connection.setRequestMethod(verb);
            connection.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android) GoodstockRecipeImport/1.0");
            connection.setRequestProperty("Accept", "text/html,application/xhtml+xml");
            Iterator<String> names = headers.keys();
            while (names.hasNext()) {
                String name = names.next();
                // Never forward a key (like the Mealie token) to a different host after a redirect.
                if (name.equalsIgnoreCase("authorization") && !url.getHost().equalsIgnoreCase(originalHost)) continue;
                connection.setRequestProperty(name, headers.optString(name));
            }
            if (body != null) {
                connection.setDoOutput(true);
                try (OutputStream out = connection.getOutputStream()) {
                    out.write(body.getBytes(StandardCharsets.UTF_8));
                }
            }
            int status = connection.getResponseCode();
            String location = connection.getHeaderField("Location");
            // Requests with a body are not re-sent to another address.
            if (status >= 300 && status < 400 && location != null && body == null) {
                // Follow redirects ourselves, including http to https, which HttpURLConnection will not do.
                url = new URL(url, location);
                connection.disconnect();
                continue;
            }
            JSONObject result = new JSONObject();
            result.put("status", status);
            result.put("url", url.toString());
            try (InputStream stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream()) {
                result.put("body", stream == null ? "" : readText(stream, connection.getContentType()));
            } finally {
                connection.disconnect();
            }
            return result;
        }
        throw new IllegalStateException("Too many redirects");
    }

    private static String readText(InputStream stream, String contentType) throws Exception {
        ByteArrayOutputStream buffer = new ByteArrayOutputStream();
        byte[] chunk = new byte[16_384];
        int read;
        while ((read = stream.read(chunk)) != -1 && buffer.size() < MAX_PAGE_BYTES) buffer.write(chunk, 0, read);
        Charset charset = StandardCharsets.UTF_8;
        Matcher match = contentType == null ? null : CHARSET.matcher(contentType);
        if (match != null && match.find()) {
            try { charset = Charset.forName(match.group(1)); } catch (Exception ignored) { /* Keep UTF-8. */ }
        }
        return new String(buffer.toByteArray(), charset);
    }

    /** Lets the user pick where to save a file (the kitchen backup), then writes it. */
    @JavascriptInterface
    @SuppressWarnings("deprecation")
    public void saveFile(String callbackId, String fileName, String content) {
        pendingSaveId = callbackId;
        pendingSaveContent = content;
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT)
                .addCategory(Intent.CATEGORY_OPENABLE)
                .setType("application/json")
                .putExtra(Intent.EXTRA_TITLE, fileName);
        activity.runOnUiThread(() -> activity.startActivityForResult(intent, MainActivity.REQUEST_SAVE_FILE));
    }

    void onSaveFileResult(int resultCode, Intent data) {
        String id = pendingSaveId;
        String content = pendingSaveContent;
        pendingSaveId = null;
        pendingSaveContent = null;
        if (id == null) return;
        Uri uri = data == null ? null : data.getData();
        if (resultCode != Activity.RESULT_OK || uri == null || content == null) {
            callback(id, false, "cancelled");
            return;
        }
        network.execute(() -> {
            try (OutputStream out = activity.getContentResolver().openOutputStream(uri, "wt")) {
                if (out == null) throw new IllegalStateException("Could not open the file");
                out.write(content.getBytes(StandardCharsets.UTF_8));
                callback(id, true, "saved");
            } catch (Exception error) {
                callback(id, false, "The backup could not be written");
            }
        });
    }

    private void callback(String id, boolean ok, String payload) {
        String script = "window.__goodstockNativeCallback && window.__goodstockNativeCallback("
                + JSONObject.quote(id) + "," + ok + "," + JSONObject.quote(payload == null ? "" : payload) + ")";
        activity.runOnUiThread(() -> webView.evaluateJavascript(script, null));
    }
}
