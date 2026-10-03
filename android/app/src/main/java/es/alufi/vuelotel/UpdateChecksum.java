package es.alufi.vuelotel;

import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.security.MessageDigest;
import java.util.Locale;

final class UpdateChecksum {
    static boolean matches(File file, String expected) {
        if (!expected.matches("[a-f0-9]{64}")) return false;
        try (InputStream input = new BufferedInputStream(new FileInputStream(file))) {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] buffer = new byte[8192];
            int read;
            while ((read = input.read(buffer)) != -1) digest.update(buffer, 0, read);
            StringBuilder actual = new StringBuilder();
            for (byte value : digest.digest()) actual.append(String.format(Locale.ROOT, "%02x", value));
            return expected.equals(actual.toString());
        } catch (Exception ignored) { return false; }
    }
}
