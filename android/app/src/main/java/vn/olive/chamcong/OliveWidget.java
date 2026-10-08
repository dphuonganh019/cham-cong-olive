package vn.olive.chamcong;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;
import android.widget.Toast;

import java.util.Calendar;

/** Widget màn hình chính: xem giờ vào/ra hôm nay và bấm Check in / Check out ngay, không cần mở app. */
public class OliveWidget extends AppWidgetProvider {
    static final String ACTION_PUNCH = "vn.olive.chamcong.WIDGET_PUNCH";
    private static final String[] DOW = { "", "Chủ nhật", "Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy" };

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
                Toast.makeText(context, "Bạn vừa bấm rồi. Đợi 1 phút nếu muốn bấm lại.", Toast.LENGTH_SHORT).show();
            } else if (kind.equals("in")) {
                Toast.makeText(context, "Đã check in lúc " + DayState.hm(now), Toast.LENGTH_SHORT).show();
                TrackingService.send(context, TrackingService.A_REFRESH);
            } else {
                Toast.makeText(context, "Đã check out lúc " + DayState.hm(now), Toast.LENGTH_SHORT).show();
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
        String date = DOW[cal.get(Calendar.DAY_OF_WEEK)] + ", "
            + String.format(java.util.Locale.US, "%02d/%02d", cal.get(Calendar.DAY_OF_MONTH), cal.get(Calendar.MONTH) + 1);
        String in = DayState.todayIn(c), out = DayState.todayOut(c);
        v.setTextViewText(R.id.w_date, date);
        v.setTextViewText(R.id.w_in, in.isEmpty() ? "--:--" : in);
        v.setTextViewText(R.id.w_out, out.isEmpty() ? "--:--" : out);
        String label = in.isEmpty() ? "CHECK IN" : out.isEmpty() ? "CHECK OUT" : "CẬP NHẬT GIỜ RA";
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
