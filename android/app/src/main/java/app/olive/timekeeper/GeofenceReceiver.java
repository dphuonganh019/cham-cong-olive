package app.olive.timekeeper;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.location.Location;

import com.google.android.gms.location.Geofence;
import com.google.android.gms.location.GeofencingEvent;

import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * Receives enter / dwell / exit signals for the office zone, even when the app is closed.
 * Android detects zones with battery-saving positioning (sometimes cell towers only, off by kilometres),
 * so every "entered" signal is re-measured with high-accuracy GPS before it counts.
 */
public class GeofenceReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        GeofencingEvent ev = GeofencingEvent.fromIntent(intent);
        if (ev == null || ev.hasError()) return;
        int tr = ev.getGeofenceTransition();
        final String type;
        if (tr == Geofence.GEOFENCE_TRANSITION_ENTER) type = "enter";
        else if (tr == Geofence.GEOFENCE_TRANSITION_DWELL) type = "dwell";
        else if (tr == Geofence.GEOFENCE_TRANSITION_EXIT) type = "exit";
        else return;

        long now = System.currentTimeMillis();
        long t = now;
        final Location trig = ev.getTriggeringLocation();
        if (trig != null && trig.getTime() > 0 && trig.getTime() <= now && now - trig.getTime() < 30L * 60 * 1000) {
            t = trig.getTime();
        }
        final long time = t;
        final Context c = context.getApplicationContext();
        final PendingResult pr = goAsync();
        LocationCheck.fresh(c, trig, (loc, fresh) -> {
            try { handle(c, type, time, loc, fresh); }
            finally { pr.finish(); }
        });
    }

    private static void handle(Context c, String type, long time, Location loc, boolean fresh) {
        JSONObject o = GeofenceStore.describe(c, type, time, loc, fresh, "geofence");
        if (TrackingService.running) {
            // Active tracking is running and more accurate: zone signals are only logged for reference
            try { o.put("info", true); o.remove("rejected"); } catch (org.json.JSONException ignored) {}
            GeofenceStore.appendEvent(c, o);
            return;
        }
        GeofenceStore.appendEvent(c, o);
        if (o.optBoolean("rejected", false)) {
            // False alarm: keep re-checking so the real arrival isn't missed
            RecheckReceiver.scheduleFirst(c);
            return;
        }
        if (type.equals("dwell") || type.equals("exit")) RecheckReceiver.cancel(c);

        SimpleDateFormat hm = new SimpleDateFormat("HH:mm", Locale.getDefault());
        if (type.equals("dwell")) {
            int dwellMin = GeofenceStore.prefs(c).getInt("dwellMin", 5);
            String arrived = hm.format(new Date(time - dwellMin * 60L * 1000));
            GeofenceStore.notify(c, 1, I18n.t(c, "arrived.title"), I18n.t(c, "arrived.text", arrived));
        } else if (type.equals("exit")) {
            GeofenceStore.notify(c, 2, I18n.t(c, "left.title"), I18n.t(c, "left.text", hm.format(new Date(time))));
        }
    }
}
