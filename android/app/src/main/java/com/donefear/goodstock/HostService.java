package com.donefear.goodstock;

import android.app.Notification;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

/**
 * Keeps a hosted kitchen (KitchenHost) reachable while the screen is off or Goodstock is in the background: a
 * foreground service with a quiet "sharing your kitchen" notification, holding a partial wake lock and a Wi-Fi lock so
 * the phone keeps answering the other devices. Without it Android freezes or stops the app within minutes. When
 * Android restarts the service after stopping the app, the host is resumed from its saved PIN and kitchen.
 */
public class HostService extends Service {
    private PowerManager.WakeLock wakeLock;
    private WifiManager.WifiLock wifiLock;

    /** Starts (or refreshes the notification of) the service; the title and text are written by the page. */
    static void start(Context context, String title, String text) {
        Intent intent = new Intent(context, HostService.class).putExtra("title", title).putExtra("text", text);
        if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent);
        else context.startService(intent);
    }

    static void stop(Context context) {
        context.stopService(new Intent(context, HostService.class));
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String title = intent == null ? null : intent.getStringExtra("title");
        String text = intent == null ? null : intent.getStringExtra("text");
        String[] notice = KitchenHost.notice(this, title, text);
        Notification notification = Notifications.hosting(this, notice[0], notice[1]);
        try {
            if (Build.VERSION.SDK_INT >= 34) startForeground(Notifications.HOSTING_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
            else startForeground(Notifications.HOSTING_ID, notification);
        } catch (RuntimeException notAllowed) {
            // Android 12+ may refuse a foreground service started from the background; the app resumes it when opened.
            stopSelf();
            return START_NOT_STICKY;
        }
        holdLocks();
        if (intent == null) {
            // Restarted by Android after it stopped the app: bring the host back, unless hosting was stopped meanwhile.
            new Thread(() -> { if (!KitchenHost.resume(getApplicationContext())) stopSelf(); }, "goodstock-host-resume").start();
        }
        return START_STICKY;
    }

    @SuppressWarnings("deprecation")
    private void holdLocks() {
        if (wakeLock == null) {
            PowerManager power = (PowerManager) getSystemService(Context.POWER_SERVICE);
            wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "goodstock:host");
            wakeLock.setReferenceCounted(false);
            wakeLock.acquire();
        }
        if (wifiLock == null) {
            WifiManager wifi = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            if (wifi != null) {
                wifiLock = wifi.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "goodstock:host");
                wifiLock.setReferenceCounted(false);
                wifiLock.acquire();
            }
        }
    }

    @Override
    public void onDestroy() {
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        if (wifiLock != null && wifiLock.isHeld()) wifiLock.release();
        wakeLock = null;
        wifiLock = null;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
