<?php
require_once __DIR__ . '/user-bootstrap.php';
$config = hotelio_config();
$expected = (string) ($config['alerts']['cron_secret'] ?? getenv('VUELOTEL_CRON_SECRET') ?: '');
$provided = (string) ($_SERVER['HTTP_X_VUELOTEL_CRON'] ?? ($_GET['secret'] ?? ''));
if ($expected === '' || !hash_equals($expected, $provided)) vuelotel_json(403, array('error' => 'Acceso de cron no autorizado.'));
if (empty($config['alerts']['enabled'])) vuelotel_json(200, array('processed' => 0, 'message' => 'Alertas pausadas.'));

$db = vuelotel_db(); $now = time();
$db->prepare('UPDATE alerts SET active=0,updated_at=? WHERE active=1 AND expires_at<=?')->execute(array($now, $now));
$limit = max(1, min(5, (int) ($config['alerts']['max_checks_per_run'] ?? 2)));
$statement = $db->prepare("SELECT a.*,u.email FROM alerts a JOIN users u ON u.id=a.user_id WHERE a.active=1 AND a.expires_at>? AND a.next_check_at<=? AND u.status='active' ORDER BY a.next_check_at LIMIT ?");
$statement->bindValue(1, $now, PDO::PARAM_INT); $statement->bindValue(2, $now, PDO::PARAM_INT); $statement->bindValue(3, $limit, PDO::PARAM_INT); $statement->execute();
$alerts = $statement->fetchAll(); $processed = 0; $changed = 0; $errors = array();

function vuelotel_internal_post($path, $query, $continue = false) {
    $scheme = !empty($_SERVER['HTTPS']) ? 'https' : 'http';
    $host = $_SERVER['HTTP_HOST'] ?? 'www.alufi.es';
    $base = rtrim(dirname(dirname($_SERVER['SCRIPT_NAME'] ?? '/vuelotel/api/alerts-run.php')), '/');
    $url = $scheme . '://' . $host . $base . '/api/' . $path;
    $curl = curl_init($url);
    curl_setopt_array($curl, array(CURLOPT_POST => true, CURLOPT_POSTFIELDS => json_encode(array('query' => $query, 'continue' => $continue)), CURLOPT_HTTPHEADER => array('Content-Type: application/json'), CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 120));
    $raw = curl_exec($curl); $status = (int) curl_getinfo($curl, CURLINFO_RESPONSE_CODE); curl_close($curl);
    $data = json_decode($raw ?: '', true);
    if ($status >= 400 || !is_array($data)) throw new Exception($data['error'] ?? 'El proveedor no respondió.');
    return $data;
}

function vuelotel_lowest($data, $field) {
    $prices = array();
    foreach (($data['results'] ?? array()) as $item) {
        $value = (float) ($item[$field] ?? 0);
        if ($value > 0) $prices[] = $value;
    }
    return $prices ? min($prices) : null;
}

foreach ($alerts as $alert) {
    try {
        $storedQuery = json_decode($alert['query_json'], true);
        if (!is_array($storedQuery)) throw new Exception('La configuración de la alerta no es válida.');
        $alertMode = $storedQuery['_alertMode'] ?? 'lower';
        $threshold = (float) ($storedQuery['_threshold'] ?? 0);
        $legacyDestination = $alert['type'] === 'destination' && (int) ($storedQuery['_coverageVersion'] ?? 0) < 2;
        $query = $storedQuery;
        unset($query['_alertMode'], $query['_threshold'], $query['_coverageVersion']);
        $price = null;
        if ($alert['type'] === 'flight') {
            $price = vuelotel_lowest(vuelotel_internal_post('flights.php', $query), 'price');
        } elseif ($alert['type'] === 'destination') {
            $destinationResult = vuelotel_internal_post('destination-search.php', $query, true);
            if (empty($destinationResult['coverage']['complete'])) throw new Exception('La comparación de fechas sigue incompleta.');
            $price = vuelotel_lowest($destinationResult, 'flightPrice');
        } elseif ($alert['type'] === 'hotel') {
            $price = vuelotel_lowest(vuelotel_internal_post('search.php?provider=serpapi', $query), 'totalPrice');
        } else {
            $flightPrice = vuelotel_lowest(vuelotel_internal_post('flights.php', $query['flight'] ?? array()), 'price');
            $hotelPrice = vuelotel_lowest(vuelotel_internal_post('search.php?provider=serpapi', $query['hotel'] ?? array()), 'totalPrice');
            if ($flightPrice !== null && $hotelPrice !== null) $price = $flightPrice + $hotelPrice;
        }
        if ($price === null) throw new Exception('No se encontró un precio comparable.');
        // Old destination baselines came from the unsupported deals endpoint; reset only their baseline.
        $old = $legacyDestination || $alert['last_price'] === null ? null : (float) $alert['last_price'];
        $direction = $old === null ? 'initial' : ($price > $old ? 'up' : ($price < $old ? 'down' : 'same'));
        $notify = $old !== null && ($alert['type'] !== 'destination' ? $price !== $old : ($alertMode === 'threshold' ? $price <= $threshold && $old > $threshold : $price < $old));
        if ($notify) {
            $db->prepare('INSERT INTO price_history(alert_id,price,currency,direction,checked_at) VALUES(?,?,?,?,?)')->execute(array($alert['id'], $price, $alert['currency'], $direction, $now));
            $verb = $direction === 'up' ? 'ha subido' : 'ha bajado';
            vuelotel_send_mail($alert['email'], 'El precio ' . $verb . ' · ' . $alert['label'], '<h2>' . htmlspecialchars($alert['label'], ENT_QUOTES, 'UTF-8') . '</h2><p>El precio ' . $verb . ' de <strong>' . number_format($old, 0, ',', '.') . ' €</strong> a <strong>' . number_format($price, 0, ',', '.') . ' €</strong>.</p><p>Tu alerta seguirá activa hasta ' . date('d/m/Y', $alert['expires_at']) . '.</p>');
            $changed++;
        }
        if ($legacyDestination) {
            $storedQuery['_coverageVersion'] = 2;
            $db->prepare('UPDATE alerts SET query_json=? WHERE id=?')->execute(array(json_encode($storedQuery, JSON_UNESCAPED_UNICODE), $alert['id']));
        }
        $db->prepare('UPDATE alerts SET last_price=?,last_checked_at=?,next_check_at=?,updated_at=? WHERE id=?')->execute(array($price, $now, $now + (int) $alert['frequency_hours'] * 3600, $now, $alert['id']));
        $processed++;
    } catch (Exception $error) {
        $db->prepare('UPDATE alerts SET last_checked_at=?,next_check_at=?,updated_at=? WHERE id=?')->execute(array($now, $now + 21600, $now, $alert['id']));
        $errors[] = array('id' => (int) $alert['id'], 'error' => $error->getMessage());
    }
}
vuelotel_json(200, array('processed' => $processed, 'changes' => $changed, 'errors' => $errors));
