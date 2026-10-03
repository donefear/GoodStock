package com.donefear.goodstock;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.Collections;
import java.util.HashSet;
import java.util.Set;

/**
 * The daily use-soon reminders, scheduled ahead by the app ([{id, at, title, text}], one per morning with what is due
 * that day), so they arrive while the app is closed. Each call replaces the previous list. Reminders are not exact:
 * Android may deliver them a few minutes late to save battery.
 */
final class ReminderAlarms {
    private static final String PREFS = "goodstock-reminders";
    private static final String IDS = "ids";

    private ReminderAlarms() { }

    static synchronized void sync(Context context, String json) {
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        Set<String> previous = new HashSet<>(prefs.getStringSet(IDS, Collections.emptySet()));
        Set<String> current = new HashSet<>();
        try {
            JSONArray reminders = new JSONArray(json);
            for (int i = 0; i < reminders.length(); i++) {
                JSONObject reminder = reminders.getJSONObject(i);
                String id = reminder.getString("id");
                long at = reminder.optLong("at", 0);
                if (at <= System.currentTimeMillis()) continue;
                current.add(id);
                PendingIntent alarm = intent(context, id, reminder.optString("title", ""), reminder.optString("text", ""));
                if (Build.VERSION.SDK_INT >= 23) alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, alarm);
                else alarms.set(AlarmManager.RTC_WAKEUP, at, alarm);
            }
        } catch (JSONException ignored) {
            return;
        }
        for (String id : previous) {
            if (!current.contains(id)) alarms.cancel(intent(context, id, "", ""));
        }
        prefs.edit().putStringSet(IDS, current).apply();
    }

    private static PendingIntent intent(Context context, String id, String title, String text) {
        Intent intent = new Intent(context, ReminderReceiver.class)
                .setAction("com.donefear.goodstock.REMINDER")
                .setData(Uri.parse("goodstock-reminder:" + Uri.encode(id)))
                .putExtra("title", title)
                .putExtra("text", text);
        return PendingIntent.getBroadcast(context, id.hashCode(), intent, PendingIntent.FLAG_UPDATE_CURRENT | Notifications.immutable());
    }
}
