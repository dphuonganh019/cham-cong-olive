package vn.olive.chamcong;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import java.util.Calendar;

/** Hẹn giờ mỗi ngày: tới giờ bắt đầu (mặc định 5:30) thì bật chế độ chờ check in nếu là ngày làm việc. */
public class TrackingScheduler extends BroadcastReceiver {
    static final String ACTION = "vn.olive.chamcong.TRACK_ALARM";
    private static final int REQ = 7010;

    static void scheduleNext(Context c) {
        Context app = c.getApplicationContext();
        if (!GeofenceStore.hasConfig(app)) return;
        int start = DayState.trackStart(app);
        Calendar cal = Calendar.getInstance();
        long now = cal.getTimeInMillis();
        cal.set(Calendar.HOUR_OF_DAY, start / 60);
        cal.set(Calendar.MINUTE, start % 60);
        cal.set(Calendar.SECOND, 0);
        cal.set(Calendar.MILLISECOND, 0);
        if (cal.getTimeInMillis() <= now) cal.add(Calendar.DAY_OF_MONTH, 1);
        Intent i = new Intent(app, TrackingScheduler.class).setAction(ACTION);
        PendingIntent pi = PendingIntent.getBroadcast(app, REQ, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        AlarmManager am = (AlarmManager) app.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !am.canScheduleExactAlarms()) {
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, cal.getTimeInMillis(), pi);
            } else {
                am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, cal.getTimeInMillis(), pi);
            }
        } catch (SecurityException e) {
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, cal.getTimeInMillis(), pi);
        }
    }

    static boolean exactAllowed(Context c) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true;
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        return am != null && am.canScheduleExactAlarms();
    }

    /** Bật chế độ theo dõi nếu đang trong khung giờ của ngày làm việc và đã có quyền vị trí "mọi lúc". */
    static void maybeStart(Context c) {
        if (!TrackingService.running && GeofenceStore.hasBackground(c) && DayState.shouldTrackNow(c)) {
            TrackingService.start(c);
        }
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        scheduleNext(context);
        maybeStart(context);
        DayState.refreshWidgets(context);
    }
}
