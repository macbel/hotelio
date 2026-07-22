<?php
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
$origin = isset($_SERVER['HTTP_ORIGIN']) ? (string) $_SERVER['HTTP_ORIGIN'] : '';
$nativeOrigins = array('http://localhost', 'https://localhost', 'capacitor://localhost');
if (in_array($origin, $nativeOrigins, true)) {
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Vary: Origin');
}
require_once __DIR__ . '/bootstrap.php';
echo json_encode(hotelio_public_provider_config(hotelio_config()), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
