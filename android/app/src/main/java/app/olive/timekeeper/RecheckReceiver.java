package app.olive.timekeeper;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.location.Location;
import android.os.SystemClock;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * After a false "entered" signal is ignored, Android still believes the phone is inside the zone,
 * so it won't signal again when you really arrive. This receiver measures the location every
 * 5 minutes (for up to an hour) to catch the real arrival; after an hour it re-registers the zone
 * so Android starts over.
 */
public class RecheckReceiver extends BroadcastReceiver {
    static final String STAGE_ENTER = "enter";
    static final String STAGE_DWELL = "dwell";
    private static final String ACTION = "app.olive.timekeeper.RECHECK";
    private static final long STEP_MS = 5 * 60 * 1000L;
    private static final int MAX_ATTEMPTS = 12;
    private static final int REQ = 7003;

    private static PendingIntent pending(Context c, Intent i) {
        return PendingIntent.getBroadcast(c.getApplicationContext(), REQ, i,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static void schedule(Context c, String stage, int attempt, long delayMs) {
        Intent i = new Intent(c.getApplicationContext(), RecheckReceiver.class).setAction(ACTION)
            .putExtra("stage", stage).putExtra("attempt", attempt);
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        am.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, SystemClock.elapsedRealtime() + delayMs, pending(c, i));
        GeofenceStore.prefs(c).edit().putBoolean("recheckActive", true).apply();
    }

    static void scheduleFirst(Context c) {
        schedule(c, STAGE_ENTER, 1, STEP_MS);
    }

    static void cancel(Context c) {
        Intent i = new Intent(c.getApplicationContext(), RecheckReceiver.class).setAction(ACTION);
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        if (am != null) am.cancel(pending(c, i));
        GeofenceStore.prefs(c).edit().putBoolean("recheckActive", false).apply();
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        final Context c = context.getApplicationContext();
        final String stage = intent.getStringExtra("stage") != null ? intent.getStringExtra("stage") : STAGE_ENTER;
        final int attempt = intent.getIntExtra("attempt", 1);
        GeofenceStore.prefs(c).edit().putBoolean("recheckActive", false).apply();
        if (!GeofenceStore.hasConfig(c) || TrackingService.running) return;
        final PendingResult pr = goAsync();
        LocationCheck.fresh(c, null, (loc, fresh) -> {
            try { handle(c, stage, attempt, loc, fresh); }
            finally { pr.finish(); }
        });
    }

    private static void handle(Context c, String stage, int attempt, Location loc, boolean fresh) {
        long now = System.currentTimeMillis();
        boolean inside = loc != null && fresh && GeofenceStore.isInside(c, loc);
        long dwellMs = Math.max(1, GeofenceStore.prefs(c).getInt("dwellMin", 5)) * 60L * 1000;
        if (STAGE_ENTER.equals(stage)) {
            if (inside) {
                GeofenceStore.appendEvent(c, GeofenceStore.describe(c, "enter", now, loc, true, "recheck"));
                schedule(c, STAGE_DWELL, 0, dwellMs);
            } else if (attempt < MAX_ATTEMPTS) {
                schedule(c, STAGE_ENTER, attempt + 1, STEP_MS);
            } else {
                GeofenceStore.register(c, true, null);
            }
        } else {
            if (inside) {
                GeofenceStore.appendEvent(c, GeofenceStore.describe(c, "dwell", now, loc, true, "recheck"));
                String arrived = new SimpleDateFormat("HH:mm", Locale.getDefault()).format(new Date(now - dwellMs));
                GeofenceStore.notify(c, 1, I18n.t(c, "arrived.title"), I18n.t(c, "arrived.text", arrived));
            } else {
                GeofenceStore.appendEvent(c, GeofenceStore.describe(c, "exit", now, loc, fresh, "recheck"));
                schedule(c, STAGE_ENTER, 1, STEP_MS);
            }
        }
    }
}
