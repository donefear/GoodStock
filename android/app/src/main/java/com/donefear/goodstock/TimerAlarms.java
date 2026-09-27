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

/** Mirrors the app's timers as exact system alarms, so they ring while the app is closed or the screen is off. */
final class TimerAlarms {
    private static final String PREFS = "goodstock-timers";
    private static final String IDS = "ids";

    private TimerAlarms() { }

    static synchronized void sync(Context context, String json) {
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        Set<String> previous = new HashSet<>(prefs.getStringSet(IDS, Collections.emptySet()));
        Set<String> current = new HashSet<>();
        try {
            JSONArray timers = new JSONArray(json);
            for (int i = 0; i < timers.length(); i++) {
                JSONObject timer = timers.getJSONObject(i);
                String id = timer.getString("id");
                current.add(id);
                PendingIntent alarm = alarmIntent(context, id, timer.optString("title", "Timer"), timer.optString("text", ""));
                long endsAt = timer.optLong("endsAt", 0);
                if (!timer.optBoolean("done") && endsAt > System.currentTimeMillis()) schedule(alarms, endsAt, alarm);
                else alarms.cancel(alarm);
            }
        } catch (JSONException ignored) {
            // Keep the alarms we already have.
            return;
        }
        // Timers removed in the app: cancel their alarm and silence a notification that may still be ringing.
        for (String id : previous) {
            if (current.contains(id)) continue;
            alarms.cancel(alarmIntent(context, id, "", ""));
            Notifications.cancelTimer(context, id);
        }
        prefs.edit().putStringSet(IDS, current).apply();
    }

    static Set<String> ids(Context context) {
        return new HashSet<>(context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getStringSet(IDS, Collections.emptySet()));
    }

    private static void schedule(AlarmManager alarms, long at, PendingIntent alarm) {
        if (Build.VERSION.SDK_INT >= 31 && !alarms.canScheduleExactAlarms()) {
            alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, alarm);
        } else if (Build.VERSION.SDK_INT >= 23) {
            alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, alarm);
        } else {
            // Android 5 has no Doze mode, so a plain exact alarm is enough.
            alarms.setExact(AlarmManager.RTC_WAKEUP, at, alarm);
        }
    }

    private static PendingIntent alarmIntent(Context context, String id, String title, String text) {
        Intent intent = new Intent(context, TimerAlarmReceiver.class)
                .setAction("com.donefear.goodstock.TIMER")
                .setData(Uri.parse("goodstock-timer:" + Uri.encode(id)))
                .putExtra("id", id)
                .putExtra("title", title)
                .putExtra("text", text);
        return PendingIntent.getBroadcast(context, id.hashCode(), intent, PendingIntent.FLAG_UPDATE_CURRENT | Notifications.immutable());
    }
}
