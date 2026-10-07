package vn.olive.chamcong;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.location.Location;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

import com.google.android.gms.location.Geofence;
import com.google.android.gms.location.GeofencingClient;
import com.google.android.gms.location.GeofencingRequest;
import com.google.android.gms.location.LocationServices;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** Lưu cấu hình vùng chấm công, đăng ký geofence và hàng đợi sự kiện chờ app đọc. */
public final class GeofenceStore {
    static final String PREFS = "olive_geofence";
    static final String FENCE_ID = "olive-office";
    static final String CHANNEL = "olive_chamcong";
    static final String ACTION = "vn.olive.chamcong.GEOFENCE";
    private static final int MAX_EVENTS = 1000;

    interface Result { void done(boolean ok, String error); }

    private GeofenceStore() {}

    static SharedPreferences prefs(Context c) {
        return c.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** Lưu cấu hình. Trả về true nếu cấu hình khác lần trước. */
    static boolean saveConfig(Context c, double lat, double lng, float radius, int dwellMin, String name) {
        SharedPreferences p = prefs(c);
        String sig = lat + "|" + lng + "|" + radius + "|" + dwellMin;
        boolean changed = !sig.equals(p.getString("sig", ""));
        p.edit()
            .putString("sig", sig)
            .putString("lat", Double.toString(lat))
            .putString("lng", Double.toString(lng))
            .putFloat("radius", radius)
            .putInt("dwellMin", dwellMin)
            .putString("name", name)
            .apply();
        return changed;
    }

    static boolean hasConfig(Context c) {
        return prefs(c).contains("lat") && prefs(c).contains("lng");
    }

    static boolean hasFine(Context c) {
        return ContextCompat.checkSelfPermission(c, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    static boolean hasBackground(Context c) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return hasFine(c);
        return ContextCompat.checkSelfPermission(c, Manifest.permission.ACCESS_BACKGROUND_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    static boolean isRegistered(Context c) {
        return prefs(c).getBoolean("registered", false);
    }

    private static PendingIntent pendingIntent(Context c) {
        Intent i = new Intent(c.getApplicationContext(), GeofenceReceiver.class).setAction(ACTION);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) flags |= PendingIntent.FLAG_MUTABLE;
        return PendingIntent.getBroadcast(c.getApplicationContext(), 7001, i, flags);
    }

    /** Đăng ký (hoặc đăng ký lại) vùng chấm công. initialEnter: báo ENTER ngay nếu đang ở trong vùng. */
    @SuppressLint("MissingPermission")
    static void register(Context c, boolean initialEnter, Result cb) {
        Context app = c.getApplicationContext();
        if (!hasConfig(app)) { if (cb != null) cb.done(false, "no_config"); return; }
        if (!hasFine(app) || !hasBackground(app)) {
            prefs(app).edit().putBoolean("registered", false).apply();
            if (cb != null) cb.done(false, "no_permission");
            return;
        }
        SharedPreferences p = prefs(app);
        double lat = Double.parseDouble(p.getString("lat", "0"));
        double lng = Double.parseDouble(p.getString("lng", "0"));
        float radius = Math.max(50f, p.getFloat("radius", 150f));
        int dwellMs = Math.max(1, p.getInt("dwellMin", 5)) * 60 * 1000;

        Geofence fence = new Geofence.Builder()
            .setRequestId(FENCE_ID)
            .setCircularRegion(lat, lng, radius)
            .setExpirationDuration(Geofence.NEVER_EXPIRE)
            .setTransitionTypes(Geofence.GEOFENCE_TRANSITION_ENTER | Geofence.GEOFENCE_TRANSITION_EXIT | Geofence.GEOFENCE_TRANSITION_DWELL)
            .setLoiteringDelay(dwellMs)
            .build();
        GeofencingRequest req = new GeofencingRequest.Builder()
            .setInitialTrigger(initialEnter ? GeofencingRequest.INITIAL_TRIGGER_ENTER : 0)
            .addGeofence(fence)
            .build();
        GeofencingClient client = LocationServices.getGeofencingClient(app);
        try {
            client.addGeofences(req, pendingIntent(app))
                .addOnSuccessListener(v -> {
                    prefs(app).edit().putBoolean("registered", true).apply();
                    if (cb != null) cb.done(true, null);
                })
                .addOnFailureListener(e -> {
                    prefs(app).edit().putBoolean("registered", false).apply();
                    if (cb != null) cb.done(false, e.getMessage());
                });
        } catch (SecurityException e) {
            prefs(app).edit().putBoolean("registered", false).apply();
            if (cb != null) cb.done(false, e.getMessage());
        }
    }

    static float radius(Context c) {
        return Math.max(50f, prefs(c).getFloat("radius", 150f));
    }

    /** Khoảng cách (mét) từ vị trí tới tâm vùng chấm công. */
    static float distanceTo(Context c, Location l) {
        SharedPreferences p = prefs(c);
        double lat = Double.parseDouble(p.getString("lat", "0"));
        double lng = Double.parseDouble(p.getString("lng", "0"));
        float[] r = new float[1];
        Location.distanceBetween(lat, lng, l.getLatitude(), l.getLongitude(), r);
        return r[0];
    }

    /** Ở trong vùng nếu khoảng cách không vượt bán kính + sai số (sai số tính tối đa 100 m). */
    static boolean isInside(Context c, Location l) {
        float acc = l.hasAccuracy() ? l.getAccuracy() : 100f;
        return distanceTo(c, l) <= radius(c) + Math.min(acc, 100f);
    }

    /** Ghi một tín hiệu kèm khoảng cách và sai số; tín hiệu "vào vùng" mà vị trí thực ở ngoài sẽ bị đánh dấu bỏ qua. */
    static JSONObject describe(Context c, String type, long time, Location l, boolean fresh, String src) {
        JSONObject o = new JSONObject();
        try {
            o.put("type", type);
            o.put("time", time);
            o.put("src", src);
            if (l != null && hasConfig(c)) {
                o.put("dist", Math.round(distanceTo(c, l)));
                if (l.hasAccuracy()) o.put("acc", Math.round(l.getAccuracy()));
                o.put("fresh", fresh);
                boolean inSignal = type.equals("enter") || type.equals("dwell");
                if (inSignal && !isInside(c, l)) o.put("rejected", true);
            }
        } catch (JSONException ignored) {}
        return o;
    }

    static synchronized void appendEvent(Context c, String type, long time) {
        JSONObject o = new JSONObject();
        try {
            o.put("type", type);
            o.put("time", time);
        } catch (JSONException ignored) {}
        appendEvent(c, o);
    }

    static synchronized void appendEvent(Context c, JSONObject o) {
        JSONArray arr = events(c);
        arr.put(o);
        JSONArray trimmed = arr;
        if (arr.length() > MAX_EVENTS) {
            trimmed = new JSONArray();
            for (int i = arr.length() - MAX_EVENTS; i < arr.length(); i++) trimmed.put(arr.opt(i));
        }
        prefs(c).edit().putString("events", trimmed.toString()).commit();
    }

    static synchronized JSONArray events(Context c) {
        try { return new JSONArray(prefs(c).getString("events", "[]")); }
        catch (JSONException e) { return new JSONArray(); }
    }

    static synchronized void clearUpTo(Context c, long upTo) {
        JSONArray arr = events(c), keep = new JSONArray();
        for (int i = 0; i < arr.length(); i++) {
            JSONObject o = arr.optJSONObject(i);
            if (o != null && o.optLong("time", 0) > upTo) keep.put(o);
        }
        prefs(c).edit().putString("events", keep.toString()).commit();
    }

    static void notify(Context c, int id, String title, String text) {
        Context app = c.getApplicationContext();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = app.getSystemService(NotificationManager.class);
            if (nm != null && nm.getNotificationChannel(CHANNEL) == null) {
                NotificationChannel ch = new NotificationChannel(CHANNEL, "Chấm công tự động", NotificationManager.IMPORTANCE_DEFAULT);
                ch.setDescription("Báo khi app ghi nhận bạn tới hoặc rời chỗ làm");
                nm.createNotificationChannel(ch);
            }
        }
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(app, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            return;
        }
        Intent open = new Intent(app, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int piFlags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        PendingIntent pi = PendingIntent.getActivity(app, 7002, open, piFlags);
        NotificationCompat.Builder b = new NotificationCompat.Builder(app, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setContentTitle(title)
            .setContentText(text)
            .setContentIntent(pi)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT);
        try { NotificationManagerCompat.from(app).notify(id, b.build()); } catch (SecurityException ignored) {}
    }
}
