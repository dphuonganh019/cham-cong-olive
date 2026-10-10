package app.olive.timekeeper;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.os.Build;
import android.os.IBinder;
import android.os.Looper;

import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.app.ServiceCompat;
import androidx.core.content.ContextCompat;

import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationCallback;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationResult;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.Locale;


/**
 * Active location tracking during a workday:
 *  - Waits for check-in from the start time until you reach the office (at the latest until the 15:00 cutoff).
 *  - On arrival it records the arrival time; after 5 minutes on site it checks in with check-in = arrival time.
 *  - Then it tracks lightly to catch the moment you leave; leaving after the cutoff = check-out, and it stops.
 * Every point goes into the same event queue as the geofence; the app applies the timekeeping rules when opened.
 */
public class TrackingService extends Service {
    static final String CHANNEL_TRACK = "olive_tracking";
    static final int NOTIF_ID = 42;

    static final String A_START = "app.olive.timekeeper.TRACK_START";
    static final String A_REFRESH = "app.olive.timekeeper.TRACK_REFRESH";
    static final String A_CHECKIN = "app.olive.timekeeper.TRACK_CHECKIN";
    static final String A_CONFIRM = "app.olive.timekeeper.TRACK_CONFIRM";
    static final String A_NOT_ME = "app.olive.timekeeper.TRACK_NOT_ME";
    static final String A_OFF = "app.olive.timekeeper.TRACK_OFF";
    static final String A_CHECKOUT = "app.olive.timekeeper.TRACK_CHECKOUT";
    static final String A_END = "app.olive.timekeeper.TRACK_END";
    static final String A_FINALIZE = "app.olive.timekeeper.TRACK_FINALIZE";

    static final String M_WAITING = "waiting";
    static final String M_ARRIVING = "arriving";
    static final String M_INSIDE = "inside";
    static final String M_OUTSIDE = "outside";

    private static final int TIER_FAR = 0, TIER_MID = 1, TIER_NEAR = 2, TIER_INSIDE = 3;

    static volatile boolean running = false;

    private FusedLocationProviderClient fused;
    private LocationCallback callback;
    private int tier = -1;
    private boolean stopping = false;

    /* ---------- Starting / controlling from outside ---------- */

    static void start(Context c) {
        Context app = c.getApplicationContext();
        try {
            ContextCompat.startForegroundService(app, new Intent(app, TrackingService.class).setAction(A_START));
        } catch (Exception e) {
            postStartPrompt(app);
        }
    }

    static void send(Context c, String action) {
        if (!running) return;
        Context app = c.getApplicationContext();
        try { app.startService(new Intent(app, TrackingService.class).setAction(action)); }
        catch (Exception ignored) {}
    }

    /** Android won't allow a background start right now: ask you to tap to start it (opening the app works). */
    static void postStartPrompt(Context c) {
        GeofenceStore.notify(c, 5, I18n.t(c, "start.title"), I18n.t(c, "start.text"));
    }

    /* ---------- Saved state (survives service restarts) ---------- */

    private SharedPreferences sp() { return GeofenceStore.prefs(this); }
    private String mode() { return sp().getString("trkMode", M_WAITING); }
    private long arrival() { return sp().getLong("trkArrival", 0); }
    private long leaveFirst() { return sp().getLong("trkLeaveFirst", 0); }

    private void resetIfNewDay() {
        String today = DayState.dateKey(System.currentTimeMillis());
        if (!today.equals(sp().getString("trkDay", ""))) {
            sp().edit().putString("trkDay", today).putString("trkMode", M_WAITING)
                .putLong("trkArrival", 0).putLong("trkLeaveFirst", 0)
                .putBoolean("trkIgnoreUntilOut", false).putBoolean("trkReturning", false)
                .putBoolean("trkTrip", false).putString("trkLeftAt", "").putBoolean("trkLeftForTrip", false)
                .putFloat("trkDist", -1f).putFloat("trkAcc", -1f).putLong("trkAt", 0).putBoolean("trkWifi", false)
                .apply();
        }
    }

    /* ---------- Service lifecycle ---------- */

    @Override
    public void onCreate() {
        super.onCreate();
        fused = LocationServices.getFusedLocationProviderClient(this);
        callback = new LocationCallback() {
            @Override
            public void onLocationResult(@NonNull LocationResult result) {
                onLocation(result.getLastLocation());
            }
        };
        createChannel(this);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null && intent.getAction() != null ? intent.getAction() : A_START;
        resetIfNewDay();
        try {
            int type = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q ? ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION : 0;
            ServiceCompat.startForeground(this, NOTIF_ID, buildNotification(), type);
        } catch (Exception e) {
            running = false;
            postStartPrompt(this);
            stopSelf();
            return START_NOT_STICKY;
        }
        running = true;
        stopping = false;
        handleAction(action);
        if (!stopping) {
            ensureUpdates();
            updateNotification();
        }
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        running = false;
        try { fused.removeLocationUpdates(callback); } catch (Exception ignored) {}
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }

    private void finish() {
        stopping = true;
        running = false;
        try { fused.removeLocationUpdates(callback); } catch (Exception ignored) {}
        tier = -1;
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    /* ---------- Notification buttons ---------- */

    private void handleAction(String action) {
        long now = System.currentTimeMillis();
        switch (action) {
            case A_CHECKIN:
                DayState.punch(this, "in", now, "notification");
                break;
            case A_CONFIRM:
                if (M_ARRIVING.equals(mode())) confirmArrival(now, null, false, true);
                break;
            case A_NOT_ME:
                sp().edit().putString("trkMode", sp().getBoolean("trkReturning", false) ? M_OUTSIDE : M_WAITING)
                    .putLong("trkArrival", 0).putBoolean("trkIgnoreUntilOut", true).apply();
                break;
            case A_OFF:
            case A_END:
                DayState.setDone(this, true);
                finish();
                return;
            case A_FINALIZE:
                finalizeLeave(now, "notification");
                return;
            case A_CHECKOUT:
                DayState.punch(this, "out", now, "notification");
                DayState.setDone(this, true);
                GeofenceStore.notify(this, 3, I18n.t(this, "checkedOut", DayState.hm(now)), I18n.t(this, "tapEdit"));
                finish();
                return;
            default:
                break;
        }
        if (!DayState.shouldTrackNow(this)) finish();
    }

    /* ---------- Update rate by distance ---------- */

    private void ensureUpdates() {
        String m = mode();
        float dist = sp().getFloat("trkDist", -1f);
        int t;
        if (M_ARRIVING.equals(m) || leaveFirst() > 0) t = TIER_NEAR;
        else if (M_INSIDE.equals(m)) t = TIER_INSIDE;
        else if (dist < 0) t = TIER_MID;
        else if (dist > 5000) t = TIER_FAR;
        else if (dist > 1000) t = TIER_MID;
        else t = TIER_NEAR;
        if (t == tier) return;
        tier = t;
        int priority;
        long interval;
        switch (t) {
            case TIER_FAR: priority = Priority.PRIORITY_BALANCED_POWER_ACCURACY; interval = 10 * 60_000L; break;
            case TIER_MID: priority = Priority.PRIORITY_HIGH_ACCURACY; interval = 2 * 60_000L; break;
            case TIER_INSIDE: priority = Priority.PRIORITY_BALANCED_POWER_ACCURACY; interval = 2 * 60_000L; break;
            default: priority = Priority.PRIORITY_HIGH_ACCURACY; interval = 30_000L; break;
        }
        LocationRequest req = new LocationRequest.Builder(priority, interval)
            .setMinUpdateIntervalMillis(Math.min(interval, 30_000L))
            .setMaxUpdateDelayMillis(interval)
            .build();
        try {
            fused.removeLocationUpdates(callback);
            fused.requestLocationUpdates(req, callback, Looper.getMainLooper());
        } catch (SecurityException e) {
            postStartPrompt(this);
            finish();
        }
    }

    /* ---------- Handling each location fix ---------- */

    private void onLocation(Location loc) {
        if (stopping) return;
        resetIfNewDay();
        long now = System.currentTimeMillis();
        int nowMin = DayState.minOfDay(now);
        if (DayState.hasOut(this) || DayState.isDone(this) || nowMin >= DayState.trackEnd(this) || !DayState.isWorkDay(this, now)) {
            finish();
            return;
        }
        String m = mode();
        if (M_WAITING.equals(m) && !DayState.hasIn(this) && nowMin >= DayState.cutoff(this)) {
            DayState.setDone(this, true);
            GeofenceStore.notify(this, 4, I18n.t(this, "noShow.title"), I18n.t(this, "noShow.text"));
            finish();
            return;
        }

        float dist = -1f;
        if (loc != null && GeofenceStore.hasConfig(this)) dist = GeofenceStore.distanceTo(this, loc);
        boolean near = (dist >= 0 && dist < 2000) || !M_WAITING.equals(m);
        if (near) OfficeWifi.requestScan(this, 120_000L);
        boolean wifi = OfficeWifi.seen(this);
        boolean inside = wifi || (loc != null && GeofenceStore.isInside(this, loc));
        boolean outside = !wifi && loc != null && !GeofenceStore.isInside(this, loc);
        long at = loc != null && loc.getTime() > 0 && loc.getTime() <= now ? loc.getTime() : now;

        // Left early, still away, and the waiting time has passed: the departure becomes the check-out
        if (M_OUTSIDE.equals(m) && !inside && !sp().getBoolean("trkLeftForTrip", false)) {
            String prov = DayState.todayProv(this);
            if (!prov.isEmpty() && nowMin >= DayState.finalizeAtMin(this, DayState.toMin(prov, nowMin))) {
                finalizeLeave(now, "service");
                return;
            }
        }

        SharedPreferences.Editor e = sp().edit();
        e.putFloat("trkDist", wifi ? 0f : dist).putFloat("trkAcc", loc != null && loc.hasAccuracy() ? loc.getAccuracy() : -1f)
            .putLong("trkAt", now).putBoolean("trkWifi", wifi).apply();

        switch (m) {
            case M_WAITING:
                if (sp().getBoolean("trkIgnoreUntilOut", false)) {
                    if (outside) sp().edit().putBoolean("trkIgnoreUntilOut", false).apply();
                    break;
                }
                if (inside) sp().edit().putString("trkMode", M_ARRIVING).putLong("trkArrival", at)
                    .putBoolean("trkReturning", false).apply();
                break;
            case M_ARRIVING:
                if (outside) {
                    boolean ret = sp().getBoolean("trkReturning", false);
                    sp().edit().putString("trkMode", ret ? M_OUTSIDE : M_WAITING).putLong("trkArrival", 0).apply();
                } else if (inside && now - arrival() >= dwellMs()) {
                    confirmArrival(now, loc, wifi, false);
                }
                break;
            case M_INSIDE:
                if (inside) sp().edit().putLong("trkLeaveFirst", 0).apply();
                else if (outside) {
                    if (leaveFirst() == 0) sp().edit().putLong("trkLeaveFirst", at).apply();
                    else if (now - leaveFirst() >= 45_000L) confirmLeave(loc);
                }
                break;
            case M_OUTSIDE:
                if (sp().getBoolean("trkIgnoreUntilOut", false)) {
                    if (outside) sp().edit().putBoolean("trkIgnoreUntilOut", false).apply();
                    break;
                }
                if (inside) sp().edit().putString("trkMode", M_ARRIVING).putLong("trkArrival", at)
                    .putBoolean("trkReturning", true).apply();
                break;
            default:
                break;
        }
        if (!stopping) {
            ensureUpdates();
            updateNotification();
        }
    }

    private long dwellMs() {
        return Math.max(1, sp().getInt("dwellMin", 5)) * 60_000L;
    }

    private JSONObject event(String type, long time, Location loc, boolean wifi, boolean force) {
        JSONObject o = GeofenceStore.describe(this, type, time, loc, loc != null, "service");
        try {
            if (wifi) { o.put("wifi", true); o.remove("rejected"); }
            if (loc == null) o.remove("rejected");
            if (force) o.put("force", true);
        } catch (JSONException ignored) {}
        return o;
    }

    /** 5 minutes on site (or you tapped Confirm): check-in = arrival time. */
    private void confirmArrival(long now, Location loc, boolean wifi, boolean byUser) {
        long arr = arrival() > 0 ? arrival() : now;
        boolean returning = sp().getBoolean("trkReturning", false);
        GeofenceStore.appendEvent(this, event("enter", arr, loc, wifi, false));
        GeofenceStore.appendEvent(this, event("dwell", now, loc, wifi, byUser));
        boolean first = !DayState.hasIn(this);
        if (first) DayState.setIn(this, DayState.hm(arr));
        if (returning) DayState.setProv(this, "");
        sp().edit().putString("trkMode", M_INSIDE).putLong("trkLeaveFirst", 0)
            .putBoolean("trkReturning", false).putString("trkLeftAt", "").apply();
        RecheckReceiver.cancel(this);
        String t = DayState.hm(arr);
        if (returning) GeofenceStore.notify(this, 1, I18n.t(this, "back.title", t), I18n.t(this, "tapView"));
        else if (first) GeofenceStore.notify(this, 1, I18n.t(this, "checkedInGps", t), I18n.t(this, "tapEdit"));
    }

    /** Outside the zone on two fixes in a row: departure time = the first fix outside. */
    private void confirmLeave(Location loc) {
        long dep = leaveFirst();
        GeofenceStore.appendEvent(this, event("exit", dep, loc, false, false));
        String t = DayState.hm(dep);
        int depMin = DayState.minOfDay(dep);
        if (depMin >= DayState.cutoff(this)) {
            if (!DayState.hasOut(this)) DayState.setOut(this, t);
            DayState.setDone(this, true);
            GeofenceStore.notify(this, 3, I18n.t(this, "checkedOutGps", t), I18n.t(this, "tapEdit"));
            finish();
            return;
        }
        boolean trip = false;
        if (!sp().getBoolean("trkTrip", false)) {
            int inMin = DayState.toMin(DayState.todayIn(this), -1);
            int window = sp().getInt("tripWindow", 60);
            trip = inMin >= 0 && depMin - inMin <= window;
        }
        sp().edit().putString("trkMode", M_OUTSIDE).putLong("trkLeaveFirst", 0)
            .putBoolean("trkTrip", sp().getBoolean("trkTrip", false) || trip)
            .putString("trkLeftAt", t).putBoolean("trkLeftForTrip", trip).apply();
        if (!trip && DayState.hasIn(this)) DayState.setProv(this, t);
    }

    /** The provisional check-out becomes the check-out: confirmed on the notification, or not back in time. */
    private void finalizeLeave(long now, String src) {
        String at = DayState.finalizeLeave(this, now, src);
        if (at != null) {
            boolean auto = "service".equals(src);
            GeofenceStore.notify(this, 3, I18n.t(this, auto ? "checkedOutGps" : "checkedOut", at),
                auto ? I18n.t(this, "finalize.auto", at) : I18n.t(this, "tapEdit"));
        }
        finish();
    }

    /* ---------- Notifications ---------- */

    /** Creates the channel, or renames it in the current language (Android keeps the user's channel settings). */
    static void createChannel(Context c) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = c.getSystemService(NotificationManager.class);
            if (nm == null) return;
            NotificationChannel ch = new NotificationChannel(CHANNEL_TRACK, I18n.t(c, "channel.track.name"), NotificationManager.IMPORTANCE_LOW);
            ch.setDescription(I18n.t(c, "channel.track.desc"));
            ch.setShowBadge(false);
            nm.createNotificationChannel(ch);
        }
    }

    private PendingIntent actionIntent(String action, int req) {
        Intent i = new Intent(this, TrackingService.class).setAction(action);
        return PendingIntent.getService(this, req, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private String fmtDist(float d) {
        if (d < 0) return I18n.t(this, "trk.locating");
        if (d < 1000) return I18n.t(this, "trk.distM", Math.round(d));
        return I18n.t(this, "trk.distKm", String.format(I18n.locale(this), "%.1f", d / 1000f));
    }

    private Notification buildNotification() {
        String m = mode();
        String title, text;
        NotificationCompat.Builder b = new NotificationCompat.Builder(this, CHANNEL_TRACK)
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE);
        Intent open = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        b.setContentIntent(PendingIntent.getActivity(this, 7030, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));

        float dist = sp().getFloat("trkDist", -1f);
        boolean wifi = sp().getBoolean("trkWifi", false);
        long at = sp().getLong("trkAt", 0);
        String where = wifi ? I18n.t(this, "trk.wifi") : fmtDist(dist);
        String upd = at > 0 ? I18n.t(this, "trk.updated", DayState.hm(at)) : "";
        String in = DayState.todayIn(this);

        if (M_ARRIVING.equals(m)) {
            String t = DayState.hm(arrival());
            long left = Math.max(0, dwellMs() - (System.currentTimeMillis() - arrival()));
            int leftMin = (int) Math.ceil(left / 60_000.0);
            boolean ret = sp().getBoolean("trkReturning", false);
            title = I18n.t(this, ret ? "back.title" : "trk.arrived", t);
            text = in.isEmpty() ? I18n.t(this, "trk.autoIn", dwellMs() / 60_000, leftMin, t)
                : I18n.t(this, "trk.confirming", leftMin);
            b.addAction(0, I18n.t(this, "act.confirm", t), actionIntent(A_CONFIRM, 7031));
            b.addAction(0, I18n.t(this, "act.notMe"), actionIntent(A_NOT_ME, 7032));
        } else if (M_INSIDE.equals(m)) {
            title = I18n.t(this, "trk.inside") + (in.isEmpty() ? "" : I18n.t(this, "trk.insideSince", in));
            text = I18n.t(this, "trk.insideText");
            b.addAction(0, I18n.t(this, "act.checkoutNow"), actionIntent(A_CHECKOUT, 7033));
        } else if (M_OUTSIDE.equals(m)) {
            String leftAt = sp().getString("trkLeftAt", "");
            boolean trip = sp().getBoolean("trkLeftForTrip", false);
            String prov = DayState.todayProv(this);
            title = I18n.t(this, trip ? "trk.tripFrom" : "trk.leftAt", leftAt);
            if (trip || prov.isEmpty()) {
                text = I18n.t(this, "trk.tripText") + " · " + where;
            } else {
                int fin = DayState.finalizeAtMin(this, DayState.toMin(prov, 0));
                String finHm = String.format(Locale.US, "%02d:%02d", (fin / 60) % 24, fin % 60);
                text = I18n.t(this, "trk.leftUntil", finHm, prov) + " · " + where;
                b.addAction(0, I18n.t(this, "act.confirmOut", prov), actionIntent(A_FINALIZE, 7037));
            }
            b.addAction(0, I18n.t(this, "act.checkoutNow"), actionIntent(A_CHECKOUT, 7033));
            b.addAction(0, I18n.t(this, "act.endToday"), actionIntent(A_END, 7034));
        } else if (!in.isEmpty()) {
            title = I18n.t(this, "checkedIn", in);
            text = I18n.t(this, "trk.checkedInText", where + upd);
            b.addAction(0, I18n.t(this, "act.checkoutNow"), actionIntent(A_CHECKOUT, 7033));
            b.addAction(0, I18n.t(this, "act.endToday"), actionIntent(A_END, 7034));
        } else {
            title = I18n.t(this, "trk.waiting");
            text = (where.substring(0, 1).toUpperCase() + where.substring(1)) + upd;
            b.addAction(0, I18n.t(this, "act.checkinNow"), actionIntent(A_CHECKIN, 7035));
            b.addAction(0, I18n.t(this, "act.dayOff"), actionIntent(A_OFF, 7036));
        }
        return b.setContentTitle(title).setContentText(text)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(text)).build();
    }

    private void updateNotification() {
        try { NotificationManagerCompat.from(this).notify(NOTIF_ID, buildNotification()); }
        catch (SecurityException ignored) {}
    }
}
