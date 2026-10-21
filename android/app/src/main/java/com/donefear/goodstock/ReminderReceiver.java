package com.donefear.goodstock;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** A scheduled use-soon reminder is due: show it (the texts were written by the app in its language). */
public class ReminderReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        Notifications.showReminder(context, intent.getStringExtra("title"), intent.getStringExtra("text"));
    }
}
