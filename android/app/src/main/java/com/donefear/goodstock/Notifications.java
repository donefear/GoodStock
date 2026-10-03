package com.donefear.goodstock;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.os.Build;

/** Timer and reminder notifications. Android 8+ uses channels; Android 5–7 set sound and priority per notification. */
final class Notifications {
    private static final String TIMERS = "timers";
    private static final String REMINDERS = "reminders";
    private static final int REMINDER_ID = 1;
    private static final long[] TIMER_VIBRATION = {0, 600, 300, 600, 300, 600};

    private Notifications() { }

    private static NotificationManager manager(Context context) {
        return (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
    }

    static void ensureChannels(Context context) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationChannel timers = new NotificationChannel(TIMERS, "Timers", NotificationManager.IMPORTANCE_HIGH);
        timers.setDescription("Rings when a cooking timer ends");
        timers.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM), alarmAudio());
        timers.enableVibration(true);
        timers.setVibrationPattern(TIMER_VIBRATION);
        NotificationChannel reminders = new NotificationChannel(REMINDERS, "Use-soon reminders", NotificationManager.IMPORTANCE_DEFAULT);
        reminders.setDescription("Daily note about food that expires soon");
        manager(context).createNotificationChannel(timers);
        manager(context).createNotificationChannel(reminders);
    }

    static boolean allowed(Context context) {
        return Build.VERSION.SDK_INT < 24 || manager(context).areNotificationsEnabled();
    }

    private static AudioAttributes alarmAudio() {
        return new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ALARM)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build();
    }

    @SuppressWarnings("deprecation")
    private static Notification.Builder builder(Context context, String channel) {
        if (Build.VERSION.SDK_INT >= 26) return new Notification.Builder(context, channel);
        Notification.Builder builder = new Notification.Builder(context);
        if (TIMERS.equals(channel)) {
            builder.setPriority(Notification.PRIORITY_MAX)
                    .setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM), alarmAudio())
                    .setVibrate(TIMER_VIBRATION);
        } else {
            builder.setPriority(Notification.PRIORITY_DEFAULT).setDefaults(Notification.DEFAULT_ALL);
        }
        return builder;
    }

    /** Rings until it is opened or dismissed (FLAG_INSISTENT), like the in-app alarm. */
    static void showTimer(Context context, String id, String title, String text) {
        if (id == null || !allowed(context)) return;
        ensureChannels(context);
        Notification notification = builder(context, TIMERS)
                .setSmallIcon(R.drawable.ic_notification)
                // The web app writes both lines in the chosen language ("⏰ Time is up: Pasta", "10 min · tap to open…").
                .setContentTitle(title == null || title.isEmpty() ? "⏰ Time is up" : title)
                .setContentText(text == null ? "" : text)
                .setCategory(Notification.CATEGORY_ALARM)
                .setContentIntent(openApp(context))
                .setAutoCancel(true)
                .build();
        notification.flags |= Notification.FLAG_INSISTENT;
        manager(context).notify(notificationId(id), notification);
    }

    static void showReminder(Context context, String title, String text) {
        if (!allowed(context)) return;
        ensureChannels(context);
        Notification notification = builder(context, REMINDERS)
                .setSmallIcon(R.drawable.ic_notification)
                .setContentTitle(title)
                .setContentText(text)
                .setStyle(new Notification.BigTextStyle().bigText(text))
                .setContentIntent(openApp(context))
                .setAutoCancel(true)
                .build();
        manager(context).notify(REMINDER_ID, notification);
    }

    static void cancelTimer(Context context, String id) {
        manager(context).cancel(notificationId(id));
    }

    static void cancelTimerAlerts(Context context) {
        for (String id : TimerAlarms.ids(context)) cancelTimer(context, id);
    }

    private static PendingIntent openApp(Context context) {
        Intent intent = new Intent(context, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT | immutable());
    }

    /** FLAG_IMMUTABLE exists from Android 6; older versions don't need it. */
    static int immutable() {
        return Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0;
    }

    private static int notificationId(String id) {
        return 1000 + (id.hashCode() & 0x3fffffff);
    }
}
