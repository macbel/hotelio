package es.alufi.hotelio;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.File;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;

/** Checks the signed Hotelio APK release manifest when the native app opens. */
final class HotelioUpdateChecker {
    private static final String MANIFEST_URL = "https://www.alufi.es/hotelio/app-update.json";
    private static final String ALLOWED_HOST = "www.alufi.es";

    private HotelioUpdateChecker() {}

    static void check(Activity activity) {
        new Thread(() -> {
            try {
                Release release = fetchRelease();
                if (release.versionCode > BuildConfig.VERSION_CODE) {
                    activity.runOnUiThread(() -> showPrompt(activity, release));
                }
            } catch (Exception ignored) {
                // An update check must never prevent Hotelio from opening.
            }
        }).start();
    }

    private static Release fetchRelease() throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(MANIFEST_URL).openConnection();
        connection.setConnectTimeout(8000);
        connection.setReadTimeout(8000);
        connection.setRequestProperty("Accept", "application/json");
        connection.setUseCaches(false);
        try {
            if (connection.getResponseCode() != HttpURLConnection.HTTP_OK) throw new IllegalStateException("Release unavailable");
            StringBuilder raw = new StringBuilder();
            try (InputStream input = connection.getInputStream()) {
                byte[] buffer = new byte[4096];
                int read;
                while ((read = input.read(buffer)) != -1) raw.append(new String(buffer, 0, read, java.nio.charset.StandardCharsets.UTF_8));
            }
            JSONObject json = new JSONObject(raw.toString());
            int versionCode = json.getInt("versionCode");
            String versionName = json.getString("versionName");
            String apkUrl = json.getString("apkUrl");
            String checksum = json.getString("sha256").toLowerCase(java.util.Locale.ROOT);
            String notes = json.optString("releaseNotes", "Incluye mejoras y correcciones.");
            validateRelease(versionCode, apkUrl, checksum);
            return new Release(versionCode, versionName, apkUrl, checksum, notes);
        } finally {
            connection.disconnect();
        }
    }

    private static void validateRelease(int versionCode, String apkUrl, String checksum) throws Exception {
        URL url = new URL(apkUrl);
        if (versionCode < 1 || !"https".equals(url.getProtocol()) || !ALLOWED_HOST.equalsIgnoreCase(url.getHost()) || !url.getPath().startsWith("/hotelio/downloads/") || !checksum.matches("[a-f0-9]{64}")) {
            throw new IllegalArgumentException("Invalid update manifest");
        }
    }

    private static void showPrompt(Activity activity, Release release) {
        if (activity.isFinishing()) return;
        new AlertDialog.Builder(activity)
            .setTitle("Actualización de Hotelio disponible")
            .setMessage("Versión " + release.versionName + "\n\n" + release.notes + "\n\nSe descargará el APK y Android pedirá tu confirmación antes de instalarlo.")
            .setPositiveButton("Descargar", (dialog, which) -> download(activity, release))
            .setNegativeButton("Más tarde", null)
            .show();
    }

    private static void download(Activity activity, Release release) {
        String name = "hotelio-update-" + release.versionCode + ".apk";
        DownloadManager.Request request = new DownloadManager.Request(Uri.parse(release.apkUrl));
        request.setTitle("Actualizando Hotelio");
        request.setDescription("Descargando versión " + release.versionName);
        request.setMimeType("application/vnd.android.package-archive");
        request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
        request.setDestinationInExternalFilesDir(activity, Environment.DIRECTORY_DOWNLOADS, "Hotelio/" + name);
        DownloadManager manager = (DownloadManager) activity.getSystemService(Context.DOWNLOAD_SERVICE);
        long downloadId = manager.enqueue(request);
        BroadcastReceiver receiver = new BroadcastReceiver() {
            @Override public void onReceive(Context context, Intent intent) {
                if (!DownloadManager.ACTION_DOWNLOAD_COMPLETE.equals(intent.getAction()) || intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1L) != downloadId) return;
                try { activity.unregisterReceiver(this); } catch (IllegalArgumentException ignored) {}
                if (!downloadSucceeded(manager, downloadId)) {
                    activity.runOnUiThread(() -> showMessage(activity, "No se pudo descargar la actualización."));
                    return;
                }
                File apk = new File(activity.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "Hotelio/" + name);
                new Thread(() -> {
                    boolean verified = apk.isFile() && checksumMatches(apk, release.sha256);
                    activity.runOnUiThread(() -> {
                        if (verified) openInstaller(activity, apk);
                        else showMessage(activity, "La descarga no superó la verificación de seguridad.");
                    });
                }).start();
            }
        };
        IntentFilter filter = new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) activity.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED);
        else activity.registerReceiver(receiver, filter);
    }

    private static boolean downloadSucceeded(DownloadManager manager, long downloadId) {
        DownloadManager.Query query = new DownloadManager.Query().setFilterById(downloadId);
        try (Cursor cursor = manager.query(query)) {
            return cursor != null && cursor.moveToFirst() && cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS)) == DownloadManager.STATUS_SUCCESSFUL;
        }
    }

    private static boolean checksumMatches(File file, String expected) {
        try (InputStream input = new BufferedInputStream(new java.io.FileInputStream(file))) {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] buffer = new byte[8192];
            int read;
            while ((read = input.read(buffer)) != -1) digest.update(buffer, 0, read);
            StringBuilder actual = new StringBuilder();
            for (byte value : digest.digest()) actual.append(String.format(java.util.Locale.ROOT, "%02x", value));
            return expected.equals(actual.toString());
        } catch (Exception ignored) {
            return false;
        }
    }

    private static void openInstaller(Activity activity, File apk) {
        Uri uri = FileProvider.getUriForFile(activity, BuildConfig.APPLICATION_ID + ".fileprovider", apk);
        Intent install = new Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !activity.getPackageManager().canRequestPackageInstalls()) {
            activity.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + BuildConfig.APPLICATION_ID)));
            return;
        }
        activity.startActivity(install);
    }

    private static void showMessage(Activity activity, String message) {
        if (!activity.isFinishing()) new AlertDialog.Builder(activity).setMessage(message).setPositiveButton("Aceptar", null).show();
    }

    private static final class Release {
        final int versionCode;
        final String versionName;
        final String apkUrl;
        final String sha256;
        final String notes;

        Release(int versionCode, String versionName, String apkUrl, String sha256, String notes) {
            this.versionCode = versionCode;
            this.versionName = versionName;
            this.apkUrl = apkUrl;
            this.sha256 = sha256;
            this.notes = notes;
        }
    }
}
