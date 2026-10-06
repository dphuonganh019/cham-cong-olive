package vn.olive.chamcong;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.location.Location;

import com.google.android.gms.location.Geofence;
import com.google.android.gms.location.GeofencingEvent;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/** Nhận sự kiện vào / ở lại / rời vùng chấm công, kể cả khi app đã tắt. */
public class GeofenceReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        GeofencingEvent ev = GeofencingEvent.fromIntent(intent);
        if (ev == null || ev.hasError()) return;
        int tr = ev.getGeofenceTransition();
        String type;
        if (tr == Geofence.GEOFENCE_TRANSITION_ENTER) type = "enter";
        else if (tr == Geofence.GEOFENCE_TRANSITION_DWELL) type = "dwell";
        else if (tr == Geofence.GEOFENCE_TRANSITION_EXIT) type = "exit";
        else return;

        long now = System.currentTimeMillis(), time = now;
        Location loc = ev.getTriggeringLocation();
        if (loc != null && loc.getTime() > 0 && loc.getTime() <= now && now - loc.getTime() < 30L * 60 * 1000) {
            time = loc.getTime();
        }
        GeofenceStore.appendEvent(context, type, time);

        SimpleDateFormat hm = new SimpleDateFormat("HH:mm", Locale.getDefault());
        if (type.equals("dwell")) {
            int dwellMin = GeofenceStore.prefs(context).getInt("dwellMin", 5);
            String arrived = hm.format(new Date(time - dwellMin * 60L * 1000));
            GeofenceStore.notify(context, 1, "Đã tới chỗ làm", "Ghi nhận có mặt từ " + arrived + ". Mở app để xem công hôm nay.");
        } else if (type.equals("exit")) {
            GeofenceStore.notify(context, 2, "Đã rời chỗ làm", "Lúc " + hm.format(new Date(time)) + ". App sẽ tự xét công tác hoặc check out.");
        }
    }
}
