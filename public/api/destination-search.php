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
function destination_reserve($path, $settings, $calls = 1) {
    $handle = fopen($path, 'c+');
    if ($handle === false || !flock($handle, LOCK_EX)) return array('error' => 'No se pudo actualizar el control de consumo.', 'status' => 503);
    $state = json_decode(stream_get_contents($handle) ?: '', true);
    if (!is_array($state)) $state = array();
    $now = time(); $month = gmdate('Y-m', $now); $client = destination_client_key();
    if (($state['month'] ?? '') !== $month) { $state['month'] = $month; $state['monthly_calls'] = 0; }
    $recent = array_values(array_filter((array) ($state['successes'][$client] ?? array()), function($stamp) use ($now) { return is_numeric($stamp) && (int) $stamp > $now - 3600; }));
    $pending = array_filter((array) ($state['pending'][$client] ?? array()), function($stamp) use ($now) { return is_numeric($stamp) && (int) $stamp > $now - 300; });
    $failure = null;
    if (count($recent) + count($pending) + $calls > $settings['per_ip_hourly_limit']) $failure = array('error' => 'Límite temporal de consultas alcanzado. Conservamos las fechas ya comparadas.', 'status' => 429, 'retryAfter' => max(60, $recent ? (int) $recent[0] + 3600 - $now : 300));
    elseif ((int) ($state['monthly_calls'] ?? 0) + $calls > $settings['monthly_limit']) $failure = array('error' => 'Límite mensual de consultas alcanzado. Conservamos las fechas ya comparadas.', 'status' => 429);
    if ($failure === null) {
        $state['monthly_calls'] = (int) ($state['monthly_calls'] ?? 0) + $calls;
        for ($index = 0; $index < $calls; $index++) $recent[] = $now;
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

function destination_option_matches($legs, $query) {
    if (!is_array($legs) || !$legs) return false;
    $stops = max(0, count($legs) - 1);
    if (($query['stops'] ?? 'any') === 'nonstop' && $stops > 0) return false;
    if (($query['stops'] ?? 'any') === 'up_to_one' && $stops > 1) return false;
    if (!empty($query['noEarlyDeparture'])) {
        $time = (string) ($legs[0]['departure_airport']['time'] ?? '');
        // The provider uses local airport time. Unknown time cannot verify this preference.
        if (!preg_match('/(?:^|\s)(\d{2}):(\d{2})(?::\d{2})?$/', $time, $matches) || (int) $matches[1] < 8) return false;
    }
    return true;
}

function destination_fetch($params) {
    $url = 'https://serpapi.com/search.json?' . http_build_query($params, '', '&', PHP_QUERY_RFC3986);
    $curl = curl_init($url);
    curl_setopt_array($curl, array(CURLOPT_RETURNTRANSFER => true, CURLOPT_FOLLOWLOCATION => false, CURLOPT_CONNECTTIMEOUT => 8, CURLOPT_TIMEOUT => 25, CURLOPT_HTTPHEADER => array('Accept: application/json'), CURLOPT_USERAGENT => 'Rumbiva/2.3'));
    $raw = curl_exec($curl); $status = (int) curl_getinfo($curl, CURLINFO_HTTP_CODE); curl_close($curl);
    $data = json_decode($raw ?: '', true);
    if ($status === 429) return array('error' => 'El proveedor ha limitado temporalmente las consultas.', 'status' => 429);
    if ($raw === false || $status < 200 || $status >= 300 || !is_array($data) || !empty($data['error'])) return array('error' => 'El proveedor no pudo comprobar esta fecha.', 'status' => 502);
    return array('data' => $data);
}

function destination_provider($query, $departure, $return, $apiKey) {
    $params = destination_params($query, $departure, $return, $apiKey);
    $initial = destination_fetch($params);
    if (isset($initial['error'])) return $initial;
    $best = destination_best($initial['data'], $query, $departure, $return);
    if ($best === null) return array('result' => null);
    $token = $best['_departureToken']; unset($best['_departureToken']);
    if ($token === '') return array('result' => null);
    $params['departure_token'] = $token;
    $returnResponse = destination_fetch($params);
    if (isset($returnResponse['error'])) return $returnResponse;
    return array('result' => destination_complete($best, $returnResponse['data'], $query, $return));
}

function destination_complete($best, $data, $query, $return) {
    foreach (array('best_flights', 'other_flights') as $group) {
        foreach ((array) ($data[$group] ?? array()) as $option) {
            if (!is_array($option) || !is_numeric($option['price'] ?? null) || (float) $option['price'] <= 0) continue;
            $legs = $option['flights'] ?? array();
            if (!destination_option_matches($legs, $query)) continue;
            $first = reset($legs); $last = end($legs);
            if (($first['departure_airport']['id'] ?? '') !== $query['destination'] || ($last['arrival_airport']['id'] ?? '') !== $query['origin']) continue;
            if (substr((string) ($first['departure_airport']['time'] ?? ''), 0, 10) !== $return) continue;
            $price = (float) $option['price'];
            if (($best['priceStatus'] ?? '') === 'complete' && $best['flightPrice'] <= $price) continue;
            $best['flightPrice'] = $price;
            $best['priceStatus'] = 'complete';
            $best['checkedAt'] = gmdate('c');
            $best['returnAirline'] = (string) ($first['airline'] ?? '');
            $best['returnStops'] = max(0, count($legs) - 1);
            $best['returnDepartureTime'] = (string) ($first['departure_airport']['time'] ?? '');
        }
    }
    return ($best['priceStatus'] ?? '') === 'complete' ? $best : null;
}

function destination_best($data, $query, $departure, $return) {
    $link = destination_safe_link($data['search_metadata']['google_flights_url'] ?? '');
    $best = null;
    foreach (array('best_flights', 'other_flights') as $group) {
        foreach ((array) ($data[$group] ?? array()) as $option) {
            if (!is_array($option) || !isset($option['price']) || !is_numeric($option['price']) || (float) $option['price'] <= 0) continue;
            $flights = $option['flights'] ?? array();
            if (!destination_option_matches($flights, $query)) continue;
            $first = reset($flights); $last = end($flights);
            if (!is_array($first) || !is_array($last)) continue;
            $actualOrigin = strtoupper((string) ($first['departure_airport']['id'] ?? ''));
            $actualDestination = strtoupper((string) ($last['arrival_airport']['id'] ?? ''));
            if ($actualOrigin !== $query['origin'] || $actualDestination !== $query['destination']) continue;
            $price = (float) $option['price'];
            if ($best !== null && $price >= $best['outboundDisplayedPrice']) continue;
            $airlines = array_values(array_unique(array_filter(array_map(function($flight) { return is_array($flight) ? (string) ($flight['airline'] ?? '') : ''; }, $flights))));
            $best = array('destinationCode' => $query['destination'], 'destinationName' => $query['destination'], 'departureDate' => $departure, 'returnDate' => $return, 'flightPrice' => null, 'outboundDisplayedPrice' => $price, 'currency' => 'EUR', 'airline' => implode(', ', $airlines), 'stops' => max(0, count($flights) - 1), 'outboundDepartureTime' => (string) ($first['departure_airport']['time'] ?? ''), 'flightLink' => $link, '_departureToken' => (string) ($option['departure_token'] ?? ''));
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
    $dateCoverage = array(); $checked = 0; $total = count($dates);
    $orderedDates = $dates; sort($orderedDates);
    foreach ($orderedDates as $departure) {
        $stamp = $state['checked'][$departure] ?? null;
        $wasChecked = is_numeric($stamp) && (int) $stamp > 0;
        $result = $state['results'][$departure] ?? null;
        $price = is_array($result) && ($result['priceStatus'] ?? '') === 'complete' && is_numeric($result['flightPrice'] ?? null)
            && is_finite((float) $result['flightPrice']) && (float) $result['flightPrice'] > 0 ? (float) $result['flightPrice'] : null;
        $failure = $state['errors'][$departure] ?? null;
        $returnDate = isset($query['minNights']) ? destination_date($departure)->modify('+' . (int) $query['minNights'] . ' days')->format('Y-m-d') : ($result['returnDate'] ?? null);
        if ($wasChecked) $checked++;
        $dateCoverage[] = array('departureDate' => $departure, 'returnDate' => $returnDate,
            'status' => $wasChecked ? ($price !== null ? 'priced' : 'no_price') : (is_array($failure) ? 'error' : 'pending'),
            'checked' => $wasChecked, 'checkedAt' => $wasChecked ? gmdate('c', (int) $stamp) : (is_array($failure) ? gmdate('c', (int) $failure['checkedAt']) : null),
            'hasComparablePrice' => $wasChecked && $price !== null, 'flightPrice' => $wasChecked ? $price : null);
    }
    $payload = array('results' => array_slice($results, 0, 20), 'query' => $query, 'coverage' => array('checked' => $checked, 'total' => $total,
        'remaining' => max(0, $total - $checked), 'complete' => $checked === $total, 'dates' => $dateCoverage,
        'rangeStart' => $query['startDate'] ?? ($orderedDates[0] ?? null), 'rangeEnd' => $query['endDate'] ?? ($orderedDates ? end($orderedDates) : null)), 'cached' => $cached, 'notice' => $notice);
    if ($retryAfter !== null) $payload['retryAfter'] = $retryAfter;
    return $payload;
}

function destination_flexible_window($period, $today) {
    $last = $today->modify('+6 months')->modify('-1 day');
    if ($period === '3m') return array($today, $today->modify('+3 months')->modify('-1 day'), 0);
    if ($period === '6m') return array($today, $last, 0);
    if (preg_match('/^\d{4}-(0[1-9]|1[0-2])$/', $period)) {
        $start = destination_date($period . '-01');
        if ($start && $start <= $last && $start->modify('last day of this month') >= $today) {
            return array($start < $today ? $today : $start, $start->modify('last day of this month') > $last ? $last : $start->modify('last day of this month'), (int) $start->format('n'));
        }
    }
    return null;
}

function destination_flexible_dates($start, $end, $nights) {
    $last = $end->modify('-' . $nights . ' days');
    if ($last < $start) return array();
    $dates = array();
    // Two well-separated samples per calendar month; this is sampling, not exhaustive coverage.
    for ($month = $start->modify('first day of this month'); $month <= $last; $month = $month->modify('first day of next month')) {
        foreach (array(8, 22) as $day) {
            $candidate = $month->modify('+' . ($day - 1) . ' days');
            if ($candidate >= $start && $candidate <= $last) $dates[] = $candidate->format('Y-m-d');
        }
    }
    if (!$dates) $dates[] = $start->format('Y-m-d');
    $spread = array(); $queue = array(array(0, count($dates) - 1));
    while ($queue) {
        list($left, $right) = array_shift($queue);
        if ($left > $right) continue;
        $middle = intdiv($left + $right, 2);
        $spread[] = $dates[$middle];
        $queue[] = array($left, $middle - 1); $queue[] = array($middle + 1, $right);
    }
    return $spread;
}

function destination_explore_params($query, $month, $apiKey) {
    $duration = $query['minNights'] <= 4 ? 1 : ($query['minNights'] <= 9 ? 2 : 3);
    $params = array('engine' => 'google_travel_explore', 'departure_id' => $query['origin'], 'arrival_id' => $query['destination'], 'month' => $month, 'travel_duration' => $duration, 'type' => 1, 'travel_mode' => 1, 'adults' => $query['adults'], 'children' => $query['children'], 'infants_in_seat' => $query['infants'], 'currency' => 'EUR', 'hl' => 'es', 'gl' => 'es', 'api_key' => $apiKey);
    if ($query['carryOnBags'] > 0) $params['bags'] = $query['carryOnBags'];
    if ($query['stops'] === 'nonstop') $params['stops'] = 1;
    if ($query['stops'] === 'up_to_one') $params['stops'] = 2;
    return $params;
}

function destination_explore_candidate($data, $query, $start, $end) {
    $outbound = destination_date($data['start_date'] ?? null);
    $return = destination_date($data['end_date'] ?? null);
    if (!$outbound || !$return || $outbound < $start || $return > $end || $outbound->diff($return)->days !== $query['minNights']) return null;
    foreach ((array) ($data['flights'] ?? array()) as $flight) {
        if (($flight['departure_airport']['id'] ?? '') !== $query['origin'] || ($flight['arrival_airport']['id'] ?? '') !== $query['destination']) continue;
        if ($query['stops'] === 'nonstop' && (int) ($flight['number_of_stops'] ?? 99) > 0) continue;
        if ($query['stops'] === 'up_to_one' && (int) ($flight['number_of_stops'] ?? 99) > 1) continue;
        return $outbound->format('Y-m-d');
    }
    return null;
}

function destination_flexible_payload($query, $state, $dates, $start, $end, $notice, $cached, $retryAfter = null) {
    $payload = destination_payload($query, $state, $dates, $notice, $cached, $retryAfter);
    $payload['coverage']['sampled'] = true;
    $payload['coverage']['horizonDays'] = $start->diff($end)->days + 1;
    $payload['coverage']['discovery'] = (string) ($state['discoveryStatus'] ?? 'pending');
    $payload['coverage']['rangeStart'] = $start->format('Y-m-d');
    $payload['coverage']['rangeEnd'] = $end->format('Y-m-d');
    $payload['coverage']['checkedAt'] = !empty($state['updatedAt']) ? gmdate('c', (int) $state['updatedAt']) : null;
    return $payload;
}

if (defined('DESTINATION_SEARCH_LIBRARY_ONLY')) return;

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') destination_out(405, array('error' => 'Método no permitido.'));
$raw = file_get_contents('php://input');
if ($raw === false || strlen($raw) > 20000) destination_out(400, array('error' => 'Petición no válida.'));
$body = json_decode($raw, true); $input = $body['query'] ?? null;
if (!is_array($input)) destination_out(400, array('error' => 'Faltan los datos del seguimiento.'));
$query = array('origin' => strtoupper(trim((string) ($input['origin'] ?? ''))), 'destination' => strtoupper(trim((string) ($input['destination'] ?? ''))), 'startDate' => (string) ($input['startDate'] ?? ''), 'endDate' => (string) ($input['endDate'] ?? ''), 'flexible' => !empty($input['flexible']), 'flexiblePeriod' => (string) ($input['flexiblePeriod'] ?? '6m'), 'minNights' => (int) ($input['minNights'] ?? 7), 'adults' => (int) ($input['adults'] ?? 1), 'children' => (int) ($input['children'] ?? 0), 'infants' => (int) ($input['infants'] ?? 0), 'carryOnBags' => (int) ($input['carryOnBags'] ?? 0), 'checkedBags' => (int) ($input['checkedBags'] ?? 0), 'stops' => (string) ($input['stops'] ?? 'any'), 'noEarlyDeparture' => !empty($input['noEarlyDeparture']));
$start = destination_date($query['startDate']); $end = destination_date($query['endDate']); $today = new DateTimeImmutable('today', new DateTimeZone('UTC'));
if (!preg_match('/^[A-Z]{3}$/', $query['origin']) || !preg_match('/^[A-Z]{3}$/', $query['destination']) || $query['origin'] === $query['destination']) destination_out(400, array('error' => 'El origen y el destino deben ser códigos IATA de tres letras y distintos.'));
if (!$query['flexible'] && (!$start || !$end || $end < $start || $start < $today || $end > $today->modify('+365 days') || $end->diff($start)->days > 6 || $end->modify('+' . $query['minNights'] . ' days') > $today->modify('+365 days'))) destination_out(400, array('error' => 'Elige una ventana de salida de hasta 7 días dentro del próximo año.'));
if ($query['flexible'] && !destination_flexible_window($query['flexiblePeriod'], $today)) destination_out(400, array('error' => 'El periodo flexible debe estar dentro de los próximos seis meses.'));
if ($query['minNights'] < 1 || $query['minNights'] > 30) destination_out(400, array('error' => 'La estancia debe ser de entre 1 y 30 noches.'));
if ($query['adults'] < 1 || $query['children'] < 0 || $query['infants'] < 0 || array_sum(array($query['adults'], $query['children'], $query['infants'])) > 9 || $query['infants'] > $query['adults']) destination_out(400, array('error' => 'El número de pasajeros no es válido.'));
if ($query['carryOnBags'] < 0 || $query['checkedBags'] < 0 || $query['carryOnBags'] + $query['checkedBags'] > array_sum(array($query['adults'], $query['children'], $query['infants']))) destination_out(400, array('error' => 'Las maletas no pueden superar el número de pasajeros.'));
if (!in_array($query['stops'], array('any', 'nonstop', 'up_to_one'), true)) destination_out(400, array('error' => 'El filtro de escalas no es válido.'));
$config = hotelio_config(); $apiKey = trim((string) ($config['providers']['serpapi']['api_key'] ?? ''));
if ($apiKey === '') destination_out(503, array('error' => 'El seguimiento de destinos todavía no está configurado.'));
$settings = array('per_ip_hourly_limit' => max(1, min(30, (int) ($config['flights']['per_ip_hourly_limit'] ?? 8))), 'monthly_limit' => max(1, min(120, (int) ($config['flights']['monthly_limit'] ?? 120))));
$ttl = max(300, min(86400, (int) ($config['flights']['cache_ttl'] ?? 3600)));
$storage = dirname(hotelio_config_path()) . DIRECTORY_SEPARATOR . '.hotelio-flight-data' . DIRECTORY_SEPARATOR . 'destinations';
if (!is_dir($storage) && !mkdir($storage, 0700, true) && !is_dir($storage)) destination_out(503, array('error' => 'No se pudo preparar la caché.'));
if ($query['flexible']) {
    list($windowStart, $windowEnd, $month) = destination_flexible_window($query['flexiblePeriod'], $today);
    $dates = destination_flexible_dates($windowStart, $windowEnd, $query['minNights']);
    $cache = $storage . DIRECTORY_SEPARATOR . 'flex-v1-' . hash('sha256', json_encode($query, JSON_UNESCAPED_SLASHES)) . '.json';
    $handle = fopen($cache, 'c+');
    if ($handle === false || !flock($handle, LOCK_EX)) destination_out(503, array('error' => 'No se pudo coordinar la comparación de fechas.'));
    $state = json_decode(stream_get_contents($handle) ?: '', true);
    // Keep the sample cursor for a month so infrequent alerts can progress through
    // different dates. Every quote carries its own checkedAt and is displayed as a snapshot.
    if (!is_array($state) || (int) ($state['startedAt'] ?? 0) < time() - 30 * 86400) $state = array('checked' => array(), 'results' => array(), 'startedAt' => time(), 'discoveryStatus' => 'pending');
    $failure = null; $performed = false;
    if (($state['discoveryStatus'] ?? 'pending') === 'pending') {
        $failure = destination_reserve(dirname($storage) . DIRECTORY_SEPARATOR . 'usage.json', $settings, 1);
        if ($failure === null) {
            $explore = destination_fetch(destination_explore_params($query, $month, $apiKey));
            if (isset($explore['error'])) $failure = $explore;
            else {
                $candidate = destination_explore_candidate($explore['data'], $query, $windowStart, $windowEnd);
                $state['discoveryStatus'] = $candidate ? 'candidate' : 'sampled';
                if ($candidate !== null) array_unshift($dates, $candidate);
                $performed = true;
            }
        }
    } else {
        $candidate = $state['candidateDate'] ?? null;
        if (is_string($candidate) && !in_array($candidate, $dates, true)) array_unshift($dates, $candidate);
    }
    if (isset($candidate) && $candidate !== null) $state['candidateDate'] = $candidate;
    $dates = array_values(array_unique($dates));
    if (!empty($state['checked']) && empty($body['continue']) && $failure === null) {
        $payload = destination_flexible_payload($query, $state, $dates, $windowStart, $windowEnd, 'Resultados recientes. Pulsa «Comprobar otra fecha» para ampliar la muestra.', true);
        flock($handle, LOCK_UN); fclose($handle); destination_out(200, $payload);
    }
    // The first search compares two dates spread over the period; continuation adds one.
    $pending = array_values(array_filter($dates, function($date) use ($state) { return !array_key_exists($date, $state['checked']); }));
    foreach (array_slice($pending, 0, empty($body['continue']) ? 2 : 1) as $departure) {
        if ($failure !== null) break;
        $failure = destination_reserve(dirname($storage) . DIRECTORY_SEPARATOR . 'usage.json', $settings, 2);
        if ($failure === null) {
            $return = destination_date($departure)->modify('+' . $query['minNights'] . ' days')->format('Y-m-d');
            $response = destination_provider($query, $departure, $return, $apiKey);
            if (isset($response['error'])) {
                $failure = $response;
                $state['errors'][$departure] = array('checkedAt' => time());
                $performed = true;
            }
            else {
                $state['checked'][$departure] = time();
                unset($state['errors'][$departure]);
                if ($response['result'] !== null) $state['results'][$departure] = $response['result'];
                $performed = true;
            }
        }
    }
    if ($performed) {
        $state['updatedAt'] = time();
        rewind($handle); ftruncate($handle, 0);
        fwrite($handle, json_encode($state, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)); fflush($handle);
    }
    $notice = $failure ? $failure['error'] : 'Más barato encontrado entre las fechas comprobadas. Se prueban fechas repartidas por el periodo; los demás días pueden ofrecer otro precio.';
    $payload = destination_flexible_payload($query, $state, $dates, $windowStart, $windowEnd, $notice, !$performed, $failure['retryAfter'] ?? null);
    flock($handle, LOCK_UN); fclose($handle);
    if ($failure && empty($state['checked'])) destination_out($failure['status'], array('error' => $failure['error'], 'retryAfter' => $failure['retryAfter'] ?? null, 'coverage' => $payload['coverage']));
    destination_out(200, $payload);
}
$dates = destination_dates($start, $end);
$cache = $storage . DIRECTORY_SEPARATOR . 'v3-' . hash('sha256', json_encode($query, JSON_UNESCAPED_SLASHES)) . '.json';
$handle = fopen($cache, 'c+');
if ($handle === false || !flock($handle, LOCK_EX)) destination_out(503, array('error' => 'No se pudo coordinar la comparación de fechas.'));
$state = json_decode(stream_get_contents($handle) ?: '', true);
if (!is_array($state) || !isset($state['checked']) || !is_array($state['checked'])) $state = array('checked' => array(), 'results' => array(), 'startedAt' => time());
// Partial and complete comparisons are snapshots; never mix prices from different cache windows.
if ((int) ($state['startedAt'] ?? 0) < time() - $ttl) $state = array('checked' => array(), 'results' => array(), 'startedAt' => time());
$continue = !empty($body['continue']);
if ($state['checked'] && !$continue) {
    $payload = destination_payload($query, $state, $dates, 'Comparación guardada. Puedes comparar más fechas sin perder las ya verificadas.', true);
    flock($handle, LOCK_UN); fclose($handle); destination_out(200, $payload);
}
$pending = array_values(array_filter($dates, function($date) use ($state) { return !array_key_exists($date, $state['checked']); }));
$failure = null; $performed = 0; $errorsChanged = false;
$batchSize = !empty($input['compareDestinations']) ? 1 : 2;
foreach (array_slice($pending, 0, $batchSize) as $departure) {
    $failure = destination_reserve(dirname($storage) . DIRECTORY_SEPARATOR . 'usage.json', $settings, 2);
    if ($failure !== null) break;
    $return = destination_date($departure)->modify('+' . $query['minNights'] . ' days')->format('Y-m-d');
    $response = destination_provider($query, $departure, $return, $apiKey);
    if (isset($response['error'])) { $failure = $response; $state['errors'][$departure] = array('checkedAt' => time()); $errorsChanged = true; break; }
    $state['checked'][$departure] = time(); $performed++;
    unset($state['errors'][$departure]);
    if ($response['result'] !== null) $state['results'][$departure] = $response['result'];
}
if (count($state['checked']) === count($dates)) $state['completedAt'] = time();
if ($performed || $errorsChanged) {
    rewind($handle); ftruncate($handle, 0);
    fwrite($handle, json_encode($state, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)); fflush($handle);
}
$checked = count($state['checked']); $total = count($dates);
$notice = $failure ? $failure['error'] : ($checked === $total ? 'Ventana completa. Se han elegido salidas y vueltas para las fechas comprobadas; confirma disponibilidad y costes pendientes al comprar.' : 'Comparación parcial. Puedes revisar más fechas hasta completar la ventana.');
$payload = destination_payload($query, $state, $dates, $notice, !$performed, $failure['retryAfter'] ?? null);
flock($handle, LOCK_UN); fclose($handle);
if ($failure && !$checked) destination_out($failure['status'], array('error' => $failure['error'], 'retryAfter' => $failure['retryAfter'] ?? null, 'coverage' => $payload['coverage']));
destination_out(200, $payload);
