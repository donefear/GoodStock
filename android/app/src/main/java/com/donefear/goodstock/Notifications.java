package com.donefear.goodstock;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.RingtoneManager;

final class Notifications {
    private static final String TIMERS = "timers";
    private static final String REMINDERS = "reminders";
    private static final int REMINDER_ID = 1;

    private Notifications() { }

    static void ensureChannels(Context context) {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        NotificationChannel timers = new NotificationChannel(TIMERS, "Timers", NotificationManager.IMPORTANCE_HIGH);
        timers.setDescription("Rings when a cooking timer ends");
        timers.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM), new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ALARM)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build());
        timers.enableVibration(true);
        timers.setVibrationPattern(new long[]{0, 600, 300, 600, 300, 600});
        NotificationChannel reminders = new NotificationChannel(REMINDERS, "Use-soon reminders", NotificationManager.IMPORTANCE_DEFAULT);
        reminders.setDescription("Daily note about food that expires soon");
        manager.createNotificationChannel(timers);
        manager.createNotificationChannel(reminders);
    }

    static boolean allowed(Context context) {
        return context.getSystemService(NotificationManager.class).areNotificationsEnabled();
    }

    /** Rings until it is opened or dismissed (FLAG_INSISTENT), like the in-app alarm. */
    static void showTimer(Context context, String id, String title, String text) {
        if (id == null || !allowed(context)) return;
        ensureChannels(context);
        Notification notification = new Notification.Builder(context, TIMERS)
                .setSmallIcon(R.drawable.ic_notification)
                .setContentTitle("⏰ Time is up: " + (title == null ? "Timer" : title))
                .setContentText((text == null || text.isEmpty() ? "Your timer" : text) + " · tap to open Goodstock")
                .setCategory(Notification.CATEGORY_ALARM)
                .setContentIntent(openApp(context))
                .setAutoCancel(true)
                .build();
        notification.flags |= Notification.FLAG_INSISTENT;
        context.getSystemService(NotificationManager.class).notify(notificationId(id), notification);
    }

    static void showReminder(Context context, String title, String text) {
        if (!allowed(context)) return;
        ensureChannels(context);
        Notification notification = new Notification.Builder(context, REMINDERS)
                .setSmallIcon(R.drawable.ic_notification)
                .setContentTitle(title)
                .setContentText(text)
                .setStyle(new Notification.BigTextStyle().bigText(text))
                .setContentIntent(openApp(context))
                .setAutoCancel(true)
                .build();
        context.getSystemService(NotificationManager.class).notify(REMINDER_ID, notification);
    }

    static void cancelTimer(Context context, String id) {
        context.getSystemService(NotificationManager.class).cancel(notificationId(id));
    }

    static void cancelTimerAlerts(Context context) {
        for (String id : TimerAlarms.ids(context)) cancelTimer(context, id);
    }

    private static PendingIntent openApp(Context context) {
        Intent intent = new Intent(context, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static int notificationId(String id) {
        return 1000 + (id.hashCode() & 0x3fffffff);
    }
}
