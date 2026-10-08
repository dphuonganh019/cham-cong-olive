package vn.olive.chamcong;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import android.os.Handler;
import android.os.Looper;

import org.json.JSONArray;
import org.json.JSONException;

import java.util.HashSet;
import java.util.Set;

@CapacitorPlugin(
    name = "OliveGeofence",
    permissions = {
        @Permission(alias = "location", strings = { Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION }),
        @Permission(alias = "background", strings = { Manifest.permission.ACCESS_BACKGROUND_LOCATION }),
        @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS })
    }
)
public class OliveGeofencePlugin extends Plugin {

    private JSObject status() {
        Context c = getContext();
        JSObject o = new JSObject();
        o.put("fine", GeofenceStore.hasFine(c));
        o.put("background", GeofenceStore.hasBackground(c));
        o.put("registered", GeofenceStore.isRegistered(c));
        boolean optimized = false;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PowerManager pm = (PowerManager) c.getSystemService(Context.POWER_SERVICE);
            optimized = pm != null && !pm.isIgnoringBatteryOptimizations(c.getPackageName());
        }
        o.put("batteryOptimized", optimized);
        o.put("pending", GeofenceStore.events(c).length());
        JSObject t = new JSObject();
        t.put("running", TrackingService.running);
        t.put("mode", GeofenceStore.prefs(c).getString("trkMode", "waiting"));
        t.put("dist", GeofenceStore.prefs(c).getFloat("trkDist", -1f));
        t.put("acc", GeofenceStore.prefs(c).getFloat("trkAcc", -1f));
        t.put("at", GeofenceStore.prefs(c).getLong("trkAt", 0));
        t.put("wifi", GeofenceStore.prefs(c).getBoolean("trkWifi", false));
        t.put("done", DayState.isDone(c));
        t.put("shouldTrack", DayState.shouldTrackNow(c));
        t.put("exactAlarm", TrackingScheduler.exactAllowed(c));
        o.put("tracking", t);
        o.put("wifiCanScan", OfficeWifi.canScan(c));
        try { o.put("wifiNetworks", new JSArray(OfficeWifi.savedNames(c).toString())); } catch (JSONException e) { o.put("wifiNetworks", new JSArray()); }
        return o;
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        call.resolve(status());
    }

    @PluginMethod
    public void configure(PluginCall call) {
        JSObject d = call.getData();
        if (!d.has("lat") || !d.has("lng")) { call.reject("Thiếu toạ độ chỗ làm"); return; }
        double lat = d.optDouble("lat"), lng = d.optDouble("lng");
        if (Double.isNaN(lat) || Double.isNaN(lng)) { call.reject("Toạ độ chỗ làm không hợp lệ"); return; }
        float radius = (float) d.optDouble("radius", 150);
        int dwellMin = (int) Math.round(d.optDouble("dwellMin", 5));
        String name = call.getString("name", "chỗ làm");
        boolean changed = GeofenceStore.saveConfig(getContext(), lat, lng, radius, dwellMin, name);
        Set<String> off = new HashSet<>();
        JSONArray offArr = d.optJSONArray("offDays");
        if (offArr != null) for (int i = 0; i < offArr.length(); i++) off.add(offArr.optString(i));
        DayState.saveSchedule(getContext(), d.optString("trackStart", "05:30"), d.optString("trackEnd", "20:00"),
            d.optString("cutoff", "15:00"), off);
        GeofenceStore.prefs(getContext()).edit().putInt("tripWindow", d.optInt("tripWindow", 60)).apply();
        TrackingScheduler.scheduleNext(getContext());
        TrackingScheduler.maybeStart(getContext());
        GeofenceStore.register(getContext(), changed, (ok, err) -> {
            JSObject s = status();
            if (err != null) s.put("error", err);
            call.resolve(s);
        });
    }

    @PluginMethod
    public void requestLocation(PluginCall call) {
        if (getPermissionState("location") == PermissionState.GRANTED) { afterLocation(call); return; }
        requestPermissionForAlias("location", call, "locationCallback");
    }

    @PermissionCallback
    private void locationCallback(PluginCall call) { afterLocation(call); }

    private void afterLocation(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") != PermissionState.GRANTED) {
            requestPermissionForAlias("notifications", call, "notificationsCallback");
        } else {
            call.resolve(status());
        }
    }

    @PermissionCallback
    private void notificationsCallback(PluginCall call) { call.resolve(status()); }

    @PluginMethod
    public void requestBackground(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q || GeofenceStore.hasBackground(getContext())) { call.resolve(status()); return; }
        if (!GeofenceStore.hasFine(getContext())) { call.reject("Cần cấp quyền vị trí trước"); return; }
        requestPermissionForAlias("background", call, "backgroundCallback");
    }

    @PermissionCallback
    private void backgroundCallback(PluginCall call) {
        if (!GeofenceStore.hasBackground(getContext())) openAppSettings();
        call.resolve(status());
    }

    private void openAppSettings() {
        Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getContext().getPackageName()));
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
    }

    @PluginMethod
    public void openBatterySettings(PluginCall call) {
        Context c = getContext();
        try {
            Intent i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + c.getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            c.startActivity(i);
        } catch (Exception e) {
            Intent i = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            c.startActivity(i);
        }
        call.resolve();
    }

    /** App gửi giờ vào/ra hiệu lực của hôm nay để widget và thông báo hiển thị đúng. */
    @PluginMethod
    public void setToday(PluginCall call) {
        JSObject d = call.getData();
        DayState.setToday(getContext(), d.optString("date", ""), d.optString("in", ""), d.optString("out", ""));
        TrackingService.send(getContext(), TrackingService.A_REFRESH);
        call.resolve(status());
    }

    /** "off": dừng theo dõi hôm nay. "resume": bật lại hôm nay. */
    @PluginMethod
    public void tracking(PluginCall call) {
        String action = call.getString("action", "");
        if ("off".equals(action)) {
            DayState.setDone(getContext(), true);
            TrackingService.send(getContext(), TrackingService.A_OFF);
        } else if ("resume".equals(action)) {
            DayState.setDone(getContext(), false);
            TrackingScheduler.maybeStart(getContext());
        }
        new Handler(Looper.getMainLooper()).postDelayed(() -> call.resolve(status()), 600);
    }

    /** Ghi nhận Wi-Fi công ty: quét rồi lưu các mạng mạnh nhất đang thấy. */
    @PluginMethod
    public void learnWifi(PluginCall call) {
        if (!OfficeWifi.canScan(getContext())) { call.reject("Hãy bật Wi-Fi (không cần kết nối) rồi thử lại"); return; }
        OfficeWifi.requestScan(getContext(), 0);
        new Handler(Looper.getMainLooper()).postDelayed(() -> {
            JSObject ret = new JSObject();
            try { ret.put("networks", new JSArray(OfficeWifi.learn(getContext()).toString())); }
            catch (JSONException e) { ret.put("networks", new JSArray()); }
            call.resolve(ret);
        }, 5000);
    }

    @PluginMethod
    public void clearWifi(PluginCall call) {
        OfficeWifi.clear(getContext());
        call.resolve(status());
    }

    @PluginMethod
    public void getEvents(PluginCall call) {
        JSONArray arr = GeofenceStore.events(getContext());
        JSObject ret = new JSObject();
        try { ret.put("events", new JSArray(arr.toString())); }
        catch (JSONException e) { ret.put("events", new JSArray()); }
        call.resolve(ret);
    }

    @PluginMethod
    public void clearEvents(PluginCall call) {
        long upTo = call.getData().optLong("upTo", 0);
        GeofenceStore.clearUpTo(getContext(), upTo);
        call.resolve();
    }
}
