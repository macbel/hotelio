package es.alufi.vuelotel;

import android.app.Activity;
import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.InputStream;
import java.lang.ref.WeakReference;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** OS-managed downloads survive process death; only a resumed host launches installation. */
final class VuelotelUpdateChecker {
    private static final String MANIFEST_URL = "https://www.alufi.es/vuelotel/app-update.json";
    private static final long RETRY_DELAY = 60 * 60 * 1000L;
    private static final ExecutorService WORKER = Executors.newSingleThreadExecutor();
    private static final Map<Integer, UpdateFlow> FLOWS = new HashMap<>();
    private static final Object INSTALL_LOCK = new Object();
    private static int pinnedVersion;
    private static long lastManifestCheck;
    private final Context context;
    private final WeakReference<Activity> activity;
    private final SharedPreferences preferences;
    private final DownloadManager manager;
    private final Handler main = new Handler(Looper.getMainLooper());
    private boolean resumed, destroyed, registered, reconciling;
    private final BroadcastReceiver receiver = new BroadcastReceiver() {
        @Override public void onReceive(Context ignored, Intent intent) {
            if (DownloadManager.ACTION_DOWNLOAD_COMPLETE.equals(intent.getAction())
                    && intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1) == preferences.getLong("id", -2)) reconcile();
        }
    };
    VuelotelUpdateChecker(Activity host) {
        context = host.getApplicationContext(); activity = new WeakReference<>(host);
        preferences = context.getSharedPreferences("rumbiva-updater", Context.MODE_PRIVATE);
        manager = (DownloadManager) context.getSystemService(Context.DOWNLOAD_SERVICE);
    }
    void onResume() {
        if (destroyed) return;
        resumed = true;
        if (!registered) {
            IntentFilter filter = new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) context.registerReceiver(receiver, filter, Context.RECEIVER_EXPORTED);
            else context.registerReceiver(receiver, filter);
            registered = true;
        }
        reconcile();
        long now = System.currentTimeMillis();
        if (now >= preferences.getLong("retryAfter", 0) && now - lastManifestCheck >= 15 * 60 * 1000L) {
            lastManifestCheck = now;
            WORKER.execute(() -> {
                try { Release release = fetchRelease(); if (release.versionCode > BuildConfig.VERSION_CODE) ensureDownload(release); }
                catch (Exception ignored) { backoff(); }
                main.post(this::reconcile);
            });
        }
    }
    void onPause() { resumed = false; for (UpdateFlow flow : FLOWS.values()) flow.paused(); unregister(); }
    void onDestroy() {
        Activity host = activity.get();
        if (host != null && !host.isChangingConfigurations()) { FLOWS.clear(); lastManifestCheck = 0; synchronized (INSTALL_LOCK) { pinnedVersion = 0; } }
        destroyed = true; resumed = false; unregister(); activity.clear();
    }
    private void unregister() {
        if (registered) {
            try { context.unregisterReceiver(receiver); } catch (IllegalArgumentException ignored) { }
            registered = false;
        }
    }
    private File directory() {
        File external = context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
        return external == null ? null : new File(external, "Vuelotel");
    }
    private File apkFile(int version) {
        File dir = directory(); return dir == null ? null : new File(dir, "vuelotel-update-" + version + ".apk");
    }
    private int status(long id) {
        if (id < 0 || manager == null) return 0;
        try (Cursor cursor = manager.query(new DownloadManager.Query().setFilterById(id))) {
            return cursor != null && cursor.moveToFirst() ? cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS)) : 0;
        }
    }
    private long recoverId() {
        long id = preferences.getLong("id", -1);
        if (id >= 0 || manager == null) return id;
        File apk = apkFile(preferences.getInt("version", 0));
        if (apk == null || preferences.getInt("version", 0) <= BuildConfig.VERSION_CODE) return -1;
        String url = preferences.getString("url", "");
        // Recover the narrow crash window between DownloadManager.enqueue and preferences.commit.
        try (Cursor cursor = manager.query(new DownloadManager.Query())) {
            while (cursor != null && cursor.moveToNext()) {
                String source = cursor.getString(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_URI));
                String local = cursor.getString(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_LOCAL_URI));
                if (url.equals(source) && local != null && apk.getAbsolutePath().equals(Uri.parse(local).getPath())) {
                    id = cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_ID));
                    preferences.edit().putLong("id", id).commit();
                    return id;
                }
            }
        }
        return -1;
    }
    private void reconcile() {
        if (!resumed || destroyed || reconciling) return;
        reconciling = true;
        WORKER.execute(() -> {
            File ready = null;
            UpdateIdentity identity = null;
            int version = preferences.getInt("version", 0);
            try {
                cleanupInstalled();
                long id = recoverId();
                String hash = preferences.getString("sha256", "");
                int state = status(id);
                if (version > BuildConfig.VERSION_CODE && state == DownloadManager.STATUS_SUCCESSFUL) {
                    File apk = apkFile(version);
                    if (apk != null && UpdateChecksum.matches(apk, hash)) {
                        ready = apk;
                        identity = new UpdateIdentity(version, id, hash);
                    }
                    else discardWithBackoff();
                } else if (version > BuildConfig.VERSION_CODE && (state == DownloadManager.STATUS_FAILED || (id >= 0 && state == 0))) discardWithBackoff();
            } catch (Exception ignored) { backoff(); }
            File verified = ready;
            UpdateIdentity verifiedIdentity = identity;
            main.post(() -> {
                reconciling = false;
                synchronized (INSTALL_LOCK) {
                if (verified != null && resumed && !destroyed && verifiedIdentity.matches(preferences.getInt("version", 0),
                        preferences.getLong("id", -1), preferences.getString("sha256", "")) && verified.isFile()) installWhenReady(version, verified);
                }
            });
        });
    }
    private void ensureDownload(Release release) {
        synchronized (INSTALL_LOCK) {
        int stored = preferences.getInt("version", 0);
        if (stored > 0 && pinnedVersion == stored) return;
        int state = status(recoverId());
        boolean matching = release.sha256.equals(preferences.getString("sha256", "")) && release.apkUrl.equals(preferences.getString("url", ""));
        if (!UpdateDownloadPolicy.shouldEnqueue(BuildConfig.VERSION_CODE, release.versionCode, stored, matching,
                state, System.currentTimeMillis(), preferences.getLong("retryAfter", 0))) return;
        discard();
        File apk = apkFile(release.versionCode);
        if (apk == null || manager == null) { backoff(); return; }
        if (!apk.getParentFile().isDirectory() && !apk.getParentFile().mkdirs()) { backoff(); return; }
        if (apk.exists() && !apk.delete()) { backoff(); return; }
        preferences.edit().putInt("version", release.versionCode).putString("url", release.apkUrl)
                .putString("sha256", release.sha256).putString("name", release.versionName).remove("id").commit();
        DownloadManager.Request request = new DownloadManager.Request(Uri.parse(release.apkUrl));
        request.setTitle("Actualizando Rumbiva"); request.setDescription("Descargando versión " + release.versionName);
        request.setMimeType("application/vnd.android.package-archive");
        request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE);
        request.setDestinationInExternalFilesDir(context, Environment.DIRECTORY_DOWNLOADS, "Vuelotel/" + apk.getName());
        long id = manager.enqueue(request);
        preferences.edit().putLong("id", id).putLong("retryAfter", 0).commit();
        }
    }
    private void backoff() { preferences.edit().putLong("retryAfter", System.currentTimeMillis() + RETRY_DELAY).commit(); }
    private void discardWithBackoff() { discard(); backoff(); }
    private void discard() {
        synchronized (INSTALL_LOCK) {
        int version = preferences.getInt("version", 0); long id = preferences.getLong("id", -1);
        if (version > 0 && pinnedVersion == version) return;
        if (id >= 0 && manager != null) manager.remove(id);
        File apk = apkFile(version); if (version > 0 && apk != null && apk.isFile()) apk.delete();
        preferences.edit().remove("id").remove("version").remove("url").remove("sha256").remove("name").commit();
        }
    }
    private void cleanupInstalled() {
        int version = preferences.getInt("version", 0);
        if (version > 0 && version <= BuildConfig.VERSION_CODE) discard();
        File dir = directory(); File[] files = dir == null ? null : dir.listFiles();
        if (files == null) return;
        for (File file : files) {
            if (!file.getName().matches("vuelotel-update-[0-9]+\\.apk")) continue;
            try {
                int code = Integer.parseInt(file.getName().substring(16, file.getName().length() - 4));
                if (code <= BuildConfig.VERSION_CODE && file.isFile()) file.delete();
            } catch (NumberFormatException ignored) { }
        }
    }
    private void installWhenReady(int version, File apk) {
        Activity host = activity.get();
        if (host == null || host.isFinishing() || host.isDestroyed() || !resumed) return;
        if (System.currentTimeMillis() < preferences.getLong("installRetryAfter", 0)) return;
        boolean permitted = Build.VERSION.SDK_INT < Build.VERSION_CODES.O || context.getPackageManager().canRequestPackageInstalls();
        UpdateFlow flow = FLOWS.computeIfAbsent(version, ignored -> new UpdateFlow());
        UpdateFlow.Action action = flow.ready(true, true, permitted);
        try {
            if (action == UpdateFlow.Action.PERMISSION) host.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + BuildConfig.APPLICATION_ID)));
            else if (action == UpdateFlow.Action.INSTALL) {
                Uri uri = FileProvider.getUriForFile(context, BuildConfig.APPLICATION_ID + ".fileprovider", apk);
                pinnedVersion = version;
                host.startActivity(new Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION));
            }
        } catch (Exception ignored) {
            pinnedVersion = 0; flow.launchFailed();
            preferences.edit().putLong("installRetryAfter", System.currentTimeMillis() + RETRY_DELAY).commit();
        }
    }
    private static Release fetchRelease() throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(MANIFEST_URL).openConnection();
        connection.setConnectTimeout(8000); connection.setReadTimeout(8000);
        connection.setRequestProperty("Accept", "application/json"); connection.setUseCaches(false); connection.setInstanceFollowRedirects(false);
        try {
            if (connection.getResponseCode() != HttpURLConnection.HTTP_OK) throw new IllegalStateException("Release unavailable");
            ByteArrayOutputStream raw = new ByteArrayOutputStream();
            try (InputStream input = connection.getInputStream()) {
                byte[] buffer = new byte[4096]; int read;
                while ((read = input.read(buffer)) != -1) {
                    if (raw.size() + read > 65536) throw new IllegalArgumentException("Manifest too large");
                    raw.write(buffer, 0, read);
                }
            }
            JSONObject json = new JSONObject(raw.toString("UTF-8"));
            int code = json.getInt("versionCode"); String url = json.getString("apkUrl"); String hash = json.getString("sha256").toLowerCase(Locale.ROOT);
            URL parsed = new URL(url);
            if (code < 1 || !"https".equals(parsed.getProtocol()) || !"www.alufi.es".equalsIgnoreCase(parsed.getHost())
                    || parsed.getPort() != -1 || parsed.getUserInfo() != null || !parsed.getPath().startsWith("/vuelotel/downloads/") || !hash.matches("[a-f0-9]{64}")) throw new IllegalArgumentException("Invalid manifest");
            return new Release(code, json.getString("versionName"), url, hash);
        } finally { connection.disconnect(); }
    }
    private static final class Release {
        final int versionCode; final String versionName, apkUrl, sha256;
        Release(int code, String name, String url, String hash) { versionCode = code; versionName = name; apkUrl = url; sha256 = hash; }
    }
}
