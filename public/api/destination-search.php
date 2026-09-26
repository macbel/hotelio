<?php
require_once __DIR__ . '/bootstrap.php';
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

$requestOrigin = (string) ($_SERVER['HTTP_ORIGIN'] ?? '');
if (preg_match('#^https?://(?:localhost|127\.0\.0\.1)(?::\d+)?$#', $requestOrigin) || $requestOrigin === 'capacitor://localhost') {
    header('Access-Control-Allow-Origin: ' . $requestOrigin);
    header('Access-Control-Allow-Methods: POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type');
    header('Vary: Origin');
}
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') { http_response_code(204); exit; }

function destination_out($status, $body) {
    http_response_code($status);
    echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function destination_date($value) {
    if (!is_string($value) || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $value)) return null;
    $date = DateTimeImmutable::createFromFormat('!Y-m-d', $value, new DateTimeZone('UTC'));
    return $date && $date->format('Y-m-d') === $value ? $date : null;
}

function destination_client_key() {
    $trustCloudflare = in_array(strtolower(trim((string) getenv('HOTELIO_TRUST_CLOUDFLARE_IP'))), array('1', 'true', 'yes'), true);
    $ip = $trustCloudflare && filter_var($_SERVER['HTTP_CF_CONNECTING_IP'] ?? '', FILTER_VALIDATE_IP) ? (string) $_SERVER['HTTP_CF_CONNECTING_IP'] : (string) ($_SERVER['REMOTE_ADDR'] ?? 'unknown');
    if (!filter_var($ip, FILTER_VALIDATE_IP)) $ip = 'unknown';
    return hash_hmac('sha256', $ip, hash('sha256', hotelio_config_path()));
}

/** One reservation represents one actual SerpApi request, including provider failures. */
function destination_reserve($path, $settings) {
    $handle = fopen($path, 'c+');
    if ($handle === false || !flock($handle, LOCK_EX)) return array('error' => 'No se pudo actualizar el control de consumo.', 'status' => 503);
    $state = json_decode(stream_get_contents($handle) ?: '', true);
    if (!is_array($state)) $state = array();
    $now = time(); $month = gmdate('Y-m', $now); $client = destination_client_key();
    if (($state['month'] ?? '') !== $month) { $state['month'] = $month; $state['monthly_calls'] = 0; }
    $recent = array_values(array_filter((array) ($state['successes'][$client] ?? array()), function($stamp) use ($now) { return is_numeric($stamp) && (int) $stamp > $now - 3600; }));
    $pending = array_filter((array) ($state['pending'][$client] ?? array()), function($stamp) use ($now) { return is_numeric($stamp) && (int) $stamp > $now - 300; });
    $failure = null;
    if (count($recent) + count($pending) >= $settings['per_ip_hourly_limit']) $failure = array('error' => 'Límite temporal de consultas alcanzado. Conservamos las fechas ya comparadas.', 'status' => 429, 'retryAfter' => max(60, $recent ? (int) $recent[0] + 3600 - $now : 300));
    elseif ((int) ($state['monthly_calls'] ?? 0) >= $settings['monthly_limit']) $failure = array('error' => 'Límite mensual de consultas alcanzado. Conservamos las fechas ya comparadas.', 'status' => 429);
    if ($failure === null) {
        $state['monthly_calls'] = (int) ($state['monthly_calls'] ?? 0) + 1;
        $recent[] = $now;
        $state['successes'][$client] = $recent;
        rewind($handle); ftruncate($handle, 0);
        fwrite($handle, json_encode($state, JSON_UNESCAPED_SLASHES)); fflush($handle);
    }
    flock($handle, LOCK_UN); fclose($handle);
    return $failure;
}

function destination_safe_link($value) {
    if (!is_string($value) || $value === '') return '';
    $parts = parse_url($value);
    return is_array($parts) && ($parts['scheme'] ?? '') === 'https' && in_array(strtolower((string) ($parts['host'] ?? '')), array('google.com', 'www.google.com'), true) && strpos((string) ($parts['path'] ?? ''), '/travel/flights') === 0 ? $value : '';
}

function destination_params($query, $departure, $return, $apiKey) {
    $params = array('engine' => 'google_flights', 'departure_id' => $query['origin'], 'arrival_id' => $query['destination'], 'outbound_date' => $departure, 'return_date' => $return, 'type' => 1, 'travel_class' => 1, 'adults' => $query['adults'], 'children' => $query['children'], 'infants_in_seat' => $query['infants'], 'currency' => 'EUR', 'hl' => 'es', 'gl' => 'es', 'api_key' => $apiKey);
    if ($query['carryOnBags'] > 0) $params['bags'] = $query['carryOnBags'];
    return $params;
}

function destination_provider($query, $departure, $return, $apiKey) {
    $params = destination_params($query, $departure, $return, $apiKey);
    $url = 'https://serpapi.com/search.json?' . http_build_query($params, '', '&', PHP_QUERY_RFC3986);
    $curl = curl_init($url);
    curl_setopt_array($curl, array(CURLOPT_RETURNTRANSFER => true, CURLOPT_FOLLOWLOCATION => false, CURLOPT_CONNECTTIMEOUT => 8, CURLOPT_TIMEOUT => 25, CURLOPT_HTTPHEADER => array('Accept: application/json'), CURLOPT_USERAGENT => 'Rumbiva/2.2'));
    $raw = curl_exec($curl); $status = (int) curl_getinfo($curl, CURLINFO_HTTP_CODE); curl_close($curl);
    $data = json_decode($raw ?: '', true);
    if ($status === 429) return array('error' => 'El proveedor ha limitado temporalmente las consultas.', 'status' => 429);
    if ($raw === false || $status < 200 || $status >= 300 || !is_array($data) || !empty($data['error'])) return array('error' => 'El proveedor no pudo comprobar esta fecha.', 'status' => 502);
    return array('result' => destination_best($data, $query, $departure, $return));
}

function destination_best($data, $query, $departure, $return) {
    $link = destination_safe_link($data['search_metadata']['google_flights_url'] ?? '');
    $best = null;
    foreach (array('best_flights', 'other_flights') as $group) {
        foreach ((array) ($data[$group] ?? array()) as $option) {
            if (!is_array($option) || !isset($option['price']) || !is_numeric($option['price']) || (float) $option['price'] <= 0) continue;
            $flights = $option['flights'] ?? array();
            if (!is_array($flights) || !$flights) continue;
            $first = reset($flights); $last = end($flights);
            if (!is_array($first) || !is_array($last)) continue;
            $actualOrigin = strtoupper((string) ($first['departure_airport']['id'] ?? ''));
            $actualDestination = strtoupper((string) ($last['arrival_airport']['id'] ?? ''));
            if ($actualOrigin !== $query['origin'] || $actualDestination !== $query['destination']) continue;
            $price = (float) $option['price'];
            if ($best !== null && $price >= $best['flightPrice']) continue;
            $airlines = array_values(array_unique(array_filter(array_map(function($flight) { return is_array($flight) ? (string) ($flight['airline'] ?? '') : ''; }, $flights))));
            $best = array('destinationCode' => $query['destination'], 'destinationName' => $query['destination'], 'departureDate' => $departure, 'returnDate' => $return, 'flightPrice' => $price, 'currency' => 'EUR', 'airline' => implode(', ', $airlines), 'stops' => max(0, count($flights) - 1), 'flightLink' => $link);
        }
    }
    return $best;
}

function destination_dates($start, $end) {
    $dates = array();
    for ($day = $start; $day <= $end; $day = $day->modify('+1 day')) $dates[] = $day->format('Y-m-d');
    // Spread the first batch across the window, then fill the gaps deterministically.
    $ordered = array(); $queue = array(array(0, count($dates) - 1));
    while ($queue) {
        list($left, $right) = array_shift($queue);
        if ($left > $right) continue;
        $middle = intdiv($left + $right, 2);
        $ordered[] = $dates[$middle];
        $queue[] = array($left, $middle - 1); $queue[] = array($middle + 1, $right);
    }
    return $ordered;
}

function destination_payload($query, $state, $dates, $notice, $cached, $retryAfter = null) {
    $results = array_values(array_filter((array) ($state['results'] ?? array()), 'is_array'));
    usort($results, function($a, $b) { return ($a['flightPrice'] <=> $b['flightPrice']) ?: strcmp($a['departureDate'], $b['departureDate']); });
    $checked = count((array) ($state['checked'] ?? array())); $total = count($dates);
    $payload = array('results' => array_slice($results, 0, 20), 'query' => $query, 'coverage' => array('checked' => $checked, 'total' => $total, 'remaining' => max(0, $total - $checked), 'complete' => $checked === $total), 'cached' => $cached, 'notice' => $notice);
    if ($retryAfter !== null) $payload['retryAfter'] = $retryAfter;
    return $payload;
}

if (defined('DESTINATION_SEARCH_LIBRARY_ONLY')) return;

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') destination_out(405, array('error' => 'Método no permitido.'));
$raw = file_get_contents('php://input');
if ($raw === false || strlen($raw) > 20000) destination_out(400, array('error' => 'Petición no válida.'));
$body = json_decode($raw, true); $input = $body['query'] ?? null;
if (!is_array($input)) destination_out(400, array('error' => 'Faltan los datos del seguimiento.'));
$query = array('origin' => strtoupper(trim((string) ($input['origin'] ?? ''))), 'destination' => strtoupper(trim((string) ($input['destination'] ?? ''))), 'startDate' => (string) ($input['startDate'] ?? ''), 'endDate' => (string) ($input['endDate'] ?? ''), 'minNights' => (int) ($input['minNights'] ?? 7), 'adults' => (int) ($input['adults'] ?? 1), 'children' => (int) ($input['children'] ?? 0), 'infants' => (int) ($input['infants'] ?? 0), 'carryOnBags' => (int) ($input['carryOnBags'] ?? 0), 'checkedBags' => (int) ($input['checkedBags'] ?? 0));
$start = destination_date($query['startDate']); $end = destination_date($query['endDate']); $today = new DateTimeImmutable('today', new DateTimeZone('UTC'));
if (!preg_match('/^[A-Z]{3}$/', $query['origin']) || !preg_match('/^[A-Z]{3}$/', $query['destination']) || $query['origin'] === $query['destination']) destination_out(400, array('error' => 'El origen y el destino deben ser códigos IATA de tres letras y distintos.'));
if (!$start || !$end || $end < $start || $start < $today || $end > $today->modify('+365 days')) destination_out(400, array('error' => 'La ventana de salida no es válida.'));
if ($query['minNights'] < 1 || $query['minNights'] > 30) destination_out(400, array('error' => 'La estancia debe ser de entre 1 y 30 noches.'));
if ($query['adults'] < 1 || $query['children'] < 0 || $query['infants'] < 0 || array_sum(array($query['adults'], $query['children'], $query['infants'])) > 9 || $query['infants'] > $query['adults']) destination_out(400, array('error' => 'El número de pasajeros no es válido.'));
if ($query['carryOnBags'] < 0 || $query['checkedBags'] < 0 || $query['carryOnBags'] + $query['checkedBags'] > array_sum(array($query['adults'], $query['children'], $query['infants']))) destination_out(400, array('error' => 'Las maletas no pueden superar el número de pasajeros.'));
$config = hotelio_config(); $apiKey = trim((string) ($config['providers']['serpapi']['api_key'] ?? ''));
if ($apiKey === '') destination_out(503, array('error' => 'El seguimiento de destinos todavía no está configurado.'));
$settings = array('per_ip_hourly_limit' => max(1, min(30, (int) ($config['flights']['per_ip_hourly_limit'] ?? 8))), 'monthly_limit' => max(1, min(240, (int) ($config['flights']['monthly_limit'] ?? 120))));
$ttl = max(300, min(86400, (int) ($config['flights']['cache_ttl'] ?? 3600)));
$storage = dirname(hotelio_config_path()) . DIRECTORY_SEPARATOR . '.hotelio-flight-data' . DIRECTORY_SEPARATOR . 'destinations';
if (!is_dir($storage) && !mkdir($storage, 0700, true) && !is_dir($storage)) destination_out(503, array('error' => 'No se pudo preparar la caché.'));
$dates = destination_dates($start, $end);
$cache = $storage . DIRECTORY_SEPARATOR . hash('sha256', json_encode($query, JSON_UNESCAPED_SLASHES)) . '.json';
$handle = fopen($cache, 'c+');
if ($handle === false || !flock($handle, LOCK_EX)) destination_out(503, array('error' => 'No se pudo coordinar la comparación de fechas.'));
$state = json_decode(stream_get_contents($handle) ?: '', true);
if (!is_array($state) || !isset($state['checked']) || !is_array($state['checked'])) $state = array('checked' => array(), 'results' => array(), 'startedAt' => time());
// A completed comparison is a snapshot. Once stale, a new comparison starts without mixing old and new prices.
if (count($state['checked']) === count($dates) && (int) ($state['completedAt'] ?? 0) < time() - $ttl) $state = array('checked' => array(), 'results' => array(), 'startedAt' => time());
$continue = !empty($body['continue']);
if ($state['checked'] && !$continue) {
    $payload = destination_payload($query, $state, $dates, 'Comparación guardada. Puedes comparar más fechas sin perder las ya verificadas.', true);
    flock($handle, LOCK_UN); fclose($handle); destination_out(200, $payload);
}
$pending = array_values(array_filter($dates, function($date) use ($state) { return !array_key_exists($date, $state['checked']); }));
$failure = null; $performed = 0;
foreach (array_slice($pending, 0, 4) as $departure) {
    $failure = destination_reserve(dirname($storage) . DIRECTORY_SEPARATOR . 'usage.json', $settings);
    if ($failure !== null) break;
    $return = destination_date($departure)->modify('+' . $query['minNights'] . ' days')->format('Y-m-d');
    $response = destination_provider($query, $departure, $return, $apiKey);
    if (isset($response['error'])) { $failure = $response; break; }
    $state['checked'][$departure] = time(); $performed++;
    if ($response['result'] !== null) $state['results'][$departure] = $response['result'];
}
if (count($state['checked']) === count($dates)) $state['completedAt'] = time();
if ($performed) {
    rewind($handle); ftruncate($handle, 0);
    fwrite($handle, json_encode($state, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)); fflush($handle);
}
$checked = count($state['checked']); $total = count($dates);
$notice = $failure ? $failure['error'] : ($checked === $total ? 'Ventana completa. Precios orientativos para el destino indicado; confirma precio final y equipaje al comprar.' : 'Comparación parcial. Puedes revisar más fechas hasta completar la ventana.');
$payload = destination_payload($query, $state, $dates, $notice, !$performed, $failure['retryAfter'] ?? null);
flock($handle, LOCK_UN); fclose($handle);
if ($failure && !$checked) destination_out($failure['status'], array('error' => $failure['error'], 'retryAfter' => $failure['retryAfter'] ?? null, 'coverage' => $payload['coverage']));
destination_out(200, $payload);
