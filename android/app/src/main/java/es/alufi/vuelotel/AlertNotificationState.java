package es.alufi.vuelotel;

import android.content.Context;
import android.content.SharedPreferences;
import androidx.core.app.NotificationManagerCompat;
import androidx.work.Constraints;
import androidx.work.Data;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

final class AlertNotificationState {
    static final Object LOCK = new Object();
    static final String WORK = "rumbiva-price-notifications";
    static SharedPreferences preferences(Context context) {
        return context.getSharedPreferences("rumbiva-native-alerts", Context.MODE_PRIVATE);
    }
    static boolean current(Context context, String generation) {
        SharedPreferences state = preferences(context);
        return AlertNotificationPolicy.current(generation, state.getString("generation", ""), state.getBoolean("enabled", false));
    }
    static void enable(Context context, String token, long userId) {
        synchronized (LOCK) {
            SharedPreferences state = preferences(context);
            boolean same = state.getBoolean("enabled", false) && state.getLong("userId", 0) == userId;
            boolean unchanged = same && token.equals(state.getString("token", ""));
            String generation = unchanged ? state.getString("generation", "") : UUID.randomUUID().toString();
            if (!same) {
                WorkManager.getInstance(context).cancelUniqueWork(WORK);
                NotificationManagerCompat.from(context).cancelAll();
                state.edit().clear().commit();
            }
            state.edit().putBoolean("enabled", true).putString("token", token).putLong("userId", userId)
                    .putString("generation", generation).commit();
            PeriodicWorkRequest request = new PeriodicWorkRequest.Builder(AlertNotificationsWorker.class, 15, TimeUnit.MINUTES)
                    .setConstraints(new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                    .setInputData(new Data.Builder().putString("generation", generation).build()).build();
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(WORK,
                    unchanged ? ExistingPeriodicWorkPolicy.KEEP : ExistingPeriodicWorkPolicy.CANCEL_AND_REENQUEUE, request);
        }
    }
    static void disable(Context context) {
        synchronized (LOCK) {
            preferences(context).edit().clear().commit();
            WorkManager.getInstance(context).cancelUniqueWork(WORK);
            NotificationManagerCompat.from(context).cancelAll();
        }
    }
}
