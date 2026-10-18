package com.donefear.goodstock;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Android forgets every alarm when the phone restarts (and may when the app is updated). Schedule the use-soon
 * reminders and running timers again from the last lists the app gave, so they arrive without opening Goodstock first.
 */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent == null ? null : intent.getAction();
        if (!Intent.ACTION_BOOT_COMPLETED.equals(action) && !Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) return;
        ReminderAlarms.restore(context);
        TimerAlarms.restore(context);
    }
}
