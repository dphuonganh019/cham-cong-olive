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

import org.json.JSONArray;
import org.json.JSONException;

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
