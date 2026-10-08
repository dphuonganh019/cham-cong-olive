package vn.olive.chamcong;

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
 * Trạng thái chấm công của hôm nay phía Android (dùng chung cho widget, thông báo và dịch vụ theo dõi),
 * cùng các cài đặt lịch làm việc do app gửi xuống.
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

    /* ---------- Lịch làm việc ---------- */

    static void saveSchedule(Context c, String trackStart, String trackEnd, String cutoff, Set<String> offDays) {
        p(c).edit()
            .putInt("trackStart", toMin(trackStart, 5 * 60 + 30))
            .putInt("trackEnd", toMin(trackEnd, 20 * 60))
            .putInt("cutoff", toMin(cutoff, 15 * 60))
            .putStringSet("offDays", new HashSet<>(offDays))
            .apply();
    }

    static int trackStart(Context c) { return p(c).getInt("trackStart", 5 * 60 + 30); }
    static int trackEnd(Context c) { return p(c).getInt("trackEnd", 20 * 60); }
    static int cutoff(Context c) { return p(c).getInt("cutoff", 15 * 60); }

    /** T2–T7 và không phải ngày lễ / nghỉ bù. */
    static boolean isWorkDay(Context c, long ms) {
        Calendar cal = Calendar.getInstance();
        cal.setTimeInMillis(ms);
        if (cal.get(Calendar.DAY_OF_WEEK) == Calendar.SUNDAY) return false;
        Set<String> off = p(c).getStringSet("offDays", new HashSet<>());
        return !off.contains(dateKey(ms));
    }

    /** Đang trong khung theo dõi của một ngày làm việc và hôm nay chưa kết thúc. */
    static boolean shouldTrackNow(Context c) {
        long now = System.currentTimeMillis();
        if (!GeofenceStore.hasConfig(c) || !isWorkDay(c, now) || isDone(c)) return false;
        int m = minOfDay(now);
        return m >= trackStart(c) && m < trackEnd(c) && !hasOut(c);
    }

    /* ---------- Giờ vào / ra hôm nay ---------- */

    private static void rollDay(Context c) {
        String today = dateKey(System.currentTimeMillis());
        if (!today.equals(p(c).getString("todayDate", ""))) {
            p(c).edit().putString("todayDate", today)
                .remove("todayIn").remove("todayOut").remove("todayDone")
                .remove("lastPunch").apply();
        }
    }

    static String todayIn(Context c) { rollDay(c); return p(c).getString("todayIn", ""); }
    static String todayOut(Context c) { rollDay(c); return p(c).getString("todayOut", ""); }
    static boolean hasIn(Context c) { return !todayIn(c).isEmpty(); }
    static boolean hasOut(Context c) { return !todayOut(c).isEmpty(); }
    static boolean isDone(Context c) { rollDay(c); return p(c).getBoolean("todayDone", false); }

    static void setDone(Context c, boolean done) { rollDay(c); p(c).edit().putBoolean("todayDone", done).apply(); }

    /** App gửi giờ vào/ra hiệu lực của hôm nay (bấm tay hoặc GPS). */
    static void setToday(Context c, String date, String in, String out) {
        rollDay(c);
        if (!date.equals(p(c).getString("todayDate", ""))) return;
        p(c).edit().putString("todayIn", in == null ? "" : in).putString("todayOut", out == null ? "" : out).apply();
        refreshWidgets(c);
    }

    static void setIn(Context c, String hm) {
        rollDay(c);
        if (p(c).getString("todayIn", "").isEmpty()) p(c).edit().putString("todayIn", hm).apply();
        refreshWidgets(c);
    }

    static void setOut(Context c, String hm) {
        rollDay(c);
        p(c).edit().putString("todayOut", hm).apply();
        refreshWidgets(c);
    }

    /**
     * Bấm Check in / Check out nhanh (widget hoặc thông báo). Chưa có giờ vào thì là check in, có rồi là check out.
     * Trả về "in" hoặc "out", hoặc null nếu vừa bấm cách đây chưa tới 1 phút (chống bấm nhầm hai lần).
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
