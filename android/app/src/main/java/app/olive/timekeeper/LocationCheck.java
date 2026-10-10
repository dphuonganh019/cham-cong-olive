package app.olive.timekeeper;

import android.annotation.SuppressLint;
import android.content.Context;
import android.location.Location;
import android.os.Handler;
import android.os.Looper;

import com.google.android.gms.location.CurrentLocationRequest;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;
import com.google.android.gms.tasks.CancellationTokenSource;

import java.util.concurrent.atomic.AtomicBoolean;

/** Gets one fresh, high-accuracy location to double-check an Android geofence signal. */
final class LocationCheck {
    interface Callback { void done(Location loc, boolean fresh); }

    private static final long DURATION_MS = 20_000;
    private static final long HARD_TIMEOUT_MS = 25_000;

    private LocationCheck() {}

    /** Calls cb exactly once: with a new location (fresh=true), or with the fallback (fresh=false) if none arrives. */
    @SuppressLint("MissingPermission")
    static void fresh(Context c, Location fallback, Callback cb) {
        final AtomicBoolean done = new AtomicBoolean(false);
        if (!GeofenceStore.hasFine(c)) { cb.done(fallback, false); return; }
        final CancellationTokenSource cts = new CancellationTokenSource();
        final Handler h = new Handler(Looper.getMainLooper());
        h.postDelayed(() -> {
            if (done.compareAndSet(false, true)) { cts.cancel(); cb.done(fallback, false); }
        }, HARD_TIMEOUT_MS);
        CurrentLocationRequest req = new CurrentLocationRequest.Builder()
            .setPriority(Priority.PRIORITY_HIGH_ACCURACY)
            .setMaxUpdateAgeMillis(60_000)
            .setDurationMillis(DURATION_MS)
            .build();
        try {
            LocationServices.getFusedLocationProviderClient(c.getApplicationContext())
                .getCurrentLocation(req, cts.getToken())
                .addOnCompleteListener(task -> {
                    if (!done.compareAndSet(false, true)) return;
                    h.removeCallbacksAndMessages(null);
                    Location l = task.isSuccessful() ? task.getResult() : null;
                    if (l != null) cb.done(l, true); else cb.done(fallback, false);
                });
        } catch (SecurityException e) {
            if (done.compareAndSet(false, true)) { h.removeCallbacksAndMessages(null); cb.done(fallback, false); }
        }
    }
}
