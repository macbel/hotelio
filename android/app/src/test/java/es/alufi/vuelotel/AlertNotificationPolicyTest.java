package es.alufi.vuelotel;
import org.junit.Test;
import static org.junit.Assert.*;

public class AlertNotificationPolicyTest {
    @Test public void stoppedAndSwitchedSessionsNeverDeliverOldEvents() {
        assertTrue(AlertNotificationPolicy.current("session-a", "session-a", true));
        assertFalse(AlertNotificationPolicy.current("session-a", "session-b", true));
        assertFalse(AlertNotificationPolicy.current("session-a", "session-a", false));
        assertFalse(AlertNotificationPolicy.current("", "", true));
    }
    @Test public void onlyNewRealPriceDropsNotifyAndDuplicatesDoNot() {
        assertTrue(AlertNotificationPolicy.eligible(11, 10, "down", 100, 95));
        assertFalse(AlertNotificationPolicy.eligible(10, 10, "down", 100, 95));
        assertFalse(AlertNotificationPolicy.eligible(11, 10, "up", 95, 100));
        assertFalse(AlertNotificationPolicy.eligible(11, 10, "down", 100, Double.NaN));
        assertFalse(AlertNotificationPolicy.eligible(11, 10, "down", 100, 0));
        assertFalse(AlertNotificationPolicy.eligible(11, 10, "down", 100, 100));
    }
    @Test public void paginationPreservesUnreceivedEventsAndInitialBaselineSkipsHistory() {
        assertEquals(50, AlertNotificationPolicy.nextCursor(0, 50, 120, true));
        assertEquals(120, AlertNotificationPolicy.nextCursor(50, 80, 120, false));
        assertFalse(AlertNotificationPolicy.eligible(119, 120, "down", 100, 90));
        assertTrue(AlertNotificationPolicy.eligible(121, 120, "down", 100, 90));
    }
    @Test(expected = IllegalArgumentException.class) public void emptyPageWithMoreCannotSkipEvents() {
        AlertNotificationPolicy.nextCursor(20, 20, 100, true);
    }
}
