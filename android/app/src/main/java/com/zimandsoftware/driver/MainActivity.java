package com.zimandsoftware.driver;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Pluginul local trebuie înregistrat înainte de pornirea punţii Capacitor.
        registerPlugin(ZimandTrackerPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
