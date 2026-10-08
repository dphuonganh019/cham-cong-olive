package vn.olive.chamcong;

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
 * Theo dõi vị trí chủ động trong ngày làm việc (phương án A):
 *  - Chờ check in từ giờ bắt đầu cho tới khi bạn tới công ty (muộn nhất tới giờ chốt 15:00).
 *  - Tới nơi: ghi mốc lúc tới, ở đủ 5 phút thì check in với giờ vào = lúc tới.
 *  - Sau đó theo dõi nhẹ để ghi đúng lúc rời đi; rời sau giờ chốt = check out và dừng.
 * Mọi mốc được ghi vào cùng hàng đợi sự kiện với geofence; app áp quy tắc tính công khi mở.
 */
public class TrackingService extends Service {
    static final String CHANNEL_TRACK = "olive_tracking";
    static final int NOTIF_ID = 42;

    static final String A_START = "vn.olive.chamcong.TRACK_START";
    static final String A_REFRESH = "vn.olive.chamcong.TRACK_REFRESH";
    static final String A_CHECKIN = "vn.olive.chamcong.TRACK_CHECKIN";
    static final String A_CONFIRM = "vn.olive.chamcong.TRACK_CONFIRM";
    static final String A_NOT_ME = "vn.olive.chamcong.TRACK_NOT_ME";
    static final String A_OFF = "vn.olive.chamcong.TRACK_OFF";
    static final String A_CHECKOUT = "vn.olive.chamcong.TRACK_CHECKOUT";
    static final String A_END = "vn.olive.chamcong.TRACK_END";

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

    /* ---------- Khởi động / điều khiển từ bên ngoài ---------- */

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

    /** Android không cho tự chạy lúc này: nhắc bạn bấm để bật (mở app là bật được). */
    static void postStartPrompt(Context c) {
        GeofenceStore.notify(c, 5, "Bấm để bật chấm công tự động hôm nay",
            "Android chưa cho app tự chạy nền lúc này. Mở app một lần là được.");
    }

    /* ---------- Trạng thái lưu lại (sống sót khi dịch vụ bị khởi động lại) ---------- */

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

    /* ---------- Vòng đời dịch vụ ---------- */

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

    /* ---------- Nút trên thông báo ---------- */

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
            case A_CHECKOUT:
                DayState.punch(this, "out", now, "notification");
                DayState.setDone(this, true);
                GeofenceStore.notify(this, 3, "Đã check out lúc " + DayState.hm(now), "Bấm để xem hoặc sửa giờ");
                finish();
                return;
            default:
                break;
        }
        if (!DayState.shouldTrackNow(this)) finish();
    }

    /* ---------- Tần suất đo theo khoảng cách ---------- */

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

    /* ---------- Xử lý mỗi lần có vị trí ---------- */

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
            GeofenceStore.notify(this, 4, "Hôm nay chưa thấy bạn tới công ty",
                "App đã dừng theo dõi. Nếu bạn đi công tác cả ngày, hãy bấm widget hoặc sửa giờ trong app.");
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

    /** Ở đủ 5 phút (hoặc bạn bấm Xác nhận): giờ vào = lúc tới. */
    private void confirmArrival(long now, Location loc, boolean wifi, boolean byUser) {
        long arr = arrival() > 0 ? arrival() : now;
        boolean returning = sp().getBoolean("trkReturning", false);
        GeofenceStore.appendEvent(this, event("enter", arr, loc, wifi, false));
        GeofenceStore.appendEvent(this, event("dwell", now, loc, wifi, byUser));
        boolean first = !DayState.hasIn(this);
        if (first) DayState.setIn(this, DayState.hm(arr));
        sp().edit().putString("trkMode", M_INSIDE).putLong("trkLeaveFirst", 0)
            .putBoolean("trkReturning", false).putString("trkLeftAt", "").apply();
        RecheckReceiver.cancel(this);
        String t = DayState.hm(arr);
        if (returning) GeofenceStore.notify(this, 1, "Đã quay lại công ty lúc " + t, "Bấm để xem công hôm nay");
        else if (first) GeofenceStore.notify(this, 1, "Đã check in lúc " + t + " (GPS)", "Bấm để xem hoặc sửa giờ");
    }

    /** Ra khỏi vùng ở 2 lần đo liên tiếp: lúc rời đi = lần đo đầu tiên ở ngoài. */
    private void confirmLeave(Location loc) {
        long dep = leaveFirst();
        GeofenceStore.appendEvent(this, event("exit", dep, loc, false, false));
        String t = DayState.hm(dep);
        int depMin = DayState.minOfDay(dep);
        if (depMin >= DayState.cutoff(this)) {
            if (!DayState.hasOut(this)) DayState.setOut(this, t);
            DayState.setDone(this, true);
            GeofenceStore.notify(this, 3, "Đã check out lúc " + t + " (GPS)", "Bấm để xem hoặc sửa giờ");
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
    }

    /* ---------- Thông báo ---------- */

    static void createChannel(Context c) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = c.getSystemService(NotificationManager.class);
            if (nm != null && nm.getNotificationChannel(CHANNEL_TRACK) == null) {
                NotificationChannel ch = new NotificationChannel(CHANNEL_TRACK, "Theo dõi chấm công", NotificationManager.IMPORTANCE_LOW);
                ch.setDescription("Thông báo im lặng khi app đang theo dõi để chấm công tự động");
                ch.setShowBadge(false);
                nm.createNotificationChannel(ch);
            }
        }
    }

    private PendingIntent actionIntent(String action, int req) {
        Intent i = new Intent(this, TrackingService.class).setAction(action);
        return PendingIntent.getService(this, req, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static String fmtDist(float d) {
        if (d < 0) return "đang lấy vị trí…";
        if (d < 1000) return "cách công ty " + Math.round(d) + " m";
        return String.format(Locale.forLanguageTag("vi-VN"), "cách công ty %.1f km", d / 1000f);
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
        String where = wifi ? "thấy Wi-Fi công ty" : fmtDist(dist);
        String upd = at > 0 ? " · cập nhật " + DayState.hm(at) : "";
        String in = DayState.todayIn(this);

        if (M_ARRIVING.equals(m)) {
            String t = DayState.hm(arrival());
            long left = Math.max(0, dwellMs() - (System.currentTimeMillis() - arrival()));
            int leftMin = (int) Math.ceil(left / 60_000.0);
            boolean ret = sp().getBoolean("trkReturning", false);
            title = (ret ? "Đã quay lại công ty lúc " : "Đã tới công ty lúc ") + t;
            text = in.isEmpty() ? "Tự check in sau " + dwellMs() / 60_000 + " phút (còn " + leftMin + " phút) · giờ vào là " + t
                : "Đang xác nhận có mặt (còn " + leftMin + " phút)";
            b.addAction(0, "Xác nhận " + t, actionIntent(A_CONFIRM, 7031));
            b.addAction(0, "Không phải", actionIntent(A_NOT_ME, 7032));
        } else if (M_INSIDE.equals(m)) {
            title = "Đang ở công ty" + (in.isEmpty() ? "" : " · vào lúc " + in);
            text = "Sẽ ghi giờ ra khi bạn rời đi";
            b.addAction(0, "Check out ngay", actionIntent(A_CHECKOUT, 7033));
        } else if (M_OUTSIDE.equals(m)) {
            String leftAt = sp().getString("trkLeftAt", "");
            boolean trip = sp().getBoolean("trkLeftForTrip", false);
            title = trip ? "Đi công tác từ " + leftAt : "Đã rời công ty lúc " + leftAt;
            text = (trip ? "App sẽ ghi lúc bạn quay lại công ty" : "Nếu không quay lại, đây sẽ là giờ ra") + " · " + where;
            b.addAction(0, "Check out ngay", actionIntent(A_CHECKOUT, 7033));
            b.addAction(0, "Kết thúc hôm nay", actionIntent(A_END, 7034));
        } else if (!in.isEmpty()) {
            title = "Đã check in lúc " + in;
            text = "Sẽ ghi giờ ra khi bạn rời công ty · " + where + upd;
            b.addAction(0, "Check out ngay", actionIntent(A_CHECKOUT, 7033));
            b.addAction(0, "Kết thúc hôm nay", actionIntent(A_END, 7034));
        } else {
            title = "Đang chờ bạn tới công ty";
            text = (where.substring(0, 1).toUpperCase() + where.substring(1)) + upd;
            b.addAction(0, "Check in ngay", actionIntent(A_CHECKIN, 7035));
            b.addAction(0, "Hôm nay nghỉ", actionIntent(A_OFF, 7036));
        }
        return b.setContentTitle(title).setContentText(text)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(text)).build();
    }

    private void updateNotification() {
        try { NotificationManagerCompat.from(this).notify(NOTIF_ID, buildNotification()); }
        catch (SecurityException ignored) {}
    }
}
