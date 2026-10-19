package com.donefear.goodstock;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.widget.RemoteViews;

import org.json.JSONObject;

/**
 * Home-screen widget: what to use soon and how much is on the shopping list. The page writes the text in the app's
 * language (NativeBridge.setWidget) whenever the kitchen changes, so the widget needs no data of its own and works
 * with the app closed. Tapping it opens the app on the Inventory or the Shopping page.
 */
public class KitchenWidget extends AppWidgetProvider {
    static final String PREFS = "goodstock-widget";
    static final String TEXT = "text";
    static final String EXTRA_VIEW = "goodstock_view";

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        manager.updateAppWidget(ids, views(context));
    }

    /** Stores the page's text and redraws every placed widget. */
    static void update(Context context, String json) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(TEXT, json).apply();
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, KitchenWidget.class));
        if (ids != null && ids.length > 0) manager.updateAppWidget(ids, views(context));
    }

    private static RemoteViews views(Context context) {
        JSONObject text;
        try {
            text = new JSONObject(context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(TEXT, "{}"));
        } catch (Exception error) {
            text = new JSONObject();
        }
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.kitchen_widget);
        views.setTextViewText(R.id.widget_soon_title, text.optString("soonTitle", context.getString(R.string.app_name)));
        views.setTextViewText(R.id.widget_soon, text.optString("soon", context.getString(R.string.widget_open)));
        views.setTextViewText(R.id.widget_shopping, text.optString("shopping", ""));
        views.setOnClickPendingIntent(R.id.widget_soon_box, open(context, "inventory", 0));
        views.setOnClickPendingIntent(R.id.widget_shopping, open(context, "shopping", 1));
        return views;
    }

    private static PendingIntent open(Context context, String view, int code) {
        Intent intent = new Intent(context, MainActivity.class)
                .putExtra(EXTRA_VIEW, view)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
        return PendingIntent.getActivity(context, code, intent, flags);
    }
}
