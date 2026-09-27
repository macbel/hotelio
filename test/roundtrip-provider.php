<?php
define('HOTELIO_FLIGHTS_LIBRARY_ONLY', true);
define('DESTINATION_SEARCH_LIBRARY_ONLY', true);
require __DIR__ . '/../public/api/flights.php';
require __DIR__ . '/../public/api/destination-search.php';

function check_provider($condition, $message) {
    if (!$condition) throw new RuntimeException($message);
}

$query = array('origin' => 'MAD', 'destination' => 'FCO', 'departureDate' => '2026-10-14', 'returnDate' => '2026-10-18');
$outbound = array('best_flights' => array(array('price' => 125, 'departure_token' => 'fixture-token', 'flights' => array(array('departure_airport' => array('id' => 'MAD', 'time' => '2026-10-14 08:00'), 'arrival_airport' => array('id' => 'FCO', 'time' => '2026-10-14 10:00'), 'airline' => 'Iberia')))));
$returns = array('best_flights' => array(array('price' => 360, 'flights' => array(array('departure_airport' => array('id' => 'FCO', 'time' => '2026-10-18 17:00'), 'arrival_airport' => array('id' => 'MAD', 'time' => '2026-10-18 19:00'), 'airline' => 'Iberia')))));
$outboundOption = hotelio_flights_normalize_results($outbound, true)[0];
check_provider($outboundOption['priceStatus'] === 'outbound_only', 'La salida no debe parecer una ida y vuelta completa.');
$complete = hotelio_flights_complete_roundtrip($outboundOption, $returns, $query);
check_provider($complete['priceStatus'] === 'complete' && $complete['price'] === 360.0, 'La segunda respuesta debe fijar el precio completo, sin sumar 125 + 360.');
check_provider($complete['returnLeg']['departure']['airport'] === 'FCO', 'Debe conservar el trayecto de vuelta.');
$wrongDate = $returns; $wrongDate['best_flights'][0]['flights'][0]['departure_airport']['time'] = '2026-10-19 17:00';
check_provider(hotelio_flights_complete_roundtrip($outboundOption, $wrongDate, $query)['priceStatus'] === 'outbound_only', 'Una vuelta en otra fecha no es comparable.');
$best = destination_best($outbound, $query, $query['departureDate'], $query['returnDate']);
check_provider($best['_departureToken'] === 'fixture-token' && $best['flightPrice'] === null, 'La primera respuesta no debe publicar el precio como completo.');
unset($best['_departureToken']);
check_provider(destination_complete($best, $returns, $query, $query['returnDate'])['flightPrice'] === 360.0, 'El radar debe usar el precio de ida y vuelta.');
check_provider(destination_complete($best, $wrongDate, $query, $query['returnDate']) === null, 'El radar debe descartar vueltas en fechas distintas.');
echo "PASS provider fixtures: ida, vuelta, precio y fechas\n";
