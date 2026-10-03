package es.alufi.vuelotel;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private VuelotelUpdateChecker updater;
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        updater = new VuelotelUpdateChecker(this);
    }
    @Override public void onResume() { super.onResume(); if (updater != null) updater.onResume(); }
    @Override public void onPause() { if (updater != null) updater.onPause(); super.onPause(); }
    @Override public void onDestroy() { if (updater != null) updater.onDestroy(); super.onDestroy(); }
}
