package com.zimandsoftware.driver;

import android.Manifest;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * Puntea dintre partea web şi serviciul nativ de urmărire (TrackerService).
 *  start({url, token}) – porneşte serviciul (cere permisiunea de locaţie dacă lipseşte)
 *  stop()              – îl opreşte
 *  status()            – {activ: boolean}
 */
@CapacitorPlugin(
    name = "ZimandTracker",
    permissions = {
        @Permission(alias = "location", strings = {
            Manifest.permission.ACCESS_FINE_LOCATION,
            Manifest.permission.ACCESS_COARSE_LOCATION
        })
    }
)
public class ZimandTrackerPlugin extends Plugin {

    @PluginMethod
    public void start(PluginCall call) {
        String url = call.getString("url");
        String token = call.getString("token");
        if (url == null || token == null) {
            call.reject("url/token fehlt");
            return;
        }
        if (getPermissionState("location") != PermissionState.GRANTED) {
            requestPermissionForAlias("location", call, "dupaPermisiune");
            return;
        }
        porneste(call, url, token);
    }

    @PermissionCallback
    private void dupaPermisiune(PluginCall call) {
        if (getPermissionState("location") == PermissionState.GRANTED) {
            porneste(call, call.getString("url"), call.getString("token"));
        } else {
            call.reject("Standort nicht erlaubt", "DENIED");
        }
    }

    private void porneste(PluginCall call, String url, String token) {
        try {
            TrackerService.porneste(getContext(), url, token);
            JSObject r = new JSObject();
            r.put("activ", true);
            call.resolve(r);
        } catch (Exception e) {
            call.reject("Start fehlgeschlagen: " + e.getMessage());
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        TrackerService.opreste(getContext());
        JSObject r = new JSObject();
        r.put("activ", false);
        call.resolve(r);
    }

    @PluginMethod
    public void status(PluginCall call) {
        JSObject r = new JSObject();
        r.put("activ", TrackerService.activ(getContext()));
        call.resolve(r);
    }
}
