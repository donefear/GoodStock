package com.donefear.goodstock;

import android.annotation.TargetApi;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;

import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Automatic backups into a folder the user picked once (Downloads, Google Drive, a USB stick…). The app keeps
 * permanent access to that folder, writes goodstock-auto-backup-YYYY-MM-DD.json into it and keeps the newest four.
 * Folder access through the Storage Access Framework needs Android 5.0.
 */
@TargetApi(21)
final class AutoBackup {
    private static final String PREFS = "goodstock-auto-backup";
    private static final String FOLDER = "folder";
    private static final String PREFIX = "goodstock-auto-backup-";
    private static final int KEEP = 4;

    private AutoBackup() { }

    static Intent chooseFolderIntent() {
        return new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
    }

    /** Keeps access to the picked folder and returns its name, or null when nothing was picked. */
    static String rememberFolder(Context context, Uri tree) {
        if (tree == null) return null;
        context.getContentResolver().takePersistableUriPermission(tree, Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(FOLDER, tree.toString()).apply();
        return folderName(context, tree);
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

    /** Writes one backup into the folder and removes all but the newest four automatic backups. */
    static void write(Context context, String fileName, String content) throws Exception {
        String saved = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(FOLDER, null);
        if (saved == null) throw new IllegalStateException("No backup folder chosen");
        Uri tree = Uri.parse(saved);
        ContentResolver resolver = context.getContentResolver();
        Uri folder = DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
        // Same name already there (a second backup the same day): replace it.
        List<String[]> backups = children(resolver, tree);
        for (String[] child : backups) {
            if (child[1].equals(fileName)) DocumentsContract.deleteDocument(resolver, DocumentsContract.buildDocumentUriUsingTree(tree, child[0]));
        }
        Uri file = DocumentsContract.createDocument(resolver, folder, "application/json", fileName);
        if (file == null) throw new IllegalStateException("The backup could not be created in that folder");
        try (OutputStream out = resolver.openOutputStream(file, "wt")) {
            if (out == null) throw new IllegalStateException("The backup could not be written");
            out.write(content.getBytes(StandardCharsets.UTF_8));
        }
        List<String> names = new ArrayList<>();
        for (String[] child : children(resolver, tree)) if (child[1].startsWith(PREFIX)) names.add(child[1] + "\n" + child[0]);
        Collections.sort(names, Collections.reverseOrder());
        for (int i = KEEP; i < names.size(); i++) {
            String id = names.get(i).substring(names.get(i).indexOf('\n') + 1);
            DocumentsContract.deleteDocument(resolver, DocumentsContract.buildDocumentUriUsingTree(tree, id));
        }
    }

    private static List<String[]> children(ContentResolver resolver, Uri tree) {
        List<String[]> result = new ArrayList<>();
        Uri list = DocumentsContract.buildChildDocumentsUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
        try (Cursor cursor = resolver.query(list, new String[]{DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME}, null, null, null)) {
            while (cursor != null && cursor.moveToNext()) result.add(new String[]{cursor.getString(0), cursor.getString(1)});
        }
        return result;
    }

    private static String folderName(Context context, Uri tree) {
        Uri folder = DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
        try (Cursor cursor = context.getContentResolver().query(folder, new String[]{DocumentsContract.Document.COLUMN_DISPLAY_NAME}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) return cursor.getString(0);
        } catch (Exception ignored) {
            // Fall back to the last part of the address.
        }
        String id = DocumentsContract.getTreeDocumentId(tree);
        return id.substring(id.lastIndexOf(':') + 1);
    }
}
