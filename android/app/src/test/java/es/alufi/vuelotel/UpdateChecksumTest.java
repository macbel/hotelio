package es.alufi.vuelotel;
import org.junit.Test;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import static org.junit.Assert.*;

public class UpdateChecksumTest {
    @Test public void knownBytesPassAndTamperingFailsBeforeInstallerGate() throws Exception {
        File file = File.createTempFile("rumbiva-apk-", ".apk");
        String hash = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
        try {
            Files.write(file.toPath(), "abc".getBytes(StandardCharsets.UTF_8));
            assertTrue(UpdateChecksum.matches(file, hash));
            Files.write(file.toPath(), "tampered".getBytes(StandardCharsets.UTF_8));
            boolean verified = UpdateChecksum.matches(file, hash);
            assertFalse(verified);
            assertEquals(UpdateFlow.Action.NONE, new UpdateFlow().ready(true, verified, true));
            assertFalse(UpdateChecksum.matches(file, "invalid"));
        } finally { file.delete(); }
    }
}
