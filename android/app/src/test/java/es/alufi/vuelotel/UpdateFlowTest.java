package es.alufi.vuelotel;
import org.junit.Test;
import static org.junit.Assert.*;

public class UpdateFlowTest {
    @Test public void noInstallationBeforeResumedAndVerified() {
        UpdateFlow flow = new UpdateFlow();
        assertEquals(UpdateFlow.Action.NONE, flow.ready(false, true, true));
        assertEquals(UpdateFlow.Action.NONE, flow.ready(true, false, true));
        assertEquals(UpdateFlow.Action.INSTALL, flow.ready(true, true, true));
    }
    @Test public void installerCancellationAndRotationDoNotLoop() {
        UpdateFlow flow = new UpdateFlow();
        assertEquals(UpdateFlow.Action.INSTALL, flow.ready(true, true, true));
        flow.paused();
        assertEquals(UpdateFlow.Action.NONE, flow.ready(true, true, true));
        assertEquals(UpdateFlow.Action.NONE, flow.ready(true, true, true));
        assertEquals(UpdateFlow.Action.INSTALL, new UpdateFlow().ready(true, true, true));
    }
    @Test public void permissionOnlyConsumedAfterDepartureThenGrantedContinues() {
        UpdateFlow flow = new UpdateFlow();
        assertEquals(UpdateFlow.Action.PERMISSION, flow.ready(true, true, false));
        assertEquals(UpdateFlow.Action.NONE, flow.ready(true, true, false));
        assertEquals(UpdateFlow.Action.NONE, flow.ready(true, true, true));
        flow.paused();
        assertEquals(UpdateFlow.Action.INSTALL, flow.ready(true, true, true));
        assertEquals(UpdateFlow.Action.NONE, flow.ready(true, true, true));
    }
    @Test public void deniedPermissionAndLaunchFailureNeverLoop() {
        UpdateFlow flow = new UpdateFlow();
        assertEquals(UpdateFlow.Action.PERMISSION, flow.ready(true, true, false));
        flow.paused();
        assertEquals(UpdateFlow.Action.NONE, flow.ready(true, true, false));
        assertEquals(UpdateFlow.Action.NONE, flow.ready(true, true, false));
        assertEquals(UpdateFlow.Action.NONE, flow.ready(true, true, true));
        UpdateFlow failed = new UpdateFlow();
        assertEquals(UpdateFlow.Action.PERMISSION, failed.ready(true, true, false));
        failed.launchFailed();
        assertEquals(UpdateFlow.Action.NONE, failed.ready(true, true, false));
    }
}
