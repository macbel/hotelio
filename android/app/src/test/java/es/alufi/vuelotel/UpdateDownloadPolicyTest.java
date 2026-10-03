package es.alufi.vuelotel;
import org.junit.Test;
import static org.junit.Assert.*;

public class UpdateDownloadPolicyTest {
    @Test public void reopenReusesPendingRunningPausedAndSuccessfulDownloads() {
        for (int state : new int[]{1, 2, 4, 8}) assertFalse(UpdateDownloadPolicy.shouldEnqueue(14, 15, 15, true, state, 100, 0));
    }
    @Test public void missingOrFailedDownloadRetriesAfterBackoff() {
        for (int state : new int[]{0, 16}) {
            assertFalse(UpdateDownloadPolicy.shouldEnqueue(14, 15, 15, true, state, 100, 200));
            assertTrue(UpdateDownloadPolicy.shouldEnqueue(14, 15, 15, true, state, 201, 200));
        }
    }
    @Test public void differentHashOrUrlCannotReuseSameRelease() {
        assertTrue(UpdateDownloadPolicy.shouldEnqueue(14, 15, 15, false, 8, 100, 0));
    }
    @Test public void newerReleaseReplacesOlderButNeverDowngradesPending() {
        assertTrue(UpdateDownloadPolicy.shouldEnqueue(14, 16, 15, false, 2, 100, 0));
        assertFalse(UpdateDownloadPolicy.shouldEnqueue(14, 15, 16, false, 2, 100, 0));
    }
    @Test public void installedReleaseDoesNotDownload() {
        assertFalse(UpdateDownloadPolicy.shouldEnqueue(15, 15, 0, false, 0, 100, 0));
        assertFalse(UpdateDownloadPolicy.shouldEnqueue(16, 15, 0, false, 0, 100, 0));
    }
}
