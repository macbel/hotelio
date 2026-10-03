<?php
require_once __DIR__ . '/../public/api/alerts-run-support.php';
function check($value, $message) { if (!$value) throw new Exception($message); }
check(vuelotel_alerts_authorized('cli', '', ''), 'CLI must work without a web secret');
check(!vuelotel_alerts_authorized('cli-server', '', ''), 'PHP server must require a secret');
check(!vuelotel_alerts_authorized('fpm-fcgi', '', ''), 'Empty web secret must deny access');
check(!vuelotel_alerts_authorized('fpm-fcgi', 'test-secret', 'wrong'), 'Wrong secret must deny access');
check(vuelotel_alerts_authorized('fpm-fcgi', 'test-secret', 'test-secret'), 'Correct secret must authorize');
$path = tempnam(sys_get_temp_dir(), 'vuelotel-lock-');
$first = vuelotel_alerts_lock($path);
check(is_resource($first), 'First runner must acquire lock');
check(vuelotel_alerts_lock($path) === null, 'Second runner must skip immediately');
flock($first, LOCK_UN); fclose($first);
$next = vuelotel_alerts_lock($path);
check(is_resource($next), 'A later runner must acquire released lock');
fclose($next); unlink($path);
echo "Alerts authorization and locking passed.\n";
