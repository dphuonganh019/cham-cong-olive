package vn.olive.chamcong;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Android xoá geofence khi khởi động lại máy hoặc cập nhật app: đăng ký lại. */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String a = intent.getAction();
        if (Intent.ACTION_BOOT_COMPLETED.equals(a) || Intent.ACTION_MY_PACKAGE_REPLACED.equals(a)
            || "android.intent.action.LOCKED_BOOT_COMPLETED".equals(a)) {
            final PendingResult pending = goAsync();
            GeofenceStore.register(context, false, (ok, err) -> pending.finish());
        }
    }
}
