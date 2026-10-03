package es.alufi.vuelotel;

final class UpdateIdentity {
    final int version;
    final long downloadId;
    final String hash;
    UpdateIdentity(int version, long downloadId, String hash) { this.version = version; this.downloadId = downloadId; this.hash = hash; }
    boolean matches(int currentVersion, long currentId, String currentHash) {
        return version == currentVersion && downloadId == currentId && hash.equals(currentHash);
    }
}
