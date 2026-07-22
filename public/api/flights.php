<?php

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');

$origin = isset($_SERVER['HTTP_ORIGIN']) ? (string) $_SERVER['HTTP_ORIGIN'] : '';
$nativeOrigins = array('http://localhost', 'https://localhost', 'capacitor://localhost', 'http://localhost:4173', 'http://127.0.0.1:4173');
if (in_array($origin, $nativeOrigins, true)) {
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Access-Control-Allow-Methods: POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type');
    header('Vary: Origin');
}
if (isset($_SERVER['REQUEST_METHOD']) && $_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

require_once __DIR__ . '/bootstrap.php';

class HotelioFlightException extends Exception {
    public $status;
    public $details;

    public function __construct($message, $status, $details = array()) {
        parent::__construct($message);
        $this->status = (int) $status;
        $this->details = is_array($details) ? $details : array();
    }
}

function hotelio_flights_respond($status, $body) {
    http_response_code((int) $status);
    echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function hotelio_flights_private_config() {
    $path = hotelio_config_path();
    if (!is_file($path)) return array();
    $stored = include $path;
    return is_array($stored) ? $stored : array();
}

function hotelio_flights_integer_setting($settings, $key, $environment, $default, $minimum, $maximum) {
    $value = isset($settings[$key]) ? $settings[$key] : null;
    $fromEnvironment = getenv($environment);
    if (is_string($fromEnvironment) && trim($fromEnvironment) !== '') $value = $fromEnvironment;
    if (!is_numeric($value)) $value = $default;
    return max($minimum, min($maximum, (int) $value));
}

function hotelio_flights_settings($config) {
    $private = hotelio_flights_private_config();
    $settings = isset($config['flights']) && is_array($config['flights']) ? $config['flights'] : array();
    $privateSettings = isset($private['flights']) && is_array($private['flights']) ? $private['flights'] : array();
    $storage = isset($privateSettings['storage_path']) ? trim((string) $privateSettings['storage_path']) : '';
    $environmentStorage = getenv('HOTELIO_FLIGHTS_STORAGE_PATH');
    if (is_string($environmentStorage) && trim($environmentStorage) !== '') $storage = trim($environmentStorage);
    if ($storage === '') $storage = dirname(hotelio_config_path()) . DIRECTORY_SEPARATOR . '.hotelio-flight-data';
    return array(
        'storage_path' => $storage,
        'cache_ttl_seconds' => hotelio_flights_integer_setting($settings, 'cache_ttl', 'HOTELIO_FLIGHTS_CACHE_TTL', 3600, 300, 86400),
        'ip_hourly_limit' => hotelio_flights_integer_setting($settings, 'per_ip_hourly_limit', 'HOTELIO_FLIGHTS_IP_HOURLY_LIMIT', 8, 1, 30),
        'monthly_limit' => hotelio_flights_integer_setting($settings, 'monthly_limit', 'HOTELIO_FLIGHTS_MONTHLY_LIMIT', 120, 1, 10000)
    );
}

function hotelio_flights_prepare_storage($directory) {
    if (!is_dir($directory) && !mkdir($directory, 0700, true) && !is_dir($directory)) {
        throw new HotelioFlightException('No se pudo preparar la caché privada de vuelos.', 503);
    }
    @chmod($directory, 0700);
    $denyFile = $directory . DIRECTORY_SEPARATOR . '.htaccess';
    if (!is_file($denyFile)) @file_put_contents($denyFile, "Require all denied\nDeny from all\n", LOCK_EX);
    $indexFile = $directory . DIRECTORY_SEPARATOR . 'index.html';
    if (!is_file($indexFile)) @file_put_contents($indexFile, '', LOCK_EX);
    if (!is_writable($directory)) throw new HotelioFlightException('La caché privada de vuelos no permite escritura.', 503);
}

function hotelio_flights_client_hash() {
    $address = '';
    $trustCloudflare = in_array(strtolower(trim((string) getenv('HOTELIO_TRUST_CLOUDFLARE_IP'))), array('1', 'true', 'yes'), true);
    if ($trustCloudflare && !empty($_SERVER['HTTP_CF_CONNECTING_IP']) && filter_var($_SERVER['HTTP_CF_CONNECTING_IP'], FILTER_VALIDATE_IP)) {
        $address = (string) $_SERVER['HTTP_CF_CONNECTING_IP'];
    } elseif (!empty($_SERVER['REMOTE_ADDR']) && filter_var($_SERVER['REMOTE_ADDR'], FILTER_VALIDATE_IP)) {
        $address = (string) $_SERVER['REMOTE_ADDR'];
    }
    if ($address === '') $address = 'unknown';
    $salt = hash('sha256', hotelio_config_path());
    return hash_hmac('sha256', $address, $salt);
}

function hotelio_flights_read_state($handle) {
    rewind($handle);
    $raw = stream_get_contents($handle);
    $state = $raw !== false && $raw !== '' ? json_decode($raw, true) : array();
    if (!is_array($state)) $state = array();
    if (!isset($state['month']) || !is_string($state['month'])) $state['month'] = gmdate('Y-m');
    if (!isset($state['monthly_calls']) || !is_numeric($state['monthly_calls'])) $state['monthly_calls'] = 0;
    if (!isset($state['successes']) || !is_array($state['successes'])) $state['successes'] = array();
    if (!isset($state['pending']) || !is_array($state['pending'])) $state['pending'] = array();
    return $state;
}

function hotelio_flights_prune_state($state, $now) {
    $month = gmdate('Y-m', $now);
    if ($state['month'] !== $month) {
        $state['month'] = $month;
        $state['monthly_calls'] = 0;
    }
    foreach ($state['successes'] as $client => $timestamps) {
        if (!is_array($timestamps)) {
            unset($state['successes'][$client]);
            continue;
        }
        $timestamps = array_values(array_filter($timestamps, function($timestamp) use ($now) {
            return is_numeric($timestamp) && (int) $timestamp > $now - 3600;
        }));
        if ($timestamps) $state['successes'][$client] = $timestamps;
        else unset($state['successes'][$client]);
    }
    foreach ($state['pending'] as $client => $reservations) {
        if (!is_array($reservations)) {
            unset($state['pending'][$client]);
            continue;
        }
        foreach ($reservations as $token => $timestamp) {
            if (!is_numeric($timestamp) || (int) $timestamp <= $now - 300) unset($reservations[$token]);
        }
        if ($reservations) $state['pending'][$client] = $reservations;
        else unset($state['pending'][$client]);
    }
    return $state;
}

function hotelio_flights_write_state($handle, $state) {
    $encoded = json_encode($state, JSON_UNESCAPED_SLASHES);
    if ($encoded === false) throw new HotelioFlightException('No se pudo actualizar el control de consumo.', 503);
    rewind($handle);
    if (!ftruncate($handle, 0) || fwrite($handle, $encoded) === false) {
        throw new HotelioFlightException('No se pudo actualizar el control de consumo.', 503);
    }
    fflush($handle);
}

function hotelio_flights_mutate_state($settings, $callback) {
    $path = $settings['storage_path'] . DIRECTORY_SEPARATOR . 'usage.json';
    $handle = fopen($path, 'c+');
    if ($handle === false) throw new HotelioFlightException('No se pudo abrir el control de consumo.', 503);
    if (!flock($handle, LOCK_EX)) {
        fclose($handle);
        throw new HotelioFlightException('No se pudo bloquear el control de consumo.', 503);
    }
    try {
        $now = time();
        $state = hotelio_flights_prune_state(hotelio_flights_read_state($handle), $now);
        $result = call_user_func_array($callback, array(&$state, $now));
        hotelio_flights_write_state($handle, $state);
        flock($handle, LOCK_UN);
        fclose($handle);
        return $result;
    } catch (Exception $error) {
        flock($handle, LOCK_UN);
        fclose($handle);
        throw $error;
    }
}

function hotelio_flights_reserve_client_slot($settings, $client) {
    return hotelio_flights_mutate_state($settings, function(&$state, $now) use ($settings, $client) {
        $successes = isset($state['successes'][$client]) ? count($state['successes'][$client]) : 0;
        $pending = isset($state['pending'][$client]) ? count($state['pending'][$client]) : 0;
        if ($successes + $pending >= $settings['ip_hourly_limit']) {
            $waits = array();
            if ($successes > 0) $waits[] = (int) min($state['successes'][$client]) + 3600 - $now;
            if ($pending > 0) $waits[] = (int) min($state['pending'][$client]) + 300 - $now;
            $retry = max(60, min(3600, $waits ? min($waits) : 3600));
            throw new HotelioFlightException('Has alcanzado el límite temporal de búsquedas de vuelos. Inténtalo más tarde.', 429, array('retryAfter' => $retry));
        }
        $token = bin2hex(random_bytes(16));
        if (!isset($state['pending'][$client])) $state['pending'][$client] = array();
        $state['pending'][$client][$token] = $now;
        return $token;
    });
}

function hotelio_flights_finish_client_slot($settings, $client, $token, $successful) {
    try {
        return hotelio_flights_mutate_state($settings, function(&$state, $now) use ($settings, $client, $token, $successful) {
            if (isset($state['pending'][$client][$token])) unset($state['pending'][$client][$token]);
            if (isset($state['pending'][$client]) && !$state['pending'][$client]) unset($state['pending'][$client]);
            if ($successful) {
                if (!isset($state['successes'][$client])) $state['successes'][$client] = array();
                $state['successes'][$client][] = $now;
            }
            $used = isset($state['successes'][$client]) ? count($state['successes'][$client]) : 0;
            return array(
                'hourlyRemaining' => max(0, $settings['ip_hourly_limit'] - $used),
                'monthlyRemaining' => max(0, $settings['monthly_limit'] - (int) $state['monthly_calls'])
            );
        });
    } catch (Exception $ignored) {
        return null;
    }
}

function hotelio_flights_reserve_provider_call($settings) {
    return hotelio_flights_mutate_state($settings, function(&$state) use ($settings) {
        if ((int) $state['monthly_calls'] >= $settings['monthly_limit']) {
            throw new HotelioFlightException('Se ha alcanzado el límite mensual de consultas de vuelos. Las búsquedas ya almacenadas siguen disponibles.', 429);
        }
        $state['monthly_calls'] = (int) $state['monthly_calls'] + 1;
        return max(0, $settings['monthly_limit'] - (int) $state['monthly_calls']);
    });
}

function hotelio_flights_date($value, $name) {
    if (!is_string($value) || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $value)) {
        throw new HotelioFlightException($name . ' no es válida.', 400);
    }
    $date = DateTime::createFromFormat('!Y-m-d', $value, new DateTimeZone('UTC'));
    if (!$date || $date->format('Y-m-d') !== $value) throw new HotelioFlightException($name . ' no es válida.', 400);
    return $date;
}

function hotelio_flights_optional_integer($query, $key, $minimum, $maximum, $default) {
    if (!array_key_exists($key, $query) || $query[$key] === '' || $query[$key] === null) return $default;
    if (filter_var($query[$key], FILTER_VALIDATE_INT) === false) throw new HotelioFlightException('El campo ' . $key . ' no es válido.', 400);
    $value = (int) $query[$key];
    if ($value < $minimum || $value > $maximum) throw new HotelioFlightException('El campo ' . $key . ' está fuera del intervalo permitido.', 400);
    return $value;
}

function hotelio_flights_normalize_query($query) {
    if (!is_array($query)) throw new HotelioFlightException('Falta la búsqueda de vuelos.', 400);
    $tripType = isset($query['tripType']) ? strtolower(trim((string) $query['tripType'])) : 'roundtrip';
    if (!in_array($tripType, array('roundtrip', 'oneway'), true)) throw new HotelioFlightException('El tipo de viaje no es válido.', 400);
    $origin = isset($query['origin']) ? strtoupper(trim((string) $query['origin'])) : '';
    $destination = isset($query['destination']) ? strtoupper(trim((string) $query['destination'])) : '';
    if (!preg_match('/^[A-Z]{3}$/', $origin)) throw new HotelioFlightException('El origen debe ser un código IATA de tres letras.', 400);
    if (!preg_match('/^[A-Z]{3}$/', $destination)) throw new HotelioFlightException('El destino debe ser un código IATA de tres letras.', 400);
    if ($origin === $destination) throw new HotelioFlightException('El origen y el destino deben ser distintos.', 400);

    $departure = hotelio_flights_date(isset($query['departureDate']) ? $query['departureDate'] : '', 'La fecha de ida');
    $today = new DateTime('today', new DateTimeZone('UTC'));
    if ($departure < $today) throw new HotelioFlightException('La fecha de ida no puede estar en el pasado.', 400);
    if ($departure > (clone $today)->modify('+365 days')) throw new HotelioFlightException('La fecha de ida debe estar dentro de los próximos 365 días.', 400);
    $returnDate = null;
    if ($tripType === 'roundtrip') {
        $returnDate = hotelio_flights_date(isset($query['returnDate']) ? $query['returnDate'] : '', 'La fecha de vuelta');
        if ($returnDate <= $departure) throw new HotelioFlightException('La fecha de vuelta debe ser posterior a la ida.', 400);
        if ($returnDate > (clone $today)->modify('+365 days')) throw new HotelioFlightException('La fecha de vuelta debe estar dentro de los próximos 365 días.', 400);
    }

    $adults = hotelio_flights_optional_integer($query, 'adults', 1, 9, 1);
    $children = hotelio_flights_optional_integer($query, 'children', 0, 8, 0);
    $infants = hotelio_flights_optional_integer($query, 'infants', 0, 8, 0);
    if ($infants > $adults) throw new HotelioFlightException('Debe viajar al menos un adulto por cada bebé.', 400);
    if ($adults + $children + $infants > 9) throw new HotelioFlightException('La búsqueda admite un máximo de 9 pasajeros.', 400);

    $travelClass = isset($query['travelClass']) ? strtolower(trim((string) $query['travelClass'])) : 'economy';
    if (!in_array($travelClass, array('economy', 'premium_economy', 'business', 'first'), true)) throw new HotelioFlightException('La clase no es válida.', 400);
    $stops = isset($query['stops']) ? strtolower(trim((string) $query['stops'])) : 'any';
    if (!in_array($stops, array('any', 'nonstop', 'up_to_one'), true)) throw new HotelioFlightException('El filtro de escalas no es válido.', 400);
    $carryOnBags = hotelio_flights_optional_integer($query, 'carryOnBags', 0, 9, 0);
    if ($carryOnBags > $adults + $children + $infants) throw new HotelioFlightException('Las maletas de mano no pueden superar el número de pasajeros con asiento.', 400);
    $maxPrice = hotelio_flights_optional_integer($query, 'maxPrice', 1, 100000, null);

    return array(
        'tripType' => $tripType,
        'origin' => $origin,
        'destination' => $destination,
        'departureDate' => $departure->format('Y-m-d'),
        'returnDate' => $returnDate ? $returnDate->format('Y-m-d') : null,
        'adults' => $adults,
        'children' => $children,
        'infants' => $infants,
        'travelClass' => $travelClass,
        'stops' => $stops,
        'carryOnBags' => $carryOnBags,
        'maxPrice' => $maxPrice,
        'currency' => 'EUR'
    );
}

function hotelio_flights_cache_read($path, $ttl) {
    if (!is_file($path) || filemtime($path) < time() - $ttl) return null;
    $raw = file_get_contents($path);
    $cached = $raw !== false ? json_decode($raw, true) : null;
    return is_array($cached) && isset($cached['results']) && isset($cached['searchUrl']) ? $cached : null;
}

function hotelio_flights_cache_write($path, $payload) {
    $encoded = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($encoded === false) return;
    $temporary = $path . '.' . bin2hex(random_bytes(6)) . '.tmp';
    if (file_put_contents($temporary, $encoded, LOCK_EX) === false) return;
    @chmod($temporary, 0600);
    if (!@rename($temporary, $path)) @unlink($temporary);
    @chmod($path, 0600);
}

function hotelio_flights_google_url($value) {
    if (!is_string($value) || trim($value) === '') return '';
    $parts = parse_url(trim($value));
    if (!is_array($parts) || ($parts['scheme'] ?? '') !== 'https' || empty($parts['host']) || empty($parts['path'])) return '';
    $host = strtolower((string) $parts['host']);
    if ($host !== 'www.google.com' && $host !== 'google.com') return '';
    if (strpos((string) $parts['path'], '/travel/flights') !== 0) return '';
    return trim($value);
}

function hotelio_flights_provider_request($query, $apiKey) {
    $classMap = array('economy' => 1, 'premium_economy' => 2, 'business' => 3, 'first' => 4);
    $stopsMap = array('nonstop' => 1, 'up_to_one' => 2);
    $params = array(
        'engine' => 'google_flights',
        'departure_id' => $query['origin'],
        'arrival_id' => $query['destination'],
        'outbound_date' => $query['departureDate'],
        'type' => $query['tripType'] === 'roundtrip' ? 1 : 2,
        'travel_class' => $classMap[$query['travelClass']],
        'adults' => $query['adults'],
        'children' => $query['children'],
        'infants_in_seat' => $query['infants'],
        'currency' => 'EUR',
        'hl' => 'es',
        'gl' => 'es',
        'api_key' => $apiKey
    );
    if ($query['returnDate'] !== null) $params['return_date'] = $query['returnDate'];
    if (isset($stopsMap[$query['stops']])) $params['stops'] = $stopsMap[$query['stops']];
    if ($query['carryOnBags'] > 0) $params['bags'] = $query['carryOnBags'];
    if ($query['maxPrice'] !== null) $params['max_price'] = $query['maxPrice'];

    $url = 'https://serpapi.com/search.json?' . http_build_query($params, '', '&', PHP_QUERY_RFC3986);
    $curl = curl_init($url);
    curl_setopt_array($curl, array(
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_CONNECTTIMEOUT => 12,
        CURLOPT_TIMEOUT => 35,
        CURLOPT_HTTPHEADER => array('Accept: application/json'),
        CURLOPT_USERAGENT => 'Hotelio-Flights/1.0'
    ));
    $raw = curl_exec($curl);
    $status = (int) curl_getinfo($curl, CURLINFO_HTTP_CODE);
    curl_close($curl);
    if ($raw === false) throw new HotelioFlightException('No se pudo contactar con el buscador de vuelos.', 502);
    $data = json_decode($raw, true);
    if (!is_array($data)) throw new HotelioFlightException('El buscador de vuelos devolvió una respuesta no válida.', 502);
    if ($status < 200 || $status >= 300 || !empty($data['error'])) {
        throw new HotelioFlightException('El buscador de vuelos no pudo completar la consulta.', $status === 429 ? 429 : 502);
    }
    return $data;
}

function hotelio_flights_normalize_results($data) {
    $results = array();
    $groups = array('best_flights' => 'Mejor opción', 'other_flights' => 'Otras opciones');
    foreach ($groups as $key => $label) {
        $options = isset($data[$key]) && is_array($data[$key]) ? $data[$key] : array();
        foreach ($options as $option) {
            if (!is_array($option)) continue;
            $segments = array();
            foreach (($option['flights'] ?? array()) as $flight) {
                if (!is_array($flight)) continue;
                $segments[] = array(
                    'departure' => array(
                        'airport' => (string) ($flight['departure_airport']['id'] ?? ''),
                        'name' => (string) ($flight['departure_airport']['name'] ?? ''),
                        'time' => (string) ($flight['departure_airport']['time'] ?? '')
                    ),
                    'arrival' => array(
                        'airport' => (string) ($flight['arrival_airport']['id'] ?? ''),
                        'name' => (string) ($flight['arrival_airport']['name'] ?? ''),
                        'time' => (string) ($flight['arrival_airport']['time'] ?? '')
                    ),
                    'airline' => (string) ($flight['airline'] ?? ''),
                    'flightNumber' => (string) ($flight['flight_number'] ?? ''),
                    'durationMinutes' => max(0, (int) ($flight['duration'] ?? 0))
                );
            }
            if (!$segments) continue;
            $first = $segments[0];
            $last = $segments[count($segments) - 1];
            $airlines = array_values(array_unique(array_filter(array_map(function($segment) {
                return $segment['airline'];
            }, $segments))));
            $price = isset($option['price']) && is_numeric($option['price']) ? (float) $option['price'] : null;
            $identifier = hash('sha256', json_encode(array($first, $last, $price, count($results))));
            $results[] = array(
                'id' => substr($identifier, 0, 20),
                'group' => $label,
                'price' => $price,
                'currency' => 'EUR',
                'durationMinutes' => max(0, (int) ($option['total_duration'] ?? 0)),
                'stops' => max(0, count($segments) - 1),
                'airlines' => $airlines,
                'airlineLogo' => isset($option['airline_logo']) ? (string) $option['airline_logo'] : '',
                'departure' => $first['departure'],
                'arrival' => $last['arrival'],
                'segments' => $segments,
                'provider' => 'Google Flights vía SerpApi'
            );
            if (count($results) >= 20) break 2;
        }
    }
    return $results;
}

$requestMethod = isset($_SERVER['REQUEST_METHOD']) ? $_SERVER['REQUEST_METHOD'] : '';
if ($requestMethod !== 'POST') hotelio_flights_respond(405, array('error' => 'Método no permitido.'));
$raw = file_get_contents('php://input');
if ($raw === false || strlen($raw) > 20000) hotelio_flights_respond(400, array('error' => 'Petición no válida.'));
$body = json_decode($raw, true);
if (!is_array($body) || !isset($body['query'])) hotelio_flights_respond(400, array('error' => 'Falta la búsqueda de vuelos.'));

$settings = null;
$client = '';
$slot = '';
$slotFinished = false;
$keyLock = null;
try {
    $query = hotelio_flights_normalize_query($body['query']);
    $config = hotelio_config();
    if (empty($config['flights']['enabled'])) throw new HotelioFlightException('La búsqueda de vuelos está desactivada.', 503);
    $apiKey = trim((string) ($config['providers']['serpapi']['api_key'] ?? ''));
    if ($apiKey === '') throw new HotelioFlightException('La búsqueda de vuelos todavía no está configurada.', 503);

    $settings = hotelio_flights_settings($config);
    hotelio_flights_prepare_storage($settings['storage_path']);
    $client = hotelio_flights_client_hash();
    $slot = hotelio_flights_reserve_client_slot($settings, $client);

    $cacheKey = hash('sha256', json_encode($query, JSON_UNESCAPED_SLASHES));
    $cachePath = $settings['storage_path'] . DIRECTORY_SEPARATOR . 'cache-' . $cacheKey . '.json';
    $cached = hotelio_flights_cache_read($cachePath, $settings['cache_ttl_seconds']);
    if ($cached !== null) {
        $limits = hotelio_flights_finish_client_slot($settings, $client, $slot, true);
        $slotFinished = true;
        $cached['cached'] = true;
        $cached['limits'] = $limits;
        hotelio_flights_respond(200, $cached);
    }

    $lockPath = $settings['storage_path'] . DIRECTORY_SEPARATOR . 'cache-' . $cacheKey . '.lock';
    $keyLock = fopen($lockPath, 'c');
    if ($keyLock === false || !flock($keyLock, LOCK_EX)) throw new HotelioFlightException('No se pudo coordinar la consulta de vuelos.', 503);
    $cached = hotelio_flights_cache_read($cachePath, $settings['cache_ttl_seconds']);
    if ($cached !== null) {
        flock($keyLock, LOCK_UN);
        fclose($keyLock);
        $keyLock = null;
        $limits = hotelio_flights_finish_client_slot($settings, $client, $slot, true);
        $slotFinished = true;
        $cached['cached'] = true;
        $cached['limits'] = $limits;
        hotelio_flights_respond(200, $cached);
    }

    hotelio_flights_reserve_provider_call($settings);
    $data = hotelio_flights_provider_request($query, $apiKey);
    $searchUrl = hotelio_flights_google_url($data['search_metadata']['google_flights_url'] ?? '');
    if ($searchUrl === '') throw new HotelioFlightException('Google Flights no devolvió un enlace seguro para continuar.', 502);
    $payload = array(
        'results' => hotelio_flights_normalize_results($data),
        'searchUrl' => $searchUrl,
        'query' => $query,
        'cached' => false,
        'cacheTtlSeconds' => $settings['cache_ttl_seconds'],
        'notice' => 'Los precios son orientativos y pueden cambiar. Confirma siempre el precio final y las condiciones en Google Flights o en la página de compra. Hotelio no gestiona pagos ni reservas.'
    );
    hotelio_flights_cache_write($cachePath, $payload);
    flock($keyLock, LOCK_UN);
    fclose($keyLock);
    $keyLock = null;
    $payload['limits'] = hotelio_flights_finish_client_slot($settings, $client, $slot, true);
    $slotFinished = true;
    hotelio_flights_respond(200, $payload);
} catch (HotelioFlightException $error) {
    if (is_resource($keyLock)) {
        flock($keyLock, LOCK_UN);
        fclose($keyLock);
    }
    if (!$slotFinished && $settings !== null && $client !== '' && $slot !== '') {
        hotelio_flights_finish_client_slot($settings, $client, $slot, false);
    }
    hotelio_flights_respond($error->status, array_merge(array('error' => $error->getMessage()), $error->details));
} catch (Exception $error) {
    if (is_resource($keyLock)) {
        flock($keyLock, LOCK_UN);
        fclose($keyLock);
    }
    if (!$slotFinished && $settings !== null && $client !== '' && $slot !== '') {
        hotelio_flights_finish_client_slot($settings, $client, $slot, false);
    }
    hotelio_flights_respond(500, array('error' => 'No se pudo completar la búsqueda de vuelos.'));
}
