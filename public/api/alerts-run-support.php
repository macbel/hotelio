<?php
function vuelotel_alerts_authorized($sapi, $expected, $provided) {
    return $sapi === 'cli' || ($expected !== '' && hash_equals($expected, $provided));
}
function vuelotel_alerts_lock($path) {
    $handle = @fopen($path, 'c');
    if ($handle === false) return false;
    @chmod($path, 0600);
    if (!flock($handle, LOCK_EX | LOCK_NB)) { fclose($handle); return null; }
    return $handle;
}
