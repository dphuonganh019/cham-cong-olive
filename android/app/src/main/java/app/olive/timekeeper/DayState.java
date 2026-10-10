package app.olive.timekeeper;

import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;

import org.json.JSONException;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Date;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

/**
 * Today's check-in state on the Android side (shared by the widget, notifications and the tracking service),
 * plus the work-schedule settings sent down by the app.
 */
final class DayState {
    private DayState() {}

    static SharedPreferences p(Context c) { return GeofenceStore.prefs(c); }

    static String dateKey(long ms) {
        return new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date(ms));
    }

    static String hm(long ms) {
        return new SimpleDateFormat("HH:mm", Locale.US).format(new Date(ms));
    }

    static int minOfDay(long ms) {
        Calendar cal = Calendar.getInstance();
        cal.setTimeInMillis(ms);
        return cal.get(Calendar.HOUR_OF_DAY) * 60 + cal.get(Calendar.MINUTE);
    }

    static int toMin(String hm, int def) {
        try {
            String[] a = hm.split(":");
            return Integer.parseInt(a[0]) * 60 + Integer.parseInt(a[1]);
        } catch (Exception e) { return def; }
    }

    /* ---------- Work schedule ---------- */

    static void saveSchedule(Context c, String trackStart, String trackEnd, String cutoff, Set<String> offDays,
                             String lunchStart, String lunchEnd, int finalizeMin) {
        p(c).edit()
            .putInt("trackStart", toMin(trackStart, 5 * 60 + 30))
            .putInt("trackEnd", toMin(trackEnd, 20 * 60))
            .putInt("cutoff", toMin(cutoff, 15 * 60))
            .putStringSet("offDays", new HashSet<>(offDays))
            .putInt("lunchStart", toMin(lunchStart, 12 * 60))
            .putInt("lunchEnd", toMin(lunchEnd, 13 * 60))
            .putInt("finalizeMin", Math.max(5, finalizeMin))
            .apply();
    }

    /**
     * Left before the cutoff and not back: the minute of the day when the departure becomes the check-out.
     * Same rule as leaveFinalMin() in src/core.js: wait finalizeMin (60) minutes, and when leaving from
     * 30 minutes before lunch until lunch ends, wait until 30 minutes after lunch.
     */
    static int finalizeAtMin(Context c, int depMin) {
        int ls = p(c).getInt("lunchStart", 12 * 60), le = p(c).getInt("lunchEnd", 13 * 60);
        int at = depMin + p(c).getInt("finalizeMin", 60);
        if (depMin >= ls - 30 && depMin < le) at = Math.max(at, le + 30);
        return at;
    }

    static int trackStart(Context c) { return p(c).getInt("trackStart", 5 * 60 + 30); }
    static int trackEnd(Context c) { return p(c).getInt("trackEnd", 20 * 60); }
    static int cutoff(Context c) { return p(c).getInt("cutoff", 15 * 60); }

    /** Monday–Saturday and not a public holiday / compensatory day off. */
    static boolean isWorkDay(Context c, long ms) {
        Calendar cal = Calendar.getInstance();
        cal.setTimeInMillis(ms);
        if (cal.get(Calendar.DAY_OF_WEEK) == Calendar.SUNDAY) return false;
        Set<String> off = p(c).getStringSet("offDays", new HashSet<>());
        return !off.contains(dateKey(ms));
    }

    /** Within a workday's tracking hours, and today hasn't been ended. */
    static boolean shouldTrackNow(Context c) {
        long now = System.currentTimeMillis();
        if (!GeofenceStore.hasConfig(c) || !isWorkDay(c, now) || isDone(c)) return false;
        int m = minOfDay(now);
        return m >= trackStart(c) && m < trackEnd(c) && !hasOut(c);
    }

    /* ---------- Today's check-in / check-out ---------- */

    private static void rollDay(Context c) {
        String today = dateKey(System.currentTimeMillis());
        if (!today.equals(p(c).getString("todayDate", ""))) {
            p(c).edit().putString("todayDate", today)
                .remove("todayIn").remove("todayOut").remove("todayProv").remove("todayDone")
                .remove("lastPunch").apply();
        }
    }

    static String todayIn(Context c) { rollDay(c); return p(c).getString("todayIn", ""); }
    static String todayOut(Context c) { rollDay(c); return p(c).getString("todayOut", ""); }
    /** Provisional check-out: left before the cutoff and not back yet ("" if none). */
    static String todayProv(Context c) { rollDay(c); return p(c).getString("todayProv", ""); }
    static boolean hasIn(Context c) { return !todayIn(c).isEmpty(); }
    static boolean hasOut(Context c) { return !todayOut(c).isEmpty(); }
    static boolean isDone(Context c) { rollDay(c); return p(c).getBoolean("todayDone", false); }

    static void setDone(Context c, boolean done) { rollDay(c); p(c).edit().putBoolean("todayDone", done).apply(); }

    /** The app sends today's effective check-in/out times (manual or GPS). */
    static void setToday(Context c, String date, String in, String out, String prov) {
        rollDay(c);
        if (!date.equals(p(c).getString("todayDate", ""))) return;
        p(c).edit().putString("todayIn", in == null ? "" : in).putString("todayOut", out == null ? "" : out)
            .putString("todayProv", out != null && !out.isEmpty() || prov == null ? "" : prov).apply();
        refreshWidgets(c);
    }

    static void setProv(Context c, String hm) {
        rollDay(c);
        p(c).edit().putString("todayProv", hm == null ? "" : hm).apply();
        refreshWidgets(c);
    }

    /**
     * Makes the provisional check-out the check-out (widget, notification, or the waiting time has passed).
     * Queues a "finalize" event for the app and ends today. Returns the check-out time, or null if there was none.
     */
    static String finalizeLeave(Context c, long time, String src) {
        String at = todayProv(c);
        if (at.isEmpty() || hasOut(c)) return null;
        JSONObject o = new JSONObject();
        try {
            o.put("type", "finalize");
            o.put("time", time);
            o.put("src", src);
            o.put("at", at);
        } catch (JSONException ignored) {}
        GeofenceStore.appendEvent(c, o);
        p(c).edit().putLong("lastPunch", time).apply();
        setOut(c, at);
        setDone(c, true);
        return at;
    }

    static void setIn(Context c, String hm) {
        rollDay(c);
        if (p(c).getString("todayIn", "").isEmpty()) p(c).edit().putString("todayIn", hm).apply();
        refreshWidgets(c);
    }

    static void setOut(Context c, String hm) {
        rollDay(c);
        p(c).edit().putString("todayOut", hm).putString("todayProv", "").apply();
        refreshWidgets(c);
    }

    /**
     * Quick Check in / Check out (widget or notification): checks in if there is no check-in yet, otherwise checks out.
     * Returns "in" or "out", or null if the last tap was less than a minute ago (guards against double taps).
     */
    static String punch(Context c, String forceKind, long time, String src) {
        rollDay(c);
        long last = p(c).getLong("lastPunch", 0);
        if (forceKind == null && time - last < 60_000) return null;
        String kind = forceKind != null ? forceKind : (hasIn(c) ? "out" : "in");
        JSONObject o = new JSONObject();
        try {
            o.put("type", "punch");
            o.put("kind", kind);
            o.put("time", time);
            o.put("src", src);
        } catch (JSONException ignored) {}
        GeofenceStore.appendEvent(c, o);
        p(c).edit().putLong("lastPunch", time).apply();
        if (kind.equals("in")) setIn(c, hm(time)); else setOut(c, hm(time));
        return kind;
    }

    static void refreshWidgets(Context c) {
        Context app = c.getApplicationContext();
        AppWidgetManager m = AppWidgetManager.getInstance(app);
        int[] ids = m.getAppWidgetIds(new ComponentName(app, OliveWidget.class));
        if (ids == null || ids.length == 0) return;
        Intent i = new Intent(app, OliveWidget.class).setAction(AppWidgetManager.ACTION_APPWIDGET_UPDATE)
            .putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids);
        app.sendBroadcast(i);
    }
}
