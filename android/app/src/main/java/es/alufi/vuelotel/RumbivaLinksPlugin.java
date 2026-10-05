package es.alufi.vuelotel;

import android.content.Intent;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "RumbivaLinks")
public final class RumbivaLinksPlugin extends Plugin {
    private long pendingId;
    @PluginMethod public synchronized void consumeLink(PluginCall call) {
        JSObject result = new JSObject();
        if (pendingId > 0) result.put("alertId", pendingId);
        pendingId = 0; call.resolve(result);
    }
    @Override protected synchronized void handleOnNewIntent(Intent intent) {
        if (intent == null || !Intent.ACTION_VIEW.equals(intent.getAction())) return;
        long id = AlertLinkPolicy.alertId(intent.getDataString());
        if (id < 1) return;
        pendingId = id;
        JSObject detail = new JSObject(); detail.put("alertId", id);
        notifyListeners("linkOpened", detail);
    }
}
