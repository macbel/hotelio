<?php
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
$origin = isset($_SERVER['HTTP_ORIGIN']) ? (string) $_SERVER['HTTP_ORIGIN'] : '';
$nativeOrigins = array('http://localhost', 'https://localhost', 'capacitor://localhost');
if (in_array($origin, $nativeOrigins, true)) {
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Access-Control-Allow-Methods: POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type');
    header('Vary: Origin');
}
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

require_once __DIR__ . '/bootstrap.php';

function respond($status, $body) {
    http_response_code($status);
    echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function get_json($url, $headers = array()) {
    $curl = curl_init($url);
    curl_setopt_array($curl, array(
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_CONNECTTIMEOUT => 12,
        CURLOPT_TIMEOUT => 30,
        CURLOPT_HTTPHEADER => array_merge(array('Accept: application/json'), $headers),
        CURLOPT_USERAGENT => 'Hotelio/1.1'
    ));
    $raw = curl_exec($curl);
    $status = (int) curl_getinfo($curl, CURLINFO_HTTP_CODE);
    $error = curl_error($curl);
    curl_close($curl);
    if ($raw === false) throw new Exception($error ?: 'No se pudo contactar con el proveedor');
    $data = json_decode($raw, true);
    if (!is_array($data)) throw new Exception('El proveedor devolvió una respuesta no válida');
    if ($status < 200 || $status >= 300) throw new Exception(isset($data['message']) ? $data['message'] : (isset($data['error']) && is_string($data['error']) ? $data['error'] : 'HTTP ' . $status));
    return $data;
}

function nights_between($checkin, $checkout) {
    try {
        $start = new DateTime($checkin);
        $end = new DateTime($checkout);
        return max(1, (int) $start->diff($end)->days);
    } catch (Exception $error) {
        return 1;
    }
}

function optional_price($query, $key) {
    if (!array_key_exists($key, $query) || $query[$key] === null || $query[$key] === '') return null;
    return max(0, (float) $query[$key]);
}

function price_matches($nightly, $minimum, $maximum) {
    return ($minimum === null || $nightly >= $minimum) && ($maximum === null || $nightly <= $maximum);
}

function accommodation_matches($hotel, $wanted) {
    if ($wanted === '' || $wanted === 'any') return true;
    $text = strtolower((string) ($hotel['type'] ?? '') . ' ' . (string) ($hotel['name'] ?? ''));
    $patterns = array(
        'hotel' => '/hotel/',
        'apartment' => '/apartment|apartamento|aparthotel|vacation rental/',
        'hostel' => '/hostel|hostal|albergue/',
        'resort' => '/resort/',
        'bed_and_breakfast' => '/bed.{0,5}breakfast|b&b|guesthouse|casa rural|inn/'
    );
    return isset($patterns[$wanted]) ? (bool) preg_match($patterns[$wanted], $text) : true;
}

function stay22_attributed_url($url, $aid) {
    if ($url === '') return '';
    $parts = parse_url($url);
    if (!is_array($parts) || empty($parts['host']) || !preg_match('/(^|\.)stay22\.com$/i', $parts['host'])) return $url;
    $query = array();
    if (!empty($parts['query'])) parse_str($parts['query'], $query);
    $query['aid'] = $aid;
    $query['campaign'] = 'hotelio_search';
    $rebuilt = (isset($parts['scheme']) ? $parts['scheme'] . '://' : '') . (isset($parts['user']) ? $parts['user'] . (isset($parts['pass']) ? ':' . $parts['pass'] : '') . '@' : '') . $parts['host'] . (isset($parts['port']) ? ':' . $parts['port'] : '') . (isset($parts['path']) ? $parts['path'] : '');
    $rebuilt .= '?' . http_build_query($query, '', '&', PHP_QUERY_RFC3986);
    if (isset($parts['fragment'])) $rebuilt .= '#' . $parts['fragment'];
    return $rebuilt;
}

function serpapi_search_text($destination, $board) {
    $prefixes = array(
        'room_only' => 'hoteles solo alojamiento en ',
        'breakfast' => 'hoteles con desayuno incluido en ',
        'half_board' => 'hoteles con media pensión en ',
        'full_board' => 'hoteles con pensión completa en ',
        'all_inclusive' => 'hoteles todo incluido en '
    );
    return ($prefixes[$board] ?? 'hoteles en ') . $destination;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') respond(405, array('error' => 'Método no permitido'));
$raw = file_get_contents('php://input');
if ($raw === false || strlen($raw) > 100000) respond(400, array('error' => 'Petición no válida'));
$body = json_decode($raw, true);
if (!is_array($body) || !isset($body['query']) || !is_array($body['query'])) respond(400, array('error' => 'Falta la búsqueda'));

$config = hotelio_config();
$provider = isset($_GET['provider']) ? strtolower((string) $_GET['provider']) : '';
if (!isset($config['providers'][$provider]) || empty($config['providers'][$provider]['enabled'])) respond(503, array('error' => 'Proveedor no disponible'));
$providerConfig = $config['providers'][$provider];
$query = $body['query'];
$destination = isset($query['destination']) ? trim((string) $query['destination']) : '';
$checkin = isset($query['checkIn']) ? (string) $query['checkIn'] : '';
$checkout = isset($query['checkOut']) ? (string) $query['checkOut'] : '';
$adults = max(1, min(9, (int) ($query['adults'] ?? 2)));
$children = max(0, min(9, (int) ($query['children'] ?? 0)));
$rooms = max(1, min(8, (int) ($query['rooms'] ?? 1)));
$nights = isset($query['nights']) ? max(1, (int) $query['nights']) : nights_between($checkin, $checkout);
$minimum = optional_price($query, 'minPrice');
$maximum = optional_price($query, 'maxPrice');
$accommodationType = (string) ($query['accommodationType'] ?? 'any');
$board = (string) ($query['board'] ?? 'any');
if ($destination === '' || $checkin === '' || $checkout === '') respond(400, array('error' => 'Destino y fechas son obligatorios'));
if ($minimum !== null && $maximum !== null && $minimum > $maximum) respond(400, array('error' => 'El precio mínimo no puede superar al máximo'));

try {
    if ($provider === 'stay22') {
        if ($board !== 'any') respond(200, array('results' => array(), 'notice' => 'Stay22 no permite filtrar el régimen con fiabilidad.'));
        $params = array('address' => $destination, 'checkin' => $checkin, 'checkout' => $checkout, 'adults' => $adults, 'children' => $children, 'rooms' => $rooms, 'currency' => 'EUR', 'pageSize' => 50);
        $data = get_json('https://api.stay22.com/v2/accommodations?' . http_build_query($params, '', '&', PHP_QUERY_RFC3986));
        $supplierNames = array('booking' => 'Booking.com', 'expedia' => 'Expedia', 'hotelscom' => 'Hotels.com', 'vrbo' => 'Vrbo');
        $results = array();
        $stayNights = max(1, (int) ($data['meta']['nights'] ?? $nights));
        foreach (($data['results'] ?? array()) as $index => $hotel) {
            if (!accommodation_matches($hotel, $accommodationType)) continue;
            $offers = array();
            foreach (($hotel['suppliers'] ?? array()) as $supplier => $offer) {
                $total = (float) ($offer['price']['total'] ?? 0);
                if ($total > 0) $offers[] = array('supplier' => $supplier, 'offer' => $offer, 'total' => $total);
            }
            usort($offers, function($a, $b) { return $a['total'] <=> $b['total']; });
            if (!$offers) continue;
            $best = $offers[0];
            $nightly = $best['total'] / $stayNights;
            if (!price_matches($nightly, $minimum, $maximum)) continue;
            $features = array();
            if (!empty($hotel['type'])) $features[] = $hotel['type'];
            if (!empty($hotel['policies']['freeCancellation'])) $features[] = 'Cancelación gratis';
            if (!empty($hotel['rating']['hotelStars'])) $features[] = $hotel['rating']['hotelStars'] . ' estrellas';
            $results[] = array(
                'id' => 'stay22-' . ($hotel['id'] ?? $index),
                'name' => $hotel['name'] ?? 'Alojamiento',
                'location' => $hotel['location']['address'] ?? $destination,
                'nightlyPrice' => $nightly,
                'totalPrice' => $best['total'],
                'currency' => $data['meta']['currency'] ?? 'EUR',
                'rating' => $hotel['rating']['value'] ?? null,
                'features' => $features,
                'image' => $hotel['media']['thumbnail'] ?? null,
                'accommodationType' => $hotel['type'] ?? null,
                'url' => stay22_attributed_url($best['offer']['link'] ?? ($hotel['url'] ?? ''), (string) ($providerConfig['aid'] ?? 'hotelio')),
                'provider' => 'Stay22 · ' . ($supplierNames[$best['supplier']] ?? $best['supplier']),
                'persistable' => false
            );
        }
        respond(200, array('results' => $results));
    }

    if ($provider === 'serpapi') {
        $token = trim((string) ($providerConfig['api_key'] ?? ''));
        if ($token === '') respond(503, array('error' => 'SerpApi no está configurado'));
        $params = array(
            'engine' => 'google_hotels', 'q' => serpapi_search_text($destination, $board),
            'check_in_date' => $checkin, 'check_out_date' => $checkout,
            'adults' => $adults, 'children' => $children, 'currency' => 'EUR',
            'hl' => 'es', 'gl' => 'es', 'sort_by' => 3, 'api_key' => $token
        );
        if ($minimum !== null) $params['min_price'] = $minimum;
        if ($maximum !== null) $params['max_price'] = $maximum;
        $propertyTypes = array('apartment' => '1,21', 'hostel' => '14', 'resort' => '17', 'bed_and_breakfast' => '19');
        if ($accommodationType === 'apartment') $params['vacation_rentals'] = 'true';
        if (isset($propertyTypes[$accommodationType])) $params['property_types'] = $propertyTypes[$accommodationType];
        $ages = array_map(function($age) { return max(1, (int) $age); }, $query['childrenAges'] ?? array());
        if ($ages) $params['children_ages'] = implode(',', $ages);
        $data = get_json('https://serpapi.com/search.json?' . http_build_query($params, '', '&', PHP_QUERY_RFC3986));
        if (!empty($data['error'])) throw new Exception(is_string($data['error']) ? $data['error'] : 'Error de SerpApi');
        $results = array();
        foreach (($data['properties'] ?? array()) as $index => $hotel) {
            if ($accommodationType === 'hotel' && !accommodation_matches($hotel, 'hotel')) continue;
            $nightly = (float) ($hotel['rate_per_night']['extracted_lowest'] ?? ($hotel['price_per_night']['extracted_price'] ?? ($hotel['extracted_price'] ?? 0)));
            if ($nightly <= 0 || !price_matches($nightly, $minimum, $maximum)) continue;
            $total = (float) ($hotel['total_rate']['extracted_lowest'] ?? ($hotel['total_price']['extracted_price'] ?? ($nightly * $nights)));
            $image = $hotel['images'][0]['thumbnail'] ?? ($hotel['thumbnail'] ?? null);
            $results[] = array(
                'id' => $hotel['property_token'] ?? ('serpapi-' . $index),
                'name' => $hotel['name'] ?? 'Alojamiento',
                'location' => $hotel['address'] ?? ($hotel['city'] ?? $destination),
                'nightlyPrice' => $nightly,
                'totalPrice' => $total,
                'currency' => 'EUR',
                'rating' => $hotel['overall_rating'] ?? ($hotel['rating'] ?? null),
                'features' => array_slice($hotel['amenities'] ?? array(), 0, 3),
                'image' => $image,
                'accommodationType' => $hotel['type'] ?? null,
                'url' => $hotel['link'] ?? ('https://www.google.com/travel/hotels?q=' . rawurlencode($hotel['name'] ?? $destination)),
                'provider' => 'SerpApi · Google Hotels'
            );
        }
        respond(200, array('results' => $results));
    }

    respond(400, array('error' => 'Proveedor no compatible'));
} catch (Exception $error) {
    respond(502, array('error' => $error->getMessage()));
}
