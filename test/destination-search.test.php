<?php
define('DESTINATION_SEARCH_LIBRARY_ONLY', true);
require __DIR__ . '/../public/api/destination-search.php';

function check($condition, $message) { if (!$condition) throw new RuntimeException($message); }

$query = array('origin' => 'MAD', 'destination' => 'FCO', 'adults' => 2, 'children' => 1, 'infants' => 0, 'carryOnBags' => 2);
$params = destination_params($query, '2026-11-15', '2026-11-22', 'test-key');
check($params['engine'] === 'google_flights' && $params['departure_id'] === 'MAD' && $params['arrival_id'] === 'FCO', 'The selected route must reach Google Flights.');
check($params['outbound_date'] === '2026-11-15' && $params['return_date'] === '2026-11-22' && $params['type'] === 1, 'Exact outbound and return dates are required.');
check($params['adults'] === 2 && $params['children'] === 1 && $params['bags'] === 2, 'Passengers and carry-on bags must be passed through.');

$flight = function($arrival) { return array('departure_airport' => array('id' => 'MAD'), 'arrival_airport' => array('id' => $arrival), 'airline' => 'Test Air'); };
$response = array('search_metadata' => array('google_flights_url' => 'https://www.google.com/travel/flights/search?example=1'), 'best_flights' => array(array('price' => 60, 'flights' => array($flight('CDG'))), array('price' => 125, 'flights' => array($flight('FCO'))), array('price' => 90, 'flights' => array($flight('FCO')))));
$best = destination_best($response, $query, '2026-11-15', '2026-11-22');
check($best['destinationCode'] === 'FCO' && $best['flightPrice'] === 90.0, 'A cheaper flight to a different destination must be discarded.');
check($best['departureDate'] === '2026-11-15' && $best['returnDate'] === '2026-11-22', 'The result must retain the verified dates.');
check($best['flightLink'] === 'https://www.google.com/travel/flights/search?example=1', 'Only safe Google Flights links are accepted.');
$response['search_metadata']['google_flights_url'] = 'https://example.test/travel/flights';
check(destination_best($response, $query, '2026-11-15', '2026-11-22')['flightLink'] === '', 'External links must be discarded.');

$dates = destination_dates(destination_date('2026-11-15'), destination_date('2026-11-18'));
check(count($dates) === 4 && count(array_unique($dates)) === 4, 'Every departure date must be visited exactly once.');
$payload = destination_payload($query, array('checked' => array($dates[0] => 1, $dates[1] => 1), 'results' => array($dates[0] => $best)), $dates, 'Partial', false);
check($payload['coverage'] === array('checked' => 2, 'total' => 4, 'remaining' => 2, 'complete' => false), 'Partial coverage must be explicit.');
echo "Destination search contract passed.\n";
