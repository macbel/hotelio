<?php
require_once __DIR__ . '/../public/api/user-bootstrap.php';
require_once __DIR__ . '/../public/api/alert-policy.php';
function expect($condition, $message) { if (!$condition) throw new RuntimeException($message); }
function fresh($db, $id) { return $db->query('SELECT * FROM alerts WHERE id=' . (int) $id)->fetch(); }
function createAlert($db, $type = 'destination', $price = 100, $query = null, $user = 1) {
    $query = $query ?? array('_alertMode' => 'lower', '_coverageVersion' => 3);
    $db->prepare('INSERT INTO alerts(user_id,type,label,query_json,frequency_hours,last_price,currency,next_check_at,expires_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
        ->execute(array($user, $type, 'Test trip', json_encode($query), 24, $price, 'EUR', 1, 2000000000, 1, 1));
    return (int) $db->lastInsertId();
}
function priceCheck($db, $id, $price, $now, $send, $reset = false) {
    $before = (int) $db->query('SELECT COUNT(*) FROM alert_checks WHERE alert_id=' . (int) $id)->fetchColumn();
    $result = vuelotel_apply_alert_price($db, fresh($db, $id), $price, $now, $send, $reset);
    expect((int) $db->query('SELECT COUNT(*) FROM alert_checks WHERE alert_id=' . (int) $id)->fetchColumn() === $before + 1, 'Exactly one history row per attempted price check');
    return $result;
}
function conditions($db, $id, $mode, $target = null, $percent = null, $hours = 0) {
    vuelotel_set_alert_conditions($db, fresh($db, $id), vuelotel_validate_conditions(array('mode' => $mode, 'targetPrice' => $target, 'minDropPercent' => $percent, 'notifyCooldownHours' => $hours)));
}
function endpointGet($directory, $file, $query, $token) {
    $harness = $directory . DIRECTORY_SEPARATOR . 'endpoint.php';
    $endpoint = realpath(__DIR__ . '/../public/api/' . $file);
    file_put_contents($harness, '<?php $_SERVER["REQUEST_METHOD"]="GET"; $_SERVER["HTTP_AUTHORIZATION"]=' . var_export('Bearer ' . $token, true)
        . '; $_GET=' . var_export($query, true) . '; putenv(' . var_export('VUELOTEL_DATA_PATH=' . $directory, true) . '); require ' . var_export($endpoint, true) . ';');
    $command = array(PHP_BINARY, '-d', 'extension_dir=' . ini_get('extension_dir'), '-d', 'extension=pdo_sqlite', '-d', 'extension=mbstring', $harness);
    $process = proc_open($command, array(array('pipe', 'r'), array('pipe', 'w'), array('pipe', 'w')), $pipes);
    fclose($pipes[0]); $output = stream_get_contents($pipes[1]); $error = stream_get_contents($pipes[2]); fclose($pipes[1]); fclose($pipes[2]);
    $code = proc_close($process); $data = json_decode($output, true);
    expect($code === 0 && is_array($data), 'Endpoint harness returned JSON without runtime errors: ' . $error . $output);
    return $data;
}

$directory = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'rumbiva-alert-test-' . bin2hex(random_bytes(6));
mkdir($directory, 0700);
$databasePath = $directory . DIRECTORY_SEPARATOR . 'vuelotel.sqlite';
$db = new PDO('sqlite:' . $databasePath); $db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION); $db->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
$db->exec('PRAGMA foreign_keys=ON');
try {
    vuelotel_schema($db);
    foreach (array(1, 2) as $user) $db->prepare('INSERT INTO users(id,email,password_hash,created_at,updated_at) VALUES(?,?,?,?,?)')->execute(array($user, 'user' . $user . '@example.test', 'unused-test-hash', 1, 1));
    foreach (array(1, 2) as $user) $db->prepare('INSERT INTO sessions(user_id,token_hash,expires_at,created_at,last_seen_at) VALUES(?,?,?,?,?)')->execute(array($user, hash('sha256', 'fixture-token-' . $user), time() + 3600, time(), time()));
    $legacy = createAlert($db);
    $db->prepare('INSERT INTO price_history(alert_id,price,currency,direction,checked_at) VALUES(?,?,?,?,?)')->execute(array($legacy, 101, 'EUR', 'down', 1));
    vuelotel_schema($db); vuelotel_schema($db);
    expect(fresh($db, $legacy)['last_price'] == 100, 'Idempotent migration preserves existing baselines');
    expect((int) $db->query('SELECT COUNT(*) FROM price_history')->fetchColumn() === 1, 'Migration preserves legacy history');
    expect((int) $db->query('SELECT COUNT(*) FROM alert_checks')->fetchColumn() === 0, 'Migration never invents historical checks');
    expect(vuelotel_alert_conditions(fresh($db, $legacy))['mode'] === 'lower', 'Destination legacy lower mode preserved');
    $hotel = createAlert($db, 'hotel');
    expect(vuelotel_alert_conditions(fresh($db, $hotel))['mode'] === 'change', 'Hotel legacy any change mode preserved');
    $thresholdLegacy = createAlert($db, 'destination', 100, array('_alertMode' => 'threshold', '_threshold' => 80));
    expect(vuelotel_alert_conditions(fresh($db, $thresholdLegacy))['targetPrice'] == 80, 'Legacy target price preserved');

    foreach (array(array('mode' => 'percent', 'minDropPercent' => 0), array('mode' => 'percent', 'minDropPercent' => 101),
        array('mode' => 'percent', 'minDropPercent' => NAN), array('mode' => 'threshold', 'targetPrice' => INF),
        array('mode' => 'threshold', 'targetPrice' => 'NaN'), array('mode' => 'threshold', 'targetPrice' => 0.001),
        array('mode' => 'lower', 'notifyCooldownHours' => 1), array('mode' => 'lower', 'notifyCooldownHours' => 12.5)) as $invalid) {
        $rejected = false; try { vuelotel_validate_conditions($invalid); } catch (InvalidArgumentException $error) { $rejected = true; }
        expect($rejected, 'Reject invalid/NaN/infinite price conditions');
    }
    $calls = 0; $accepted = function($decision) use (&$calls) { $calls++; return true; };
    $initial = createAlert($db, 'hotel', null);
    expect(priceCheck($db, $initial, 100, 1000000, $accepted)['status'] === 'initial' && $calls === 0, 'First comparable baseline never sends email');
    expect(priceCheck($db, $initial, 100.001, 1000100, $accepted)['status'] === 'checked' && $calls === 0, 'Cent rounding avoids tiny equality noise');
    expect(priceCheck($db, $initial, 110, 1000200, $accepted)['sent'] && $calls === 1, 'Legacy hotel still reports price increases');

    $percent = createAlert($db); conditions($db, $percent, 'percent', null, 5);
    $beforeCalls = $calls;
    expect(priceCheck($db, $percent, 98, 1100000, $accepted)['status'] === 'condition_not_met', 'Small percent decline does not notify');
    expect(fresh($db, $percent)['notify_reference_price'] == 100, 'Reference retains first price for accumulated drops');
    expect(priceCheck($db, $percent, 95, 1100100, $accepted)['sent'], '100 to 98 to 95 reaches exact five percent threshold');
    expect($calls === $beforeCalls + 1 && fresh($db, $percent)['notify_reference_price'] == 95, 'Successful email updates reference once');
    expect(!priceCheck($db, $percent, 95, 1100200, $accepted)['sent'], 'Unchanged price after percent notice does not notify again');

    $target = createAlert($db); conditions($db, $target, 'threshold', 90, null, 24);
    $db->prepare('UPDATE alerts SET last_notified_at=? WHERE id=?')->execute(array(1200000, $target));
    expect(priceCheck($db, $target, 90, 1200100, $accepted)['status'] === 'notify_pending', 'Exact target crossing inside cooldown stays pending');
    expect(priceCheck($db, $target, 89, 1200200, $accepted)['status'] === 'notify_pending', 'Pending target remains across subsequent checks');
    expect(priceCheck($db, $target, 89, 1200000 + 86400, $accepted)['sent'], 'Pending target sends exactly at cooldown boundary');
    expect((int) fresh($db, $target)['notify_pending'] === 0, 'Accepted email clears pending condition');
    $recover = createAlert($db); conditions($db, $recover, 'threshold', 90, null, 24);
    $db->prepare('UPDATE alerts SET last_notified_at=? WHERE id=?')->execute(array(1300000, $recover));
    priceCheck($db, $recover, 80, 1300100, $accepted);
    expect(!priceCheck($db, $recover, 95, 1300000 + 86400, $accepted)['sent'] && (int) fresh($db, $recover)['notify_pending'] === 0, 'Recovery above target cancels pending crossing');

    $lower = createAlert($db); conditions($db, $lower, 'lower', null, null, 24);
    priceCheck($db, $lower, 120, 1400000, $accepted);
    $db->prepare('UPDATE alerts SET last_notified_at=? WHERE id=?')->execute(array(1400000, $lower));
    priceCheck($db, $lower, 110, 1400100, $accepted);
    expect(fresh($db, $lower)['pending_reference_price'] == 120, 'Pending lower stores actual drop reference after a prior increase');
    expect(priceCheck($db, $lower, 110, 1400000 + 86400, $accepted)['sent'], 'Lower pending survives flat subsequent checks');
    $event = $db->query('SELECT * FROM alert_notifications WHERE alert_id=' . $lower)->fetch();
    expect($event['direction'] === 'down' && $event['old_price'] == 120 && $event['price'] == 110, 'Native event shows actual price decline, not stale initial baseline');
    $changeRecover = createAlert($db, 'hotel'); conditions($db, $changeRecover, 'change', null, null, 24);
    $db->prepare('UPDATE alerts SET last_notified_at=? WHERE id=?')->execute(array(1450000, $changeRecover));
    priceCheck($db, $changeRecover, 120, 1450100, $accepted);
    expect(!priceCheck($db, $changeRecover, 100, 1450000 + 86400, $accepted)['sent'] && (int) fresh($db, $changeRecover)['notify_pending'] === 0, 'Recovered any-change pending event does not send a zero-net-change notice');
    $newLower = fresh($db, $lower); $newLower['last_price'] = 140; $newLower['notify_pending'] = 1; $newLower['pending_reference_price'] = 120;
    $newDecision = vuelotel_alert_decision($newLower, 130, 1450000 + 172800);
    expect($newDecision['notify'] && $newDecision['notificationReference'] == 140, 'New decline above expired pending reference uses current previous price');

    $failed = createAlert($db); conditions($db, $failed, 'percent', null, 5);
    expect(priceCheck($db, $failed, 95, 1500000, function() { return false; })['status'] === 'mail_failed', 'Mail failure recorded separately');
    expect(fresh($db, $failed)['last_price'] == 100 && fresh($db, $failed)['notify_reference_price'] == 100 && (int) fresh($db, $failed)['next_check_at'] === 1503600, 'Mail failure preserves references and retries after one hour');
    $pendingId = fresh($db, $failed)['pending_notification_id'];
    expect(priceCheck($db, $failed, 94, 1503600, $accepted)['sent'], 'Failed email can retry with current comparable price');
    expect((int) $db->query('SELECT COUNT(*) FROM alert_notifications WHERE alert_id=' . $failed)->fetchColumn() === 1, 'Native event not duplicated on mail retry');
    $snapshot = $db->query('SELECT * FROM alert_notifications WHERE id=' . (int) $pendingId)->fetch();
    expect($snapshot['old_price'] == 100 && $snapshot['price'] == 95 && $snapshot['mail_status'] === 'accepted', 'Event price snapshot remains coherent after retry');

    $unknown = createAlert($db);
    expect(priceCheck($db, $unknown, 90, 1600000, function() { throw new RuntimeException('mail interrupted'); })['status'] === 'mail_unknown', 'Ambiguous interrupted mail is visible');
    $beforeCalls = $calls;
    expect(priceCheck($db, $unknown, 90, 1603600, $accepted)['status'] === 'mail_unknown' && $calls === $beforeCalls, 'Unconfirmed mail is never blindly resent');
    expect((int) $db->query('SELECT COUNT(*) FROM alert_notifications WHERE alert_id=' . $unknown)->fetchColumn() === 1, 'Interrupted mail does not duplicate native events');
    $durable = createAlert($db);
    priceCheck($db, $durable, 90, 1604000, function() use ($db, $databasePath, $durable) {
        expect(!$db->inTransaction(), 'External mail is not sent while holding an open database transaction');
        $observer = new PDO('sqlite:' . $databasePath);
        expect($observer->query('SELECT mail_status FROM alert_notifications WHERE alert_id=' . $durable)->fetchColumn() === 'sending', 'Independent connection sees durable mail intent before the external side effect');
        expect($observer->query('SELECT status FROM alert_checks WHERE alert_id=' . $durable)->fetchColumn() === 'mail_pending', 'Interrupted attempt already has a durable history row');
        $observer = null;
        return true;
    });
    $crashed = createAlert($db);
    $db->prepare('INSERT INTO alert_notifications(user_id,alert_id,label,old_price,price,currency,direction,created_at,mail_status) VALUES(?,?,?,?,?,?,?,?,?)')
        ->execute(array(1, $crashed, 'Interrupted intent', 100, 90, 'EUR', 'down', 1605000, 'sending'));
    $crashEventId = (int) $db->lastInsertId();
    $db->prepare('UPDATE alerts SET notify_pending=1,pending_reference_price=100,pending_notification_id=?,last_status=? WHERE id=?')->execute(array($crashEventId, 'mail_pending', $crashed));
    vuelotel_alert_check($db, fresh($db, $crashed), 1605000, 'mail_pending', 90, 100, 100, 'down', 'pending');
    $beforeCalls = $calls;
    expect(priceCheck($db, $crashed, 90, 1608600, $accepted)['status'] === 'mail_unknown' && $calls === $beforeCalls, 'Recovered sending intent after process crash never resends blindly');
    $historyBefore = (int) $db->query('SELECT COUNT(*) FROM alert_checks WHERE alert_id=' . $unknown)->fetchColumn();
    conditions($db, $unknown, 'percent', null, 10);
    expect((int) fresh($db, $unknown)['notify_pending'] === 0 && fresh($db, $unknown)['pending_notification_id'] === null, 'Changing conditions clears pending outbox');
    expect((int) $db->query('SELECT COUNT(*) FROM alert_checks WHERE alert_id=' . $unknown)->fetchColumn() === $historyBefore, 'Editing conditions preserves past checks');
    $reset = createAlert($db, 'flight', 100);
    expect(!priceCheck($db, $reset, 80, 1700000, $accepted, true)['sent'] && fresh($db, $reset)['last_price'] == 80, 'Legacy incomplete-flight baseline resets without notice');
    $invalidBaseline = createAlert($db, 'hotel', 0); conditions($db, $invalidBaseline, 'percent', null, 5);
    expect(priceCheck($db, $invalidBaseline, 100, 1700100, $accepted)['status'] === 'initial', 'Invalid legacy zero baseline restarts comparison without divide-by-zero or false notice');

    foreach (array('error', 'needs_reconfiguration') as $status) {
        $before = (int) $db->query('SELECT COUNT(*) FROM alert_checks')->fetchColumn();
        vuelotel_alert_failure($db, fresh($db, $legacy), 1800000, $status, '<b>Provider unavailable</b>', 1803600);
        expect((int) $db->query('SELECT COUNT(*) FROM alert_checks')->fetchColumn() === $before + 1, 'Failed/reconfiguration attempt records one check');
        $row = $db->query('SELECT * FROM alert_checks ORDER BY id DESC LIMIT 1')->fetch();
        expect($row['price'] === null && $row['error'] === 'Provider unavailable', 'Failure has no invented comparable price and sanitized error');
    }
    expect(vuelotel_alert_history($db, 2, $legacy) === null, 'History enforces user ownership');
    for ($i = 0; $i < 55; $i++) vuelotel_alert_check($db, fresh($db, $legacy), 1900000 + $i, 'checked', 100, 100, 100, 'same');
    $history = vuelotel_alert_history($db, 1, $legacy); $next = vuelotel_alert_history($db, 1, $legacy, $history['nextBeforeId']);
    expect(count($history['checks']) === 50 && $history['nextBeforeId'] !== null && count($next['checks']) === 7, 'History cursor paginates newest fifty without overlap');
    expect($history['checks'][49]['id'] > $next['checks'][0]['id'], 'History pagination strictly descends');

    $privateAlert = createAlert($db, 'hotel', 200, null, 2);
    priceCheck($db, $privateAlert, 180, 2000000, $accepted);
    expect(count(vuelotel_notifications($db, 2, 0)['notifications']) === 1, 'Private event exists only for owner');
    $baseline = vuelotel_notifications($db, 1);
    expect($baseline['notifications'] === array() && $baseline['newestId'] > 0, 'Initial notification baseline never replays old events');
    for ($i = 0; $i < 55; $i++) $db->prepare('INSERT INTO alert_notifications(user_id,alert_id,label,old_price,price,currency,direction,created_at,mail_status) VALUES(?,?,?,?,?,?,?,?,?)')
        ->execute(array(1, $legacy, 'Sample', 100, 90, 'EUR', 'down', 2100000 + $i, 'accepted'));
    $feed = vuelotel_notifications($db, 1, $baseline['newestId'], 100);
    expect(count($feed['notifications']) === 50 && $feed['hasMore'], 'Notification page is capped at fifty and announces continuation');
    $last = end($feed['notifications'])['id']; $feedNext = vuelotel_notifications($db, 1, $last, 50);
    expect(count($feedNext['notifications']) === 5 && !$feedNext['hasMore'], 'Ascending notification cursor never omits next page');
    foreach (vuelotel_notifications($db, 1, 0)['notifications'] as $notice) expect($notice['alertId'] !== $privateAlert && $notice['direction'] === 'down' && !isset($notice['query']), 'Feed excludes other users, increases and full queries');
    expect(vuelotel_notifications($db, 1, 999999)['newestId'] === 999999, 'Deleted events cannot rewind a persisted cursor');
    $privateNotification = vuelotel_notifications($db, 2, 0)['notifications'][0]['id'];
    vuelotel_mark_notifications_read($db, 1, array($privateNotification), 2200000);
    expect($db->query('SELECT read_at FROM alert_notifications WHERE id=' . $privateNotification)->fetchColumn() === null, 'Read acknowledgement cannot mutate another account');
    vuelotel_mark_notifications_read($db, 2, array($privateNotification), 2200000);
    expect((int) $db->query('SELECT read_at FROM alert_notifications WHERE id=' . $privateNotification)->fetchColumn() === 2200000, 'Owner can acknowledge own event');
    expect(strpos(vuelotel_alert_error('Provider api_key=test-private-key&token=test-token'), 'test-private-key') === false, 'Provider credentials are redacted from history and runner errors');
    $ownedHistory = endpointGet($directory, 'account.php', array('action' => 'alert_history', 'id' => $legacy), 'fixture-token-1');
    expect(count($ownedHistory['checks']) === 50, 'Authenticated history endpoint returns bounded own checks');
    $deniedHistory = endpointGet($directory, 'account.php', array('action' => 'alert_history', 'id' => $legacy), 'fixture-token-2');
    expect(isset($deniedHistory['error']) && !isset($deniedHistory['checks']), 'History endpoint never returns another account checks');
    $deniedFeed = endpointGet($directory, 'notifications.php', array('afterId' => 0), 'expired-or-wrong-token');
    expect(isset($deniedFeed['error']) && !isset($deniedFeed['notifications']), 'Notification endpoint requires a current authenticated session');
    $ownFeed = endpointGet($directory, 'notifications.php', array('afterId' => 0), 'fixture-token-2');
    expect(count($ownFeed['notifications']) === 1 && $ownFeed['notifications'][0]['alertId'] === $privateAlert, 'Notification endpoint exposes only authenticated user events');
    $ownAccount = endpointGet($directory, 'account.php', array(), 'fixture-token-1');
    $accountById = array_column($ownAccount['alerts'], null, 'id');
    expect($accountById[$percent]['conditions']['mode'] === 'percent' && $accountById[$percent]['conditions']['minDropPercent'] == 5, 'Account endpoint exposes normalized condition contract');
    $beforeDelete = (int) $db->query('SELECT COUNT(*) FROM alert_checks WHERE alert_id=' . $legacy)->fetchColumn();
    expect($beforeDelete > 0, 'Cascade fixture has history');
    $db->exec('DELETE FROM alerts WHERE id=' . $legacy);
    expect((int) $db->query('SELECT COUNT(*) FROM alert_checks WHERE alert_id=' . $legacy)->fetchColumn() === 0 && (int) $db->query('SELECT COUNT(*) FROM alert_notifications WHERE alert_id=' . $legacy)->fetchColumn() === 0, 'Deleting owned alert cascades its private history/events');
    echo "Alert policy, persistence, migration and isolation checks passed.\n";
} finally {
    $db = null;
    foreach (glob($directory . DIRECTORY_SEPARATOR . '*') as $path) unlink($path);
    if (is_file($directory . DIRECTORY_SEPARATOR . '.htaccess')) unlink($directory . DIRECTORY_SEPARATOR . '.htaccess');
    rmdir($directory);
}
