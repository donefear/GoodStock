package com.donefear.goodstock;

import android.annotation.TargetApi;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.regex.Pattern;

/**
 * The shared folder for syncing without a server (see app/sync.js): a folder the user picked once, which another app
 * keeps in step between the household's devices. Each device writes goodstock-sync-&lt;device&gt;.json and reads the
 * others'. Access goes through the Storage Access Framework like AutoBackup, so it needs Android 5.0.
 */
@TargetApi(21)
final class SyncFolder {
    private static final String PREFS = "goodstock-sync-folder";
    private static final String FOLDER = "folder";
    private static final Pattern SYNC_FILE = Pattern.compile("^goodstock-sync-[\\w-]{4,64}\\.json$");
    private static final int MAX_FILE_BYTES = 30_000_000;

    private SyncFolder() { }

    static String rememberFolder(Context context, Uri tree) {
        if (tree == null) return null;
        context.getContentResolver().takePersistableUriPermission(tree, Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(FOLDER, tree.toString()).apply();
        Uri folder = DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
        try (Cursor cursor = context.getContentResolver().query(folder, new String[]{DocumentsContract.Document.COLUMN_DISPLAY_NAME}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) return cursor.getString(0);
        } catch (Exception ignored) {
            // Fall back to the last part of the address.
        }
        String id = DocumentsContract.getTreeDocumentId(tree);
        return id.substring(id.lastIndexOf(':') + 1);
    }

    static void forgetFolder(Context context) {
        String saved = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(FOLDER, null);
        if (saved != null) {
            try {
                context.getContentResolver().releasePersistableUriPermission(Uri.parse(saved), Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            } catch (SecurityException ignored) {
                // Already gone.
            }
        }
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(FOLDER).apply();
    }

    private static Uri tree(Context context) {
        String saved = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(FOLDER, null);
        if (saved == null) throw new IllegalStateException("No shared folder chosen");
        return Uri.parse(saved);
    }

    /** The sync files in the folder as JSON: [{name, modified, size}]. */
    static String list(Context context) throws Exception {
        Uri tree = tree(context);
        JSONArray files = new JSONArray();
        Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
        String[] columns = {DocumentsContract.Document.COLUMN_DISPLAY_NAME, DocumentsContract.Document.COLUMN_LAST_MODIFIED, DocumentsContract.Document.COLUMN_SIZE};
        try (Cursor cursor = context.getContentResolver().query(children, columns, null, null, null)) {
            if (cursor == null) throw new IllegalStateException("The shared folder could not be read");
            while (cursor.moveToNext()) {
                String name = cursor.getString(0);
                if (name == null || !SYNC_FILE.matcher(name).matches()) continue;
                files.put(new JSONObject().put("name", name).put("modified", cursor.getLong(1)).put("size", cursor.getLong(2)));
            }
        }
        return files.toString();
    }

    private static String findDocument(ContentResolver resolver, Uri tree, String name) {
        Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
        try (Cursor cursor = resolver.query(children, new String[]{DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME}, null, null, null)) {
            while (cursor != null && cursor.moveToNext()) if (name.equals(cursor.getString(1))) return cursor.getString(0);
        }
        return null;
    }

    static String read(Context context, String name) throws Exception {
        if (!SYNC_FILE.matcher(name).matches()) throw new IllegalArgumentException("Not a Goodstock sync file");
        Uri tree = tree(context);
        ContentResolver resolver = context.getContentResolver();
        String id = findDocument(resolver, tree, name);
        if (id == null) throw new IllegalStateException("File not found");
        try (InputStream in = resolver.openInputStream(DocumentsContract.buildDocumentUriUsingTree(tree, id))) {
            if (in == null) throw new IllegalStateException("The file could not be read");
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buffer = new byte[16_384];
            int read;
            while ((read = in.read(buffer)) != -1) {
                out.write(buffer, 0, read);
                if (out.size() > MAX_FILE_BYTES) throw new IllegalStateException("The file is too large");
            }
            return new String(out.toByteArray(), StandardCharsets.UTF_8);
        }
    }

    /** Replaces this device's file in place (keeping its document, so sync apps see one changed file). */
    static void write(Context context, String name, String content) throws Exception {
        if (!SYNC_FILE.matcher(name).matches()) throw new IllegalArgumentException("Not a Goodstock sync file");
        Uri tree = tree(context);
        ContentResolver resolver = context.getContentResolver();
        String id = findDocument(resolver, tree, name);
        Uri file = id != null
                ? DocumentsContract.buildDocumentUriUsingTree(tree, id)
                : DocumentsContract.createDocument(resolver, DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree)), "application/json", name);
        if (file == null) throw new IllegalStateException("The file could not be created in that folder");
        try (OutputStream out = resolver.openOutputStream(file, "wt")) {
            if (out == null) throw new IllegalStateException("The file could not be written");
            out.write(content.getBytes(StandardCharsets.UTF_8));
        }
    }
}
