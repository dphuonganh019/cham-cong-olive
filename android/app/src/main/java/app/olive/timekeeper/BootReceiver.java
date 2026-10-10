package app.olive.timekeeper;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Android drops geofences and alarms after a reboot or an app update: register them again. */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String a = intent.getAction();
        if (Intent.ACTION_BOOT_COMPLETED.equals(a) || Intent.ACTION_MY_PACKAGE_REPLACED.equals(a)
            || "android.intent.action.LOCKED_BOOT_COMPLETED".equals(a)) {
            final PendingResult pending = goAsync();
            TrackingScheduler.scheduleNext(context);
            TrackingScheduler.maybeStart(context);
            GeofenceStore.register(context, false, (ok, err) -> pending.finish());
        }
    }
}
