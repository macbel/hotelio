package es.alufi.vuelotel;

import android.Manifest;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

@CapacitorPlugin(name = "RumbivaAlerts", permissions = @Permission(alias = "notifications", strings = {Manifest.permission.POST_NOTIFICATIONS}))
public final class RumbivaAlertsPlugin extends Plugin {
    private JSObject pendingOpen;
    @PluginMethod public void status(PluginCall call) {
        SharedPreferences state = AlertNotificationState.preferences(getContext());
        JSObject result = new JSObject(); result.put("enabled", state.getBoolean("enabled", false));
        result.put("permission", AlertNotificationsWorker.permitted(getContext())); result.put("userId", state.getLong("userId", 0)); call.resolve(result);
    }
    @PluginMethod public void requestNotificationPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") != PermissionState.GRANTED) requestPermissionForAlias("notifications", call, "notificationPermissionResult");
        else notificationPermissionResult(call);
    }
    @PermissionCallback private void notificationPermissionResult(PluginCall call) {
        JSObject result = new JSObject(); result.put("permission", AlertNotificationsWorker.permitted(getContext())); call.resolve(result);
    }
    @PluginMethod public void configure(PluginCall call) {
        String token = call.getString("token", ""); long userId = call.getLong("userId", 0L);
        if (token.isEmpty() || token.length() > 512 || token.matches(".*[\\x00-\\x20\\x7f].*") || userId < 1) { call.reject("Sesión no válida."); return; }
        if (!AlertNotificationsWorker.permitted(getContext())) { call.reject("Activa el permiso de notificaciones de Android."); return; }
        AlertNotificationState.enable(getContext(), token, userId); status(call);
    }
    @PluginMethod public void disable(PluginCall call) { AlertNotificationState.disable(getContext()); status(call); }
    @PluginMethod public synchronized void consumeOpen(PluginCall call) {
        JSObject open = pendingOpen; pendingOpen = null; call.resolve(open == null ? new JSObject() : open);
    }
    @Override protected synchronized void handleOnNewIntent(Intent intent) {
        if (intent == null) return;
        long alertId = intent.getLongExtra("rumbivaAlertId", 0), userId = intent.getLongExtra("rumbivaUserId", 0);
        if (alertId < 1 || userId < 1) return;
        intent.removeExtra("rumbivaAlertId"); intent.removeExtra("rumbivaUserId");
        pendingOpen = new JSObject(); pendingOpen.put("alertId", alertId); pendingOpen.put("userId", userId);
        notifyListeners("alertOpened", pendingOpen);
    }
}
