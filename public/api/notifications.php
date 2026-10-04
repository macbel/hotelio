<?php
require_once __DIR__ . '/user-bootstrap.php';
require_once __DIR__ . '/alert-policy.php';
$user = vuelotel_current_user(); $db = vuelotel_db(); $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($method === 'GET') {
    $after = isset($_GET['afterId']) && empty($_GET['baseline']) ? max(0, (int) $_GET['afterId']) : null;
    vuelotel_json(200, vuelotel_notifications($db, (int) $user['id'], $after, (int) ($_GET['limit'] ?? 50)));
}
if ($method !== 'POST') vuelotel_json(405, array('error' => 'Método no permitido.'));
$body = vuelotel_body();
if (($body['action'] ?? '') !== 'mark_read') vuelotel_json(400, array('error' => 'Notificaciones no válidas.'));
try { vuelotel_mark_notifications_read($db, (int) $user['id'], $body['ids'] ?? null, time()); }
catch (InvalidArgumentException $error) { vuelotel_json(400, array('error' => $error->getMessage())); }
vuelotel_json(200, array('ok' => true));
