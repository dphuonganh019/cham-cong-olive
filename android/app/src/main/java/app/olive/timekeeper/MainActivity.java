package app.olive.timekeeper;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(OliveGeofencePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
