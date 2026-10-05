<?php
require_once __DIR__ . '/../public/api/user-bootstrap.php';
require_once __DIR__ . '/../public/api/alert-policy.php';
function verifyOpen($condition, $message) { if (!$condition) throw new RuntimeException($message); }
function openFixture($db, $type, $query, $active = 1, $expires = null) {
    $db->prepare('INSERT INTO alerts(user_id,type,label,query_json,frequency_hours,last_price,currency,next_check_at,expires_at,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
        ->execute(array(1, $type, 'Stored trip', json_encode($query), 24, 245.25, 'EUR', time() + 86400, $expires ?? time() + 604800, $active, time(), time()));
    return (int) $db->lastInsertId();
}
function openEndpoint($directory, $id, $token) {
    $harness = $directory . DIRECTORY_SEPARATOR . 'endpoint.php';
    file_put_contents($harness, '<?php $_SERVER["REQUEST_METHOD"]="GET"; $_SERVER["HTTP_AUTHORIZATION"]=' . var_export('Bearer ' . $token, true)
        . '; $_GET=' . var_export(array('action' => 'open_alert', 'id' => $id), true) . '; putenv(' . var_export('VUELOTEL_DATA_PATH=' . $directory, true)
        . '); require ' . var_export(realpath(__DIR__ . '/../public/api/account.php'), true) . ';');
    $process = proc_open(array(PHP_BINARY, '-d', 'extension_dir=' . ini_get('extension_dir'), '-d', 'extension=pdo_sqlite', '-d', 'extension=mbstring', $harness),
        array(array('pipe', 'r'), array('pipe', 'w'), array('pipe', 'w')), $pipes);
    fclose($pipes[0]); $output = stream_get_contents($pipes[1]); $error = stream_get_contents($pipes[2]); fclose($pipes[1]); fclose($pipes[2]);
    $exit = proc_close($process); $data = json_decode($output, true);
    verifyOpen($exit === 0 && is_array($data), 'Authenticated endpoint must return JSON: ' . $output . $error);
    return $data;
}

$directory = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'rumbiva-open-test-' . bin2hex(random_bytes(6)); mkdir($directory, 0700);
$db = new PDO('sqlite:' . $directory . DIRECTORY_SEPARATOR . 'vuelotel.sqlite');
$db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION); $db->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC); $db->exec('PRAGMA foreign_keys=ON');
try {
    vuelotel_schema($db);
    foreach (array(1, 2) as $user) {
        $db->prepare('INSERT INTO users(id,email,password_hash,created_at,updated_at) VALUES(?,?,?,?,?)')->execute(array($user, 'fixture' . $user . '@example.test', 'unused', 1, 1));
        $db->prepare('INSERT INTO sessions(user_id,token_hash,expires_at,created_at,last_seen_at) VALUES(?,?,?,?,?)')->execute(array($user, hash('sha256', 'open-fixture-' . $user), time() + 3600, time(), time()));
    }
    $fixtures = array(
        'hotel' => array('destination' => 'Dublin', 'checkIn' => '2026-12-08', 'checkOut' => '2026-12-15', 'adults' => 2, 'childrenAges' => array(7, 13), 'rooms' => 2, 'board' => 'half_board', 'maxPrice' => 500),
        'flight' => array('origin' => 'AGP', 'destination' => 'DUB', 'departureDate' => '2026-12-08', 'returnDate' => '2026-12-15', 'tripType' => 'roundtrip', 'adults' => 2, 'children' => 1, 'carryOnBags' => 2, 'stops' => 'nonstop'),
        'combined' => array('flight' => array('origin' => 'AGP', 'destination' => 'DUB', 'departureDate' => '2026-12-08', 'returnDate' => '2026-12-15', 'adults' => 2),
            'hotel' => array('destination' => 'Dublin', 'checkIn' => '2026-12-08', 'checkOut' => '2026-12-15', 'rooms' => 1, 'board' => 'breakfast')),
        'destination' => array('origin' => 'AGP', 'destination' => 'DUB', 'flexible' => true, 'flexiblePeriod' => '6m', 'minNights' => 7, 'adults' => 2, 'checkedBags' => 1, '_alertScope' => 'flight'),
    );
    foreach ($fixtures as $type => $filters) {
        $id = openFixture($db, $type, array_merge($filters, array('_alertMode' => 'threshold', '_threshold' => 300, '_coverageVersion' => 3)));
        $opened = vuelotel_open_alert($db, 1, $id);
        verifyOpen($opened['search']['type'] === $type && $opened['search']['filters'] === $filters, 'Each alert type restores its original saved search fields');
        verifyOpen($opened['search']['alertId'] === $id && $opened['search']['price'] == 245.25 && $opened['search']['currency'] === 'EUR', 'Restoration identifies alert and reference price');
        verifyOpen(vuelotel_open_alert($db, 2, $id) === null, 'Another account cannot hydrate a private search');
    }
    $planQuery = array('origin' => 'AGP', 'destination' => 'DUB', 'destinations' => array('DUB', 'FCO'), 'flexible' => true, 'flexiblePeriod' => '6m', 'startDate' => '2026-10-01', 'endDate' => '2027-03-31', 'minNights' => 10,
        '_alertScope' => 'plan', '_plan' => array('departureDate' => '2026-12-08', 'returnDate' => '2026-12-15', 'destinationText' => 'Dublin', 'hotelName' => 'LATROUPE Jacobs Inn Dublin Hostel'));
    $planId = openFixture($db, 'destination', $planQuery);
    $plan = vuelotel_open_alert($db, 1, $planId)['search']['filters'];
    verifyOpen($plan['flexible'] === false && $plan['startDate'] === '2026-12-08' && $plan['endDate'] === '2026-12-08' && $plan['minNights'] === 7, 'Followed plan restores exact dates and derived nights rather than a flexible period');
    verifyOpen($plan['destinations'] === array('DUB') && $plan['selectedPlan']['destinationCode'] === 'DUB', 'Followed plan restores only its selected destination, not earlier compared alternatives');
    verifyOpen($plan['_plan'] === $planQuery['_plan'] && $plan['selectedPlan']['hotel']['name'] === $planQuery['_plan']['hotelName'], 'Opening preserves the selected hotel and all original plan metadata');
    verifyOpen($plan['selectedPlan']['referenceOnly'] && !isset($plan['selectedPlan']['flightPrice']) && !isset($plan['selectedPlan']['hotel']['totalPrice']), 'Reference plan does not invent a flight/hotel price breakdown');
    verifyOpen(json_decode(vuelotel_owned_alert($db, 1, $planId)['query_json'], true) === $planQuery, 'Hydration never rewrites the original saved alert');
    $endpoint = openEndpoint($directory, $planId, 'open-fixture-1');
    verifyOpen($endpoint['search']['filters']['selectedPlan']['hotelName'] === $planQuery['_plan']['hotelName'], 'Authenticated endpoint exposes exact selected-plan restoration');
    $wrongOwner = openEndpoint($directory, $planId, 'open-fixture-2');
    $noSession = openEndpoint($directory, $planId, 'invalid-session');
    verifyOpen(isset($wrongOwner['error']) && !isset($wrongOwner['search']) && isset($noSession['error']) && !isset($noSession['search']), 'Endpoint rejects foreign ownership and missing authentication without disclosing filters');
    $expiredId = openFixture($db, 'hotel', $fixtures['hotel'], 0, time() - 86400);
    $expired = vuelotel_open_alert($db, 1, $expiredId);
    verifyOpen($expired['alert']['expired'] && $expired['alert']['active'] === 0 && $expired['search']['filters'] === $fixtures['hotel'], 'Expired alert may open its saved search without reactivation');
    verifyOpen((int) vuelotel_owned_alert($db, 1, $expiredId)['active'] === 0, 'Opening does not reactivate expired alerts');

    $alert = vuelotel_owned_alert($db, 1, $planId);
    $alert['label'] = 'Hotel <script>alert("x")</script> & "quoted"' . "\r\nInjected header";
    $mail = vuelotel_alert_mail_content($alert, array('notificationReference' => 300, 'price' => 245.25));
    $canonical = 'https://www.alufi.es/vuelotel/abrir-alerta.html?alertId=' . $planId;
    verifyOpen(vuelotel_alert_open_url($planId) === $canonical && strpos($mail['html'], 'href="' . $canonical . '"') !== false, 'Every alert mail contains a canonical HTTPS link with only its alert ID');
    verifyOpen(substr_count($mail['html'], $canonical) === 3 && $mail['text'] === 'Abrir búsqueda: ' . $canonical, 'Mail has visible copyable fallback URL as well as CTA');
    verifyOpen(strpos($mail['html'], '<script>') === false && strpos($mail['html'], '&lt;script&gt;') !== false && strpos($mail['subject'], "\r") === false && strpos($mail['subject'], "\n") === false, 'Mail escapes labels and prevents subject header injection');
    verifyOpen(strpos($canonical, 'token') === false && strpos($canonical, 'Dublin') === false && strpos($canonical, 'example.test') === false, 'Public link carries no session, email or private search payload');
    $badPlan = $planQuery; $badPlan['_plan']['departureDate'] = '2026-02-31';
    $malformed = openFixture($db, 'destination', $badPlan);
    $rejected = false; try { vuelotel_open_alert($db, 1, $malformed); } catch (InvalidArgumentException $error) { $rejected = true; }
    verifyOpen($rejected, 'Invalid legacy plan dates fail instead of silently restoring a different trip');
    $db->exec('DELETE FROM alerts WHERE id=' . $planId);
    $deleted = openEndpoint($directory, $planId, 'open-fixture-1');
    verifyOpen(vuelotel_open_alert($db, 1, $planId) === null && $deleted['error'] === $wrongOwner['error'], 'Deleted and foreign alerts produce the same unavailable response');
    echo "Alert mail links, hydration and authenticated ownership checks passed.\n";
} finally {
    unset($error);
    $db = null;
    foreach (glob($directory . DIRECTORY_SEPARATOR . '*') as $path) unlink($path);
    if (is_file($directory . DIRECTORY_SEPARATOR . '.htaccess')) unlink($directory . DIRECTORY_SEPARATOR . '.htaccess');
    rmdir($directory);
}
