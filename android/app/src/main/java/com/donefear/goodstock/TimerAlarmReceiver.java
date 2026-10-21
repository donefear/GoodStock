package com.donefear.goodstock;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** A timer ended. If the app is on screen it rings there already; otherwise post a ringing notification. */
public class TimerAlarmReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (MainActivity.visible) return;
        Notifications.showTimer(context, intent.getStringExtra("id"), intent.getStringExtra("title"), intent.getStringExtra("text"));
    }
}
