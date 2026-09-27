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
check($best['destinationCode'] === 'FCO' && $best['outboundDisplayedPrice'] === 90.0 && $best['flightPrice'] === null, 'A cheaper outbound flight to a different destination must be discarded, and an outbound price is not a round-trip total.');
check($best['departureDate'] === '2026-11-15' && $best['returnDate'] === '2026-11-22', 'The result must retain the verified dates.');
check($best['flightLink'] === 'https://www.google.com/travel/flights/search?example=1', 'Only safe Google Flights links are accepted.');
$response['search_metadata']['google_flights_url'] = 'https://example.test/travel/flights';
check(destination_best($response, $query, '2026-11-15', '2026-11-22')['flightLink'] === '', 'External links must be discarded.');

$dates = destination_dates(destination_date('2026-11-15'), destination_date('2026-11-18'));
check(count($dates) === 4 && count(array_unique($dates)) === 4, 'Every departure date must be visited exactly once.');
$payload = destination_payload($query, array('checked' => array($dates[0] => 1, $dates[1] => 1), 'results' => array($dates[0] => $best)), $dates, 'Partial', false);
check($payload['coverage'] === array('checked' => 2, 'total' => 4, 'remaining' => 2, 'complete' => false), 'Partial coverage must be explicit.');

$direct = array(array('departure_airport' => array('time' => '2026-11-15 09:10')));
$early = array(array('departure_airport' => array('time' => '2026-11-15 06:10')));
check(destination_option_matches($direct, array('stops' => 'nonstop', 'noEarlyDeparture' => true)), 'A direct flight after 08:00 should match.');
check(!destination_option_matches($early, array('stops' => 'any', 'noEarlyDeparture' => true)), 'An early departure must be excluded.');
check(!destination_option_matches(array($direct[0], $direct[0]), array('stops' => 'nonstop')), 'A connection must be excluded by the nonstop filter.');

$today = destination_date('2026-09-27');
$window = destination_flexible_window('6m', $today);
check($window[0]->format('Y-m-d') === '2026-09-27' && $window[1]->format('Y-m-d') === '2027-03-26', 'Anytime search covers the next six months.');
check(destination_flexible_window('2026-11', $today)[2] === 11, 'A concrete month maps to the provider month.');
check(destination_flexible_window('2027-09', $today) === null, 'Out-of-horizon months must be rejected.');
$samples = destination_flexible_dates($window[0], $window[1], 7);
check(count($samples) >= 10 && count($samples) <= 13 && count(array_unique($samples)) === count($samples), 'A bounded sample spans the horizon without claiming exhaustive coverage.');
check(min($samples) < '2026-11-01' && max($samples) > '2027-02-01', 'Samples must reach both ends of the horizon.');
check(abs(strtotime($samples[0]) - strtotime($samples[1])) > 20 * 86400, 'The first two dates should be distributed across the period.');
$explore = destination_explore_params(array_merge($query, array('minNights' => 7, 'stops' => 'nonstop')), 0, 'test-key');
check($explore['engine'] === 'google_travel_explore' && $explore['arrival_id'] === 'FCO' && $explore['month'] === 0 && $explore['stops'] === 1, 'Discovery must target the selected destination and flexible months.');
$candidate = array('start_date' => '2026-11-12', 'end_date' => '2026-11-19', 'flights' => array(array('departure_airport' => array('id' => 'MAD'), 'arrival_airport' => array('id' => 'FCO'), 'number_of_stops' => 0)));
check(destination_explore_candidate($candidate, array_merge($query, array('minNights' => 7, 'stops' => 'nonstop')), $window[0], $window[1]) === '2026-11-12', 'An exact-duration candidate can be verified first.');
$candidate['end_date'] = '2026-11-20';
check(destination_explore_candidate($candidate, array_merge($query, array('minNights' => 7, 'stops' => 'nonstop')), $window[0], $window[1]) === null, 'A flexible approximate duration cannot masquerade as seven nights.');
echo "Destination search contract passed.\n";
