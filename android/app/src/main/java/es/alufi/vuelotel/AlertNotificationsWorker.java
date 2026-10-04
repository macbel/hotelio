package es.alufi.vuelotel;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.text.NumberFormat;
import java.util.Currency;
import java.util.Locale;

public final class AlertNotificationsWorker extends Worker {
    private static final String ENDPOINT = "https://www.alufi.es/vuelotel/api/notifications.php";
    private static final String CHANNEL = "rumbiva-price-drops";
    public AlertNotificationsWorker(@NonNull Context context, @NonNull WorkerParameters parameters) { super(context, parameters); }
    static boolean permitted(Context context) {
        return (Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED)
                && NotificationManagerCompat.from(context).areNotificationsEnabled();
    }
    @NonNull @Override public Result doWork() {
        Context context = getApplicationContext();
        String generation = getInputData().getString("generation");
        SharedPreferences state = AlertNotificationState.preferences(context);
        if (!AlertNotificationState.current(context, generation)) return Result.success();
        if (!permitted(context)) {
            synchronized (AlertNotificationState.LOCK) { if (AlertNotificationState.current(context, generation)) AlertNotificationState.disable(context); }
            return Result.success();
        }
        String token; long userId; long cursor;
        synchronized (AlertNotificationState.LOCK) {
            if (!AlertNotificationState.current(context, generation)) return Result.success();
            token = state.getString("token", ""); userId = state.getLong("userId", 0); cursor = state.getLong("cursor", -1);
        }
        if (token.isEmpty() || userId < 1) return Result.success();
        try {
            if (cursor < 0) {
                JSONObject initial = fetch(token, "?baseline=1");
                long baseline = initial.getLong("newestId");
                if (baseline < 0) throw new IllegalArgumentException("Invalid baseline");
                synchronized (AlertNotificationState.LOCK) {
                    if (AlertNotificationState.current(context, generation) && !isStopped()) state.edit().putLong("cursor", baseline).commit();
                }
                return Result.success();
            }
            for (int page = 0; page < 4 && !isStopped(); page++) {
                JSONObject response = fetch(token, "?afterId=" + cursor + "&limit=50");
                JSONArray events = response.getJSONArray("notifications");
                boolean more = response.getBoolean("hasMore");
                long newest = response.getLong("newestId"), last = cursor;
                if (events.length() > 50) throw new IllegalArgumentException("Oversized page");
                for (int i = 0; i < events.length(); i++) {
                    JSONObject event = events.getJSONObject(i);
                    long id = event.getLong("id");
                    if (id <= last || id > newest) throw new IllegalArgumentException("Unordered events");
                    synchronized (AlertNotificationState.LOCK) {
                        if (!AlertNotificationState.current(context, generation) || isStopped()) return Result.success();
                        if (permitted(context) && AlertNotificationPolicy.eligible(id, state.getLong("cursor", cursor), event.optString("direction"), event.optDouble("oldPrice"), event.optDouble("price"))) {
                            post(context, event, userId);
                        }
                        state.edit().putLong("cursor", id).commit();
                    }
                    last = id;
                }
                cursor = AlertNotificationPolicy.nextCursor(cursor, last, newest, more);
                synchronized (AlertNotificationState.LOCK) {
                    if (!AlertNotificationState.current(context, generation) || isStopped()) return Result.success();
                    state.edit().putLong("cursor", cursor).commit();
                }
                if (!more) return Result.success();
            }
            return isStopped() ? Result.success() : Result.retry();
        } catch (ExpiredSession expired) {
            synchronized (AlertNotificationState.LOCK) { if (AlertNotificationState.current(context, generation)) AlertNotificationState.disable(context); }
            return Result.success();
        } catch (Exception ignored) { return Result.retry(); }
    }
    private JSONObject fetch(String token, String query) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(ENDPOINT + query).openConnection();
        connection.setConnectTimeout(15000); connection.setReadTimeout(20000); connection.setInstanceFollowRedirects(false);
        connection.setRequestProperty("Accept", "application/json"); connection.setRequestProperty("Authorization", "Bearer " + token);
        try {
            int code = connection.getResponseCode();
            if (code == 401 || code == 403) throw new ExpiredSession();
            if (code != 200) throw new IllegalStateException("Feed unavailable");
            ByteArrayOutputStream body = new ByteArrayOutputStream();
            try (InputStream input = connection.getInputStream()) {
                byte[] buffer = new byte[4096]; int count;
                while ((count = input.read(buffer)) != -1) {
                    if (body.size() + count > 262144) throw new IllegalArgumentException("Feed too large");
                    body.write(buffer, 0, count);
                }
            }
            return new JSONObject(body.toString("UTF-8"));
        } finally { connection.disconnect(); }
    }
    private void post(Context context, JSONObject event, long userId) throws Exception {
        long id = event.getLong("id"), alertId = event.getLong("alertId");
        if (alertId < 1) throw new IllegalArgumentException("Invalid alert");
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26) manager.createNotificationChannel(new NotificationChannel(CHANNEL, "Bajadas de precio", NotificationManager.IMPORTANCE_DEFAULT));
        Intent intent = new Intent(context, MainActivity.class).setAction("es.alufi.vuelotel.OPEN_ALERT." + id)
                .putExtra("rumbivaAlertId", alertId).putExtra("rumbivaUserId", userId)
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        int notificationId = (int) (id ^ (id >>> 32));
        PendingIntent open = PendingIntent.getActivity(context, notificationId, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        NumberFormat money = NumberFormat.getCurrencyInstance(new Locale("es", "ES"));
        money.setCurrency(Currency.getInstance(event.optString("currency", "EUR")));
        String text = money.format(event.getDouble("oldPrice")) + " → " + money.format(event.getDouble("price"));
        String label = event.optString("label", "Tu viaje"); if (label.length() > 120) label = label.substring(0, 120);
        NotificationManagerCompat.from(context).notify(notificationId, new NotificationCompat.Builder(context, CHANNEL)
                .setSmallIcon(R.drawable.ic_stat_rumbiva).setContentTitle("Ha bajado el precio · " + label)
                .setContentText(text).setContentIntent(open).setAutoCancel(true).setOnlyAlertOnce(true)
                .setVisibility(NotificationCompat.VISIBILITY_PRIVATE).build());
    }
    private static final class ExpiredSession extends Exception {}
}
