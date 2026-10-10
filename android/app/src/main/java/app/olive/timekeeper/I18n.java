package app.olive.timekeeper;

import android.content.Context;

import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * Text that Android shows on its own (notifications, the widget, toasts, plugin errors),
 * in the language chosen in the app. Until the app sends a language, the phone's language is used.
 * Each entry holds { English, Vietnamese }, mirroring src/i18n.js on the web side.
 */
final class I18n {
    private I18n() {}

    private static final Map<String, String[]> TEXT = new HashMap<>();

    private static void put(String key, String en, String vi) { TEXT.put(key, new String[] { en, vi }); }

    static {
        // Notifications from the geofence / re-check path
        put("arrived.title", "Arrived at the office", "Đã tới chỗ làm");
        put("arrived.text", "Present since %s. Open the app to see today's hours.", "Ghi nhận có mặt từ %s. Mở app để xem công hôm nay.");
        put("left.title", "Left the office", "Đã rời chỗ làm");
        put("left.text", "At %s. The app will decide between a business trip and a check-out.", "Lúc %s. App sẽ tự xét công tác hoặc check out.");

        // Notification channels
        put("channel.auto.name", "Automatic check-in", "Chấm công tự động");
        put("channel.auto.desc", "Tells you when the app records you arriving at or leaving the office", "Báo khi app ghi nhận bạn tới hoặc rời chỗ làm");
        put("channel.track.name", "Check-in tracking", "Theo dõi chấm công");
        put("channel.track.desc", "Silent notification while the app tracks your location for automatic check-in", "Thông báo im lặng khi app đang theo dõi để chấm công tự động");

        // Plugin errors and defaults
        put("err.noCoords", "Office coordinates are missing", "Thiếu toạ độ chỗ làm");
        put("err.badCoords", "Office coordinates are invalid", "Toạ độ chỗ làm không hợp lệ");
        put("err.needFine", "Allow location access first", "Cần cấp quyền vị trí trước");
        put("err.wifiOff", "Turn on Wi-Fi (no need to connect) and try again", "Hãy bật Wi-Fi (không cần kết nối) rồi thử lại");
        put("office.default", "the office", "chỗ làm");
        put("wifi.hidden", "(hidden network)", "(mạng ẩn)");

        // Widget
        put("dow.1", "Sunday", "Chủ nhật");
        put("dow.2", "Monday", "Thứ Hai");
        put("dow.3", "Tuesday", "Thứ Ba");
        put("dow.4", "Wednesday", "Thứ Tư");
        put("dow.5", "Thursday", "Thứ Năm");
        put("dow.6", "Friday", "Thứ Sáu");
        put("dow.7", "Saturday", "Thứ Bảy");
        put("widget.in", "IN", "VÀO");
        put("widget.out", "OUT", "RA");
        put("widget.btnIn", "CHECK IN", "CHECK IN");
        put("widget.btnOut", "CHECK OUT", "CHECK OUT");
        put("widget.btnConfirmOut", "CONFIRM OUT %s", "CHỐT RA %s");
        put("widget.btnUpdate", "UPDATE CHECK-OUT", "CẬP NHẬT GIỜ RA");
        put("widget.tooSoon", "You just tapped. Wait a minute to tap again.", "Bạn vừa bấm rồi. Đợi 1 phút nếu muốn bấm lại.");
        put("checkedIn", "Checked in at %s", "Đã check in lúc %s");
        put("checkedOut", "Checked out at %s", "Đã check out lúc %s");

        // Tracking service notifications
        put("start.title", "Tap to turn on automatic check-in today", "Bấm để bật chấm công tự động hôm nay");
        put("start.text", "Android didn't let the app start in the background just now. Opening the app once is enough.", "Android chưa cho app tự chạy nền lúc này. Mở app một lần là được.");
        put("checkedInGps", "Checked in at %s (GPS)", "Đã check in lúc %s (GPS)");
        put("checkedOutGps", "Checked out at %s (GPS)", "Đã check out lúc %s (GPS)");
        put("tapEdit", "Tap to view or edit the times", "Bấm để xem hoặc sửa giờ");
        put("tapView", "Tap to see today's hours", "Bấm để xem công hôm nay");
        put("back.title", "Back at the office at %s", "Đã quay lại công ty lúc %s");
        put("noShow.title", "You haven't arrived at the office today", "Hôm nay chưa thấy bạn tới công ty");
        put("noShow.text", "Tracking has stopped. If you're on a business trip all day, tap the widget or edit the times in the app.", "App đã dừng theo dõi. Nếu bạn đi công tác cả ngày, hãy bấm widget hoặc sửa giờ trong app.");
        put("trk.locating", "getting your location…", "đang lấy vị trí…");
        put("trk.distM", "%s m from the office", "cách công ty %s m");
        put("trk.distKm", "%s km from the office", "cách công ty %s km");
        put("trk.wifi", "office Wi-Fi in range", "thấy Wi-Fi công ty");
        put("trk.updated", " · updated %s", " · cập nhật %s");
        put("trk.arrived", "Arrived at the office at %s", "Đã tới công ty lúc %s");
        put("trk.autoIn", "Checking in automatically after %1$s min (%2$s min left) · check-in time will be %3$s", "Tự check in sau %1$s phút (còn %2$s phút) · giờ vào là %3$s");
        put("trk.confirming", "Confirming you're here (%s min left)", "Đang xác nhận có mặt (còn %s phút)");
        put("trk.inside", "At the office", "Đang ở công ty");
        put("trk.insideSince", " · in at %s", " · vào lúc %s");
        put("trk.insideText", "Check-out is recorded when you leave", "Sẽ ghi giờ ra khi bạn rời đi");
        put("trk.tripFrom", "On a business trip since %s", "Đi công tác từ %s");
        put("trk.leftAt", "Left the office at %s", "Đã rời công ty lúc %s");
        put("trk.tripText", "The app will record when you return to the office", "App sẽ ghi lúc bạn quay lại công ty");
        put("trk.leftUntil", "If you're not back by %1$s, %2$s becomes your check-out", "Nếu không quay lại trước %1$s, giờ ra sẽ là %2$s");
        put("finalize.auto", "You didn't come back after leaving at %s. Tap to view or edit.", "Bạn không quay lại sau khi rời lúc %s. Bấm để xem hoặc sửa giờ.");
        put("trk.checkedInText", "Check-out is recorded when you leave the office · %s", "Sẽ ghi giờ ra khi bạn rời công ty · %s");
        put("trk.waiting", "Waiting for you to arrive at the office", "Đang chờ bạn tới công ty");
        put("act.confirm", "Confirm %s", "Xác nhận %s");
        put("act.notMe", "Not there yet", "Không phải");
        put("act.confirmOut", "Confirm out %s", "Chốt giờ ra %s");
        put("act.checkoutNow", "Check out now", "Check out ngay");
        put("act.endToday", "End today", "Kết thúc hôm nay");
        put("act.checkinNow", "Check in now", "Check in ngay");
        put("act.dayOff", "Day off today", "Hôm nay nghỉ");
    }

    /** True when the Vietnamese text should be used. */
    static boolean vi(Context c) {
        String lang = GeofenceStore.prefs(c).getString("lang", "");
        if (lang.isEmpty()) return "vi".equals(Locale.getDefault().getLanguage());
        return "vi".equals(lang);
    }

    static Locale locale(Context c) { return vi(c) ? Locale.forLanguageTag("vi-VN") : Locale.US; }

    static String t(Context c, String key, Object... args) {
        String[] row = TEXT.get(key);
        String s = row == null ? key : row[vi(c) ? 1 : 0];
        return args.length == 0 ? s : String.format(locale(c), s, args);
    }

    /** Saves the app's language and refreshes everything Android is currently showing. */
    static void setLanguage(Context c, String lang) {
        if (lang == null || !(lang.equals("en") || lang.equals("vi"))) return;
        Context app = c.getApplicationContext();
        if (lang.equals(GeofenceStore.prefs(app).getString("lang", ""))) return;
        GeofenceStore.prefs(app).edit().putString("lang", lang).apply();
        GeofenceStore.createChannel(app);
        TrackingService.createChannel(app);
        DayState.refreshWidgets(app);
        TrackingService.send(app, TrackingService.A_REFRESH);
    }
}
