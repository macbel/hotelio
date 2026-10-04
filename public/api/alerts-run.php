<?php
require_once __DIR__ . '/user-bootstrap.php';
$config = hotelio_config();
require_once __DIR__ . '/alerts-run-support.php';
require_once __DIR__ . '/alert-policy.php';
$configuredSecret = trim((string) ($config['alerts']['cron_secret'] ?? ''));
$environmentSecret = getenv('VUELOTEL_CRON_SECRET');
$expected = $configuredSecret !== '' ? $configuredSecret : (is_string($environmentSecret) ? trim($environmentSecret) : '');
$provided = (string) ($_SERVER['HTTP_X_VUELOTEL_CRON'] ?? ($_GET['secret'] ?? ''));
if (!vuelotel_alerts_authorized(PHP_SAPI, $expected, $provided)) vuelotel_json(403, array('error' => 'Acceso de cron no autorizado.'));
if (empty($config['alerts']['enabled'])) vuelotel_json(200, array('processed' => 0, 'message' => 'Alertas pausadas.'));

$db = vuelotel_db();
$runnerLock = vuelotel_alerts_lock(vuelotel_data_dir() . DIRECTORY_SEPARATOR . 'alerts-run.lock');
if ($runnerLock === false) vuelotel_json(503, array('error' => 'No se pudo bloquear el procesador de alertas.'));
if ($runnerLock === null) vuelotel_json(200, array('processed' => 0, 'message' => 'Otra ejecución de alertas sigue activa.'));
register_shutdown_function(function () use ($runnerLock) { flock($runnerLock, LOCK_UN); fclose($runnerLock); });
$now = time();
$db->prepare("INSERT INTO app_settings(key,value) VALUES ('alerts_last_run_at',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")->execute(array((string) $now));
$db->prepare('UPDATE alerts SET active=0,updated_at=? WHERE active=1 AND expires_at<=?')->execute(array($now, $now));
$limit = max(1, min(5, (int) ($config['alerts']['max_checks_per_run'] ?? 2)));
$statement = $db->prepare("SELECT a.*,u.email FROM alerts a JOIN users u ON u.id=a.user_id WHERE a.active=1 AND a.expires_at>? AND a.next_check_at<=? AND u.status='active' ORDER BY a.next_check_at LIMIT ?");
$statement->bindValue(1, $now, PDO::PARAM_INT); $statement->bindValue(2, $now, PDO::PARAM_INT); $statement->bindValue(3, $limit, PDO::PARAM_INT); $statement->execute();
$alerts = $statement->fetchAll(); $processed = 0; $changed = 0; $errors = array();

function vuelotel_internal_post($path, $query, $continue = false) {
    $scheme = PHP_SAPI === 'cli' || !empty($_SERVER['HTTPS']) ? 'https' : 'http';
    $host = $_SERVER['HTTP_HOST'] ?? 'www.alufi.es';
    $base = PHP_SAPI === 'cli' ? '/vuelotel' : rtrim(dirname(dirname($_SERVER['SCRIPT_NAME'] ?? '/vuelotel/api/alerts-run.php')), '/');
    $url = $scheme . '://' . $host . $base . '/api/' . $path;
    $curl = curl_init($url);
    curl_setopt_array($curl, array(CURLOPT_POST => true, CURLOPT_POSTFIELDS => json_encode(array('query' => $query, 'continue' => $continue)), CURLOPT_HTTPHEADER => array('Content-Type: application/json'), CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 120));
    $raw = curl_exec($curl); $status = (int) curl_getinfo($curl, CURLINFO_RESPONSE_CODE); curl_close($curl);
    $data = json_decode($raw ?: '', true);
    if ($status >= 400 || !is_array($data)) throw new Exception($data['error'] ?? 'El proveedor no respondió.');
    return $data;
}

function vuelotel_lowest($data, $field, $requireComplete = false) {
    $prices = array();
    foreach (($data['results'] ?? array()) as $item) {
        if ($requireComplete && ($item['priceStatus'] ?? '') !== 'complete') continue;
        $value = (float) ($item[$field] ?? 0);
        if ($value > 0) $prices[] = $value;
    }
    return $prices ? min($prices) : null;
}

function vuelotel_plan_price($destinationResult, $query, $plan) {
    if (!is_array($plan)) throw new Exception('El plan guardado no es válido.');
    $flight = null;
    foreach (($destinationResult['results'] ?? array()) as $item) {
        if (($item['departureDate'] ?? '') === ($plan['departureDate'] ?? '') && ($item['returnDate'] ?? '') === ($plan['returnDate'] ?? '') && ($item['priceStatus'] ?? '') === 'complete' && (float) ($item['flightPrice'] ?? 0) > 0) { $flight = $item; break; }
    }
    if ($flight === null) throw new Exception('La fecha del plan todavía no tiene ida y vuelta comparables.');
    $hotelQuery = array('destination' => (string) ($plan['destinationText'] ?? $query['destination'] ?? ''), 'checkIn' => $plan['departureDate'], 'checkOut' => $plan['returnDate'], 'adults' => (int) ($query['adults'] ?? 1), 'children' => (int) ($query['children'] ?? 0), 'childrenAges' => array_fill(0, max(0, min(8, (int) ($query['children'] ?? 0))), 8), 'guests' => (int) ($query['adults'] ?? 1) + (int) ($query['children'] ?? 0), 'rooms' => 1, 'minPrice' => null, 'maxPrice' => null, 'accommodationType' => 'any', 'board' => 'any', 'currency' => 'EUR', 'nights' => (int) ($query['minNights'] ?? 1));
    $hotelResult = vuelotel_internal_post('search.php?provider=serpapi', $hotelQuery);
    $wanted = mb_strtolower(trim((string) ($plan['hotelName'] ?? '')), 'UTF-8');
    $hotelPrice = null;
    foreach (($hotelResult['results'] ?? array()) as $hotel) {
        if (mb_strtolower(trim((string) ($hotel['name'] ?? '')), 'UTF-8') !== $wanted || ($hotel['currency'] ?? '') !== 'EUR') continue;
        $value = (float) ($hotel['totalPrice'] ?? 0);
        if ($value > 0 && ($hotelPrice === null || $value < $hotelPrice)) $hotelPrice = $value;
    }
    if ($hotelPrice === null) throw new Exception('El mismo hotel no ofrece ahora una tarifa comparable.');
    return (float) $flight['flightPrice'] + $hotelPrice;
}

foreach ($alerts as $alert) {
    try {
        $storedQuery = json_decode($alert['query_json'], true);
        if (!is_array($storedQuery)) throw new Exception('La configuración de la alerta no es válida.');
        if ($alert['type'] === 'destination' && isset($storedQuery['startDate'], $storedQuery['endDate']) && (strtotime($storedQuery['endDate']) - strtotime($storedQuery['startDate'])) > 6 * 86400) {
            vuelotel_alert_failure($db, $alert, $now, 'needs_reconfiguration', 'La ventana anterior supera 7 días. Abre la búsqueda y crea una nueva alerta con una ventana válida.', (int) $alert['expires_at']);
            $errors[] = array('id' => (int) $alert['id'], 'error' => 'La ventana antigua necesita una configuración nueva.');
            continue;
        }
        $alertMode = $storedQuery['_alertMode'] ?? 'lower';
        $threshold = (float) ($storedQuery['_threshold'] ?? 0);
        $alertScope = $storedQuery['_alertScope'] ?? 'flight';
        $plan = $storedQuery['_plan'] ?? null;
        $legacyFlightPrice = in_array($alert['type'], array('destination', 'flight', 'combined'), true) && (int) ($storedQuery['_coverageVersion'] ?? 0) < 3;
        $query = $storedQuery;
        unset($query['_alertMode'], $query['_threshold'], $query['_coverageVersion'], $query['_alertScope'], $query['_plan']);
        $price = null;
        if ($alert['type'] === 'flight') {
            $price = vuelotel_lowest(vuelotel_internal_post('flights.php', $query), 'price', true);
        } elseif ($alert['type'] === 'destination') {
            if (!empty($query['flexible']) && $alertScope === 'plan' && is_array($plan)) {
                // A selected plan keeps its exact dates, so its hotel and flight remain comparable.
                $query['flexible'] = false;
                $query['startDate'] = (string) ($plan['departureDate'] ?? '');
                $query['endDate'] = $query['startDate'];
            }
            $destinationResult = vuelotel_internal_post('destination-search.php', $query, true);
            if ($alertScope === 'plan') $price = vuelotel_plan_price($destinationResult, $query, $plan);
            else {
                if (empty($storedQuery['flexible']) && empty($destinationResult['coverage']['complete'])) throw new Exception('La comparación de fechas sigue incompleta.');
                $price = vuelotel_lowest($destinationResult, 'flightPrice', true);
                if (!empty($storedQuery['flexible']) && $price !== null && $alert['last_price'] !== null) $price = min($price, (float) $alert['last_price']);
            }
        } elseif ($alert['type'] === 'hotel') {
            $price = vuelotel_lowest(vuelotel_internal_post('search.php?provider=serpapi', $query), 'totalPrice');
        } else {
            $flightPrice = vuelotel_lowest(vuelotel_internal_post('flights.php', $query['flight'] ?? array()), 'price', true);
            $hotelPrice = vuelotel_lowest(vuelotel_internal_post('search.php?provider=serpapi', $query['hotel'] ?? array()), 'totalPrice');
            if ($flightPrice !== null && $hotelPrice !== null) $price = $flightPrice + $hotelPrice;
        }
        if ($price === null) throw new Exception('No se encontró un precio comparable.');
        $outcome = vuelotel_apply_alert_price($db, $alert, $price, $now, function($decision) use ($alert) {
            $reference = $decision['notificationReference'];
            $verb = $decision['price'] > $reference ? 'ha subido' : 'ha bajado';
            return vuelotel_send_mail($alert['email'], 'El precio ' . $verb . ' · ' . $alert['label'], '<h2>' . htmlspecialchars($alert['label'], ENT_QUOTES, 'UTF-8') . '</h2><p>El precio ' . $verb . ' de <strong>' . number_format($reference, 0, ',', '.') . ' €</strong> a <strong>' . number_format($decision['price'], 0, ',', '.') . ' €</strong>.</p><p>Tu alerta seguirá activa hasta ' . date('d/m/Y', $alert['expires_at']) . '.</p>');
        }, $legacyFlightPrice);
        if ($outcome['sent']) $changed++;
        if ($outcome['error'] !== null) $errors[] = array('id' => (int) $alert['id'], 'error' => $outcome['error']);
        if ($legacyFlightPrice) {
            $storedQuery['_coverageVersion'] = 3;
            $db->prepare('UPDATE alerts SET query_json=? WHERE id=?')->execute(array(json_encode($storedQuery, JSON_UNESCAPED_UNICODE), $alert['id']));
        }
        $processed++;
    } catch (Throwable $error) {
        vuelotel_alert_failure($db, $alert, $now, 'error', $error->getMessage(), $now + 21600);
        $errors[] = array('id' => (int) $alert['id'], 'error' => vuelotel_alert_error($error->getMessage()));
    }
}
vuelotel_json(200, array('processed' => $processed, 'changes' => $changed, 'errors' => $errors));
