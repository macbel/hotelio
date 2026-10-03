package es.alufi.vuelotel;

final class UpdateDownloadPolicy {
    static boolean shouldEnqueue(int installed, int offered, int stored, boolean matchingMetadata,
                                 int downloadStatus, long now, long retryAfter) {
        boolean reusableDownload = downloadStatus == 1 || downloadStatus == 2 || downloadStatus == 4 || downloadStatus == 8;
        if (offered <= installed || now < retryAfter) return false;
        if (reusableDownload && (stored > offered || (stored == offered && matchingMetadata))) return false;
        return true;
    }
}
