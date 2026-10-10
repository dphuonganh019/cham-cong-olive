package app.olive.timekeeper;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;
import android.widget.Toast;

import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Locale;

/** Home-screen widget: shows today's check-in/out times and checks you in or out with one tap, without opening the app. */
public class OliveWidget extends AppWidgetProvider {
    static final String ACTION_PUNCH = "app.olive.timekeeper.WIDGET_PUNCH";

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        for (int id : ids) manager.updateAppWidget(id, views(context));
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        if (ACTION_PUNCH.equals(intent.getAction())) {
            long now = System.currentTimeMillis();
            String kind = DayState.punch(context, null, now, "widget");
            if (kind == null) {
                Toast.makeText(context, I18n.t(context, "widget.tooSoon"), Toast.LENGTH_SHORT).show();
            } else if (kind.equals("in")) {
                Toast.makeText(context, I18n.t(context, "checkedIn", DayState.hm(now)), Toast.LENGTH_SHORT).show();
                TrackingService.send(context, TrackingService.A_REFRESH);
            } else {
                Toast.makeText(context, I18n.t(context, "checkedOut", DayState.hm(now)), Toast.LENGTH_SHORT).show();
                DayState.setDone(context, true);
                TrackingService.send(context, TrackingService.A_REFRESH);
            }
            DayState.refreshWidgets(context);
            return;
        }
        super.onReceive(context, intent);
    }

    static RemoteViews views(Context c) {
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_olive);
        Calendar cal = Calendar.getInstance();
        String day = I18n.vi(c)
            ? String.format(Locale.US, "%02d/%02d", cal.get(Calendar.DAY_OF_MONTH), cal.get(Calendar.MONTH) + 1)
            : new SimpleDateFormat("d MMM", Locale.ENGLISH).format(cal.getTime());
        String date = I18n.t(c, "dow." + cal.get(Calendar.DAY_OF_WEEK)) + ", " + day;
        String in = DayState.todayIn(c), out = DayState.todayOut(c);
        v.setTextViewText(R.id.w_date, date);
        v.setTextViewText(R.id.w_in_label, I18n.t(c, "widget.in"));
        v.setTextViewText(R.id.w_out_label, I18n.t(c, "widget.out"));
        v.setTextViewText(R.id.w_in, in.isEmpty() ? "--:--" : in);
        v.setTextViewText(R.id.w_out, out.isEmpty() ? "--:--" : out);
        String label = I18n.t(c, in.isEmpty() ? "widget.btnIn" : out.isEmpty() ? "widget.btnOut" : "widget.btnUpdate");
        v.setTextViewText(R.id.w_button, label);

        Intent punch = new Intent(c, OliveWidget.class).setAction(ACTION_PUNCH);
        v.setOnClickPendingIntent(R.id.w_button,
            PendingIntent.getBroadcast(c, 7020, punch, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
        Intent open = new Intent(c, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        v.setOnClickPendingIntent(R.id.w_info,
            PendingIntent.getActivity(c, 7021, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
        return v;
    }
}
