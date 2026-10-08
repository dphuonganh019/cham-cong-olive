package vn.olive.chamcong;

import android.annotation.SuppressLint;
import android.content.Context;
import android.content.SharedPreferences;
import android.net.wifi.ScanResult;
import android.net.wifi.WifiManager;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/** Nhận biết đang ở công ty qua các mạng Wi-Fi quanh đó (không cần kết nối, chỉ cần nhìn thấy). */
final class OfficeWifi {
    private static final int LEARN_MIN_RSSI = -82;
    private static final int MATCH_MIN_RSSI = -88;
    private static final int MAX_SAVED = 15;
    private static long lastScanRequest = 0;

    private OfficeWifi() {}

    private static WifiManager wm(Context c) {
        return (WifiManager) c.getApplicationContext().getSystemService(Context.WIFI_SERVICE);
    }

    /** Có thể quét Wi-Fi không (Wi-Fi đang bật, hoặc bật "Quét Wi-Fi" trong cài đặt vị trí). */
    static boolean canScan(Context c) {
        WifiManager w = wm(c);
        return w != null && (w.isWifiEnabled() || w.isScanAlwaysAvailable());
    }

    @SuppressWarnings("deprecation")
    static void requestScan(Context c, long minGapMs) {
        long now = System.currentTimeMillis();
        if (now - lastScanRequest < minGapMs) return;
        lastScanRequest = now;
        WifiManager w = wm(c);
        try { if (w != null) w.startScan(); } catch (Exception ignored) {}
    }

    @SuppressLint("MissingPermission")
    private static List<ScanResult> results(Context c) {
        WifiManager w = wm(c);
        try { return w != null ? w.getScanResults() : Collections.emptyList(); }
        catch (Exception e) { return Collections.emptyList(); }
    }

    static Set<String> saved(Context c) {
        return new HashSet<>(GeofenceStore.prefs(c).getStringSet("officeBssids", new HashSet<>()));
    }

    /** Thấy ít nhất một Wi-Fi đã ghi nhận của công ty. */
    static boolean seen(Context c) {
        Set<String> s = saved(c);
        if (s.isEmpty()) return false;
        for (ScanResult r : results(c)) {
            if (r.BSSID != null && s.contains(r.BSSID.toLowerCase()) && r.level >= MATCH_MIN_RSSI) return true;
        }
        return false;
    }

    /** Ghi nhận các Wi-Fi mạnh nhất đang thấy (bấm khi đang ở công ty). Trả về danh sách tên mạng. */
    @SuppressWarnings("deprecation")
    static JSONArray learn(Context c) {
        List<ScanResult> list = new ArrayList<>(results(c));
        Collections.sort(list, (a, b) -> b.level - a.level);
        Set<String> bssids = new HashSet<>();
        JSONArray names = new JSONArray();
        Set<String> seenNames = new HashSet<>();
        for (ScanResult r : list) {
            if (bssids.size() >= MAX_SAVED) break;
            if (r.BSSID == null || r.level < LEARN_MIN_RSSI) continue;
            bssids.add(r.BSSID.toLowerCase());
            String name = r.SSID == null || r.SSID.isEmpty() ? "(mạng ẩn)" : r.SSID;
            if (seenNames.add(name)) {
                JSONObject o = new JSONObject();
                try { o.put("ssid", name); o.put("level", r.level); } catch (JSONException ignored) {}
                names.put(o);
            }
        }
        SharedPreferences.Editor e = GeofenceStore.prefs(c).edit();
        e.putStringSet("officeBssids", bssids);
        e.putString("officeWifiNames", names.toString());
        e.apply();
        return names;
    }

    static JSONArray savedNames(Context c) {
        try { return new JSONArray(GeofenceStore.prefs(c).getString("officeWifiNames", "[]")); }
        catch (JSONException e) { return new JSONArray(); }
    }

    static void clear(Context c) {
        GeofenceStore.prefs(c).edit().remove("officeBssids").remove("officeWifiNames").apply();
    }
}
