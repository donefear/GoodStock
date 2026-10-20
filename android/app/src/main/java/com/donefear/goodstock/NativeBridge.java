package com.donefear.goodstock;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.print.PrintAttributes;
import android.print.PrintManager;
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
    private String pendingPickId;
    private String pendingPermissionId;
    private String pendingFolderId;
    private String pendingSyncFolderId;
    private android.speech.tts.TextToSpeech speech;
    private boolean speechReady;
    private String pendingSpeech;

    NativeBridge(Activity activity, WebView webView) {
        this.activity = activity;
        this.webView = webView;
    }

    /** Replaces the scheduled timer alarms with this list: [{id, endsAt, done, title, text}]. */
    @JavascriptInterface
    public void setTimers(String json) {
        TimerAlarms.sync(activity.getApplicationContext(), json);
    }

    /** Replaces the scheduled use-soon reminders with this list: [{id, at, title, text}]. */
    @JavascriptInterface
    public void setReminders(String json) {
        ReminderAlarms.sync(activity.getApplicationContext(), json);
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
        activity.runOnUiThread(() -> activity.startActivity(Intent.createChooser(send, null)));
    }

    /**
     * The daily update check against GitHub releases (the page's Settings → Your data → Updates). An APK from there
     * installs over this one when both are signed with the same key: see android/README.md, "Signing".
     */
    @JavascriptInterface
    public boolean checksForUpdates() {
        return true;
    }

    /** The home-screen widget's text (KitchenWidget), written by the page whenever the kitchen changes. */
    @JavascriptInterface
    public void setWidget(String json) {
        KitchenWidget.update(activity, json);
    }

    /** The page the widget asked to open ("inventory", "shopping"), once; empty otherwise. */
    @JavascriptInterface
    public String takeOpenView() {
        String view = MainActivity.pendingView;
        MainActivity.pendingView = null;
        return view == null ? "" : view;
    }

    /** The page as it prints (its @media print styles) through Android's print service: a printer or Save as PDF. */
    @JavascriptInterface
    public void print() {
        activity.runOnUiThread(() -> {
            PrintManager printer = (PrintManager) activity.getSystemService(Context.PRINT_SERVICE);
            if (printer == null) return;
            @SuppressWarnings("deprecation")
            android.print.PrintDocumentAdapter adapter = Build.VERSION.SDK_INT >= 21
                    ? webView.createPrintDocumentAdapter("Goodstock") : webView.createPrintDocumentAdapter();
            printer.print("Goodstock", adapter, new PrintAttributes.Builder().build());
        });
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

    /**
     * A recipe photo from a website, for keeping a small copy with an imported recipe (the page shrinks it). Answers
     * with a data URL; only images (JPEG, PNG, WebP, GIF), at most 8 MB, like the server's /api/photo.
     */
    @JavascriptInterface
    public void fetchImage(String callbackId, String address) {
        network.execute(() -> {
            try {
                URL url = new URL(address);
                for (int redirects = 0; redirects < 6; redirects++) {
                    if (!"http".equals(url.getProtocol()) && !"https".equals(url.getProtocol())) throw new IllegalArgumentException("Only http and https links are supported");
                    HttpURLConnection connection = (HttpURLConnection) url.openConnection();
                    connection.setInstanceFollowRedirects(false);
                    connection.setConnectTimeout(12_000);
                    connection.setReadTimeout(20_000);
                    connection.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android) GoodstockRecipeImport/1.0");
                    connection.setRequestProperty("Accept", "image/*");
                    int status = connection.getResponseCode();
                    String location = connection.getHeaderField("Location");
                    if (status >= 300 && status < 400 && location != null) {
                        url = new URL(url, location);
                        continue;
                    }
                    String type = String.valueOf(connection.getContentType()).split(";")[0].trim().toLowerCase();
                    if (status != 200 || !type.matches("image/(jpeg|png|webp|gif)")) throw new IllegalStateException("That photo could not be loaded.");
                    ByteArrayOutputStream bytes = new ByteArrayOutputStream();
                    try (InputStream in = connection.getInputStream()) {
                        byte[] buffer = new byte[16_384];
                        for (int read; (read = in.read(buffer)) != -1; ) {
                            bytes.write(buffer, 0, read);
                            if (bytes.size() > 8_000_000) throw new IllegalStateException("That photo is too large.");
                        }
                    }
                    callback(callbackId, true, "data:" + type + ";base64," + android.util.Base64.encodeToString(bytes.toByteArray(), android.util.Base64.NO_WRAP));
                    return;
                }
                throw new IllegalStateException("Too many redirects");
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

    /**
     * Android 4.4's WebView never opens a file picker for the page's file inputs (onShowFileChooser came with 5.0),
     * so there the page asks the bridge instead (0.41).
     */
    @JavascriptInterface
    public boolean canPickFile() {
        return Build.VERSION.SDK_INT < 21;
    }

    /** Opens Android's file picker; answers with {name, type, data (base64)} or "cancelled". */
    @JavascriptInterface
    public void pickFile(String callbackId, String accept) {
        pendingPickId = callbackId;
        String type = accept != null && accept.startsWith("image/") ? "image/*" : "*/*";
        Intent intent = new Intent(Intent.ACTION_GET_CONTENT).addCategory(Intent.CATEGORY_OPENABLE).setType(type);
        activity.runOnUiThread(() -> {
            try {
                activity.startActivityForResult(Intent.createChooser(intent, null), MainActivity.REQUEST_PICK_FILE);
            } catch (Exception noPicker) {
                pendingPickId = null;
                callback(callbackId, false, "No app on this device can pick a file");
            }
        });
    }

    void onPickFileResult(int resultCode, Intent data) {
        String id = pendingPickId;
        pendingPickId = null;
        if (id == null) return;
        Uri uri = data == null ? null : data.getData();
        if (resultCode != Activity.RESULT_OK || uri == null) {
            callback(id, false, "cancelled");
            return;
        }
        network.execute(() -> {
            try (InputStream in = activity.getContentResolver().openInputStream(uri)) {
                if (in == null) throw new IllegalStateException("Could not open the file");
                ByteArrayOutputStream bytes = new ByteArrayOutputStream();
                byte[] buffer = new byte[16_384];
                for (int read; (read = in.read(buffer)) != -1; ) {
                    bytes.write(buffer, 0, read);
                    if (bytes.size() > 20_000_000) throw new IllegalStateException("That file is too large.");
                }
                String name = uri.getLastPathSegment();
                try (android.database.Cursor cursor = activity.getContentResolver().query(uri, new String[]{android.provider.OpenableColumns.DISPLAY_NAME}, null, null, null)) {
                    if (cursor != null && cursor.moveToFirst()) name = cursor.getString(0);
                } catch (Exception ignored) {
                    // Keep the name from the address.
                }
                JSONObject file = new JSONObject()
                        .put("name", name == null ? "" : name)
                        .put("type", String.valueOf(activity.getContentResolver().getType(uri)))
                        .put("data", android.util.Base64.encodeToString(bytes.toByteArray(), android.util.Base64.NO_WRAP));
                callback(id, true, file.toString());
            } catch (Exception error) {
                String message = error.getMessage();
                callback(id, false, message == null ? "The file could not be read" : message);
            }
        });
    }

    /** Automatic backups need a folder the app may keep writing to (Android 5.0+). */
    @JavascriptInterface
    public boolean canAutoBackup() {
        return Build.VERSION.SDK_INT >= 21;
    }

    /** Lets the user pick the folder for automatic backups; answers with the folder's name. */
    @JavascriptInterface
    public void chooseBackupFolder(String callbackId) {
        if (!canAutoBackup()) { callback(callbackId, false, "unsupported"); return; }
        pendingFolderId = callbackId;
        activity.runOnUiThread(() -> activity.startActivityForResult(AutoBackup.chooseFolderIntent(), MainActivity.REQUEST_BACKUP_FOLDER));
    }

    void onBackupFolderResult(int resultCode, Intent data) {
        String id = pendingFolderId;
        pendingFolderId = null;
        if (id == null) return;
        try {
            String name = resultCode == Activity.RESULT_OK && data != null ? AutoBackup.rememberFolder(activity, data.getData()) : null;
            callback(id, name != null, name != null ? name : "cancelled");
        } catch (Exception error) {
            callback(id, false, "That folder cannot be used");
        }
    }

    @JavascriptInterface
    public void forgetBackupFolder() {
        if (canAutoBackup()) AutoBackup.forgetFolder(activity);
    }

    /** Writes an automatic backup into the chosen folder, keeping the newest four. */
    @JavascriptInterface
    public void writeBackup(String callbackId, String fileName, String content) {
        network.execute(() -> {
            try {
                AutoBackup.write(activity, fileName, content);
                callback(callbackId, true, "saved");
            } catch (Exception error) {
                callback(callbackId, false, error.getMessage() == null ? "The backup could not be written" : error.getMessage());
            }
        });
    }

    /** Read aloud in cook mode: Android's web view has no speech of its own, so the phone's text-to-speech does it. */
    @JavascriptInterface
    public boolean canSpeak() {
        return Build.VERSION.SDK_INT >= 21;
    }

    /** Speaks [{text, lang}] in order, each in its own language (a step in the recipe's, a label in the app's). */
    @JavascriptInterface
    public void speak(String json) {
        if (!canSpeak()) return;
        activity.runOnUiThread(() -> {
            if (speech == null) {
                pendingSpeech = json;
                speech = new android.speech.tts.TextToSpeech(activity, status -> {
                    speechReady = status == android.speech.tts.TextToSpeech.SUCCESS;
                    if (speechReady && pendingSpeech != null) speakNow(pendingSpeech);
                    pendingSpeech = null;
                });
            } else if (speechReady) {
                speakNow(json);
            } else {
                pendingSpeech = json;
            }
        });
    }

    @android.annotation.TargetApi(21)
    private void speakNow(String json) {
        try {
            org.json.JSONArray parts = new org.json.JSONArray(json);
            speech.stop();
            for (int i = 0; i < parts.length(); i++) {
                org.json.JSONObject part = parts.getJSONObject(i);
                speech.setLanguage(java.util.Locale.forLanguageTag(part.optString("lang", "en")));
                speech.speak(part.optString("text", ""), android.speech.tts.TextToSpeech.QUEUE_ADD, null, "goodstock-" + i);
            }
        } catch (org.json.JSONException ignored) {
            // Nothing to say.
        }
    }

    @JavascriptInterface
    public void stopSpeaking() {
        activity.runOnUiThread(() -> { if (speech != null) speech.stop(); });
    }

    /** True when the phone can scan barcodes (Google's code scanner needs Android 5.0 and Play services). */
    @JavascriptInterface
    public boolean canScanBarcodes() {
        return Build.VERSION.SDK_INT >= 21;
    }

    /** Opens Google's barcode scanner and answers with the number of the scanned product barcode. */
    @JavascriptInterface
    public void scanBarcode(String callbackId) {
        if (!canScanBarcodes()) {
            callback(callbackId, false, "unsupported");
            return;
        }
        activity.runOnUiThread(() -> BarcodeScan.start(activity, (ok, value) -> callback(callbackId, ok, value)));
    }

    /** The shared folder for syncing without a server (see SyncFolder). */
    @JavascriptInterface
    public boolean canSyncFolder() {
        return Build.VERSION.SDK_INT >= 21;
    }

    @JavascriptInterface
    public void chooseSyncFolder(String callbackId) {
        if (!canSyncFolder()) { callback(callbackId, false, "unsupported"); return; }
        pendingSyncFolderId = callbackId;
        activity.runOnUiThread(() -> activity.startActivityForResult(AutoBackup.chooseFolderIntent(), MainActivity.REQUEST_SYNC_FOLDER));
    }

    void onSyncFolderResult(int resultCode, Intent data) {
        String id = pendingSyncFolderId;
        pendingSyncFolderId = null;
        if (id == null) return;
        try {
            String name = resultCode == Activity.RESULT_OK && data != null ? SyncFolder.rememberFolder(activity, data.getData()) : null;
            callback(id, name != null, name != null ? name : "cancelled");
        } catch (Exception error) {
            callback(id, false, "That folder cannot be used");
        }
    }

    @JavascriptInterface
    public void forgetSyncFolder() {
        if (canSyncFolder()) SyncFolder.forgetFolder(activity);
    }

    /** Folder work runs off the web view's thread, after the backups and web requests already queued. */
    private interface FolderWork { String run() throws Exception; }

    private void inBackground(String callbackId, FolderWork work) {
        network.execute(() -> {
            try {
                callback(callbackId, true, work.run());
            } catch (Exception error) {
                callback(callbackId, false, error.getMessage() == null ? "The shared folder could not be used" : error.getMessage());
            }
        });
    }

    @JavascriptInterface
    public void listSyncFolder(String callbackId) {
        inBackground(callbackId, () -> SyncFolder.list(activity));
    }

    @JavascriptInterface
    public void readSyncFile(String callbackId, String name) {
        inBackground(callbackId, () -> SyncFolder.read(activity, name));
    }

    @JavascriptInterface
    public void writeSyncFile(String callbackId, String name, String content) {
        inBackground(callbackId, () -> { SyncFolder.write(activity, name, content); return "saved"; });
    }

    /** Hosting the kitchen for the household on the Wi-Fi (see KitchenHost). */
    @JavascriptInterface
    public boolean canHostKitchen() {
        return true;
    }

    @JavascriptInterface
    public void startKitchenHost(String callbackId) {
        startKitchenHost(callbackId, null, null);
    }

    /** Also keeps the host running in the background (HostService), with a notification in the page's language. */
    @JavascriptInterface
    public void startKitchenHost(String callbackId, String title, String text) {
        inBackground(callbackId, () -> {
            String info = KitchenHost.start(activity);
            HostService.start(activity.getApplicationContext(), title, text);
            return info;
        });
    }

    @JavascriptInterface
    public void stopKitchenHost() {
        KitchenHost.stop(activity);
    }

    private void callback(String id, boolean ok, String payload) {
        String script = "window.__goodstockNativeCallback && window.__goodstockNativeCallback("
                + JSONObject.quote(id) + "," + ok + "," + JSONObject.quote(payload == null ? "" : payload) + ")";
        activity.runOnUiThread(() -> webView.evaluateJavascript(script, null));
    }
}
