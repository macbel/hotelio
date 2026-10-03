package es.alufi.vuelotel;
import org.junit.Test;
import static org.junit.Assert.*;

public class UpdateIdentityTest {
    @Test public void replacedDownloadCannotUseOldVerificationCallback() {
        UpdateIdentity verified = new UpdateIdentity(15, 41L, "hash-one");
        assertTrue(verified.matches(15, 41L, "hash-one"));
        assertFalse(verified.matches(16, 42L, "hash-two"));
        assertFalse(verified.matches(15, 42L, "hash-one"));
        assertFalse(verified.matches(15, 41L, "hash-two"));
        assertEquals(UpdateFlow.Action.NONE, new UpdateFlow().ready(true, verified.matches(16, 42L, "hash-two"), true));
    }
}
