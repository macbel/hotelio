package es.alufi.vuelotel;

/** Android-independent installation gate, retained for this process across rotations. */
final class UpdateFlow {
    enum Action { NONE, PERMISSION, INSTALL }
    private boolean attempted;
    private boolean waitingPermission;
    private boolean permissionDeparted;

    synchronized void paused() { if (waitingPermission) permissionDeparted = true; }
    synchronized void launchFailed() { waitingPermission = false; permissionDeparted = false; }

    synchronized Action ready(boolean resumed, boolean verified, boolean permissionGranted) {
        if (!resumed || !verified) return Action.NONE;
        if (waitingPermission) {
            if (!permissionDeparted) return Action.NONE;
            waitingPermission = false;
            return permissionGranted ? Action.INSTALL : Action.NONE;
        }
        if (attempted) return Action.NONE;
        attempted = true;
        if (!permissionGranted) {
            waitingPermission = true;
            return Action.PERMISSION;
        }
        return Action.INSTALL;
    }
}
