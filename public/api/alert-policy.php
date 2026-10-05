<?php
function vuelotel_alert_conditions($alert) {
    $query = isset($alert['query_json']) ? json_decode($alert['query_json'], true) : ($alert['query'] ?? array());
    $legacyMode = ($alert['type'] ?? '') === 'destination' ? ($query['_alertMode'] ?? 'lower') : 'change';
    $mode = $alert['condition_mode'] ?? $legacyMode;
    $hours = (int) ($alert['notify_cooldown_hours'] ?? 0);
    return array('mode' => $mode, 'targetPrice' => $alert['target_price'] ?? ($mode === 'threshold' ? (float) ($query['_threshold'] ?? 0) : null),
        'minDropPercent' => $alert['min_drop_percent'] ?? null, 'notificationHours' => $hours, 'notifyCooldownHours' => $hours);
}

function vuelotel_validate_conditions($conditions) {
    if (!is_array($conditions)) throw new InvalidArgumentException('Configura unas condiciones de aviso válidas.');
    $mode = $conditions['mode'] ?? '';
    if (!in_array($mode, array('change', 'lower', 'threshold', 'percent'), true)) throw new InvalidArgumentException('La condición de precio no es válida.');
    $target = $conditions['targetPrice'] ?? null; $percent = $conditions['minDropPercent'] ?? null;
    foreach (array($target, $percent) as $value) {
        if ($value !== null && (!is_numeric($value) || !is_finite((float) $value))) throw new InvalidArgumentException('Los importes y porcentajes deben ser números finitos.');
    }
    if ($target !== null && (round((float) $target, 2) <= 0 || (float) $target > 10000000)) throw new InvalidArgumentException('El precio objetivo debe ser positivo.');
    if ($percent !== null && ((float) $percent <= 0 || (float) $percent > 100)) throw new InvalidArgumentException('La bajada porcentual debe estar entre 0 y 100.');
    if ($mode === 'threshold' && $target === null) throw new InvalidArgumentException('Indica un precio objetivo.');
    if ($mode === 'percent' && $percent === null) throw new InvalidArgumentException('Indica una bajada porcentual mínima.');
    $hours = $conditions['notificationHours'] ?? ($conditions['notifyCooldownHours'] ?? 0);
    if (!is_numeric($hours) || (float) $hours !== (float) (int) $hours || !in_array((int) $hours, array(0, 12, 24, 72, 168), true)) throw new InvalidArgumentException('El intervalo mínimo de avisos no es válido.');
    return array('mode' => $mode, 'targetPrice' => $target === null ? null : round((float) $target, 2),
        'minDropPercent' => $percent === null ? null : (float) $percent, 'notificationHours' => (int) $hours);
}

function vuelotel_alert_decision($alert, $price, $now, $resetBaseline = false) {
    if (!is_numeric($price) || !is_finite((float) $price) || $price <= 0) throw new InvalidArgumentException('No se encontró un precio comparable.');
    $price = round((float) $price, 2);
    if ($price <= 0) throw new InvalidArgumentException('No se encontró un precio comparable.');
    $validOld = is_numeric($alert['last_price']) && is_finite((float) $alert['last_price']) && round((float) $alert['last_price'], 2) > 0;
    $old = $resetBaseline || !$validOld ? null : round((float) $alert['last_price'], 2);
    $reference = $resetBaseline ? null : ($alert['notify_reference_price'] ?? $old);
    if ($reference !== null && (!is_numeric($reference) || !is_finite((float) $reference) || (float) $reference <= 0)) $reference = $old;
    $reference = $reference === null ? $price : round((float) $reference, 2);
    $conditions = vuelotel_alert_conditions($alert);
    $pending = !$resetBaseline && !empty($alert['notify_pending']);
    $pendingReference = $pending ? (float) ($alert['pending_reference_price'] ?? $reference) : $reference;
    $direction = $old === null ? 'initial' : ($price > $old ? 'up' : ($price < $old ? 'down' : 'same'));
    $eligible = false;
    if ($old !== null) {
        if ($conditions['mode'] === 'change') $eligible = $pending && $price === $pendingReference ? false : ($price !== $old || ($pending && $price !== $pendingReference));
        elseif ($conditions['mode'] === 'lower') $eligible = $price < $old || ($pending && $price < $pendingReference);
        elseif ($conditions['mode'] === 'threshold') $eligible = $price <= $conditions['targetPrice'] && ($old > $conditions['targetPrice'] || $pending);
        elseif ($conditions['mode'] === 'percent') $eligible = $price < $reference && (($reference - $price) * 100 / $reference + 0.0000001) >= $conditions['minDropPercent'];
    }
    $cooldown = $eligible && !empty($alert['last_notified_at']) && $now < (int) $alert['last_notified_at'] + $conditions['notificationHours'] * 3600;
    $continuesPending = $pending && ($conditions['mode'] === 'change' ? $price !== $pendingReference :
        ($conditions['mode'] === 'lower' ? $price < $pendingReference : $eligible));
    $eventReference = $continuesPending ? $pendingReference : ($conditions['mode'] === 'percent' ? $reference : $old);
    return array('price' => $price, 'old' => $old, 'reference' => $reference, 'notificationReference' => $eventReference, 'direction' => $direction,
        'eligible' => $eligible, 'cooldown' => $cooldown, 'notify' => $eligible && !$cooldown);
}

function vuelotel_alert_check($db, $alert, $now, $status, $price = null, $old = null, $reference = null, $direction = 'unknown', $mailStatus = 'not_attempted', $error = null, $notified = false) {
    $db->prepare('INSERT INTO alert_checks(alert_id,checked_at,price,previous_price,reference_price,currency,direction,status,mail_status,error,notified) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
        ->execute(array($alert['id'], $now, $price, $old, $reference, $alert['currency'], $direction, $status, $mailStatus,
            $error === null ? null : vuelotel_alert_error($error), $notified ? 1 : 0));
    return (int) $db->lastInsertId();
}
function vuelotel_alert_error($error) {
    $message = strip_tags((string) $error);
    $message = preg_replace('/((?:api[_-]?key|access[_-]?token|token|secret|password)\s*[=:]\s*)[^\s&]+/i', '$1[oculto]', $message);
    return mb_substr($message, 0, 240);
}

function vuelotel_apply_alert_price($db, $alert, $price, $now, $sendMail, $resetBaseline = false) {
    $current = vuelotel_owned_alert($db, (int) $alert['user_id'], (int) $alert['id']);
    if (!$current || (int) $current['active'] !== 1 || (int) $current['expires_at'] <= $now) return array('status' => 'skipped', 'sent' => false, 'error' => null);
    $alert = $current;
    $decision = vuelotel_alert_decision($alert, $price, $now, $resetBaseline);
    $status = $decision['cooldown'] ? 'notify_pending' : ($decision['direction'] === 'initial' ? 'initial' :
        (!$decision['eligible'] && $decision['direction'] !== 'same' ? 'condition_not_met' : 'checked'));
    $mailStatus = 'not_attempted'; $sent = false;
    $error = null; $notificationId = $alert['pending_notification_id'] ?? null; $checkId = null;
    if ($notificationId && isset($alert['pending_reference_price']) && (float) $alert['pending_reference_price'] !== $decision['notificationReference']) $notificationId = null;
    if ($decision['notify']) {
        // Commit the mail intent before external mail(): a crash cannot silently resend it.
        $db->beginTransaction();
        try {
            $existing = null;
            if ($notificationId) {
                $statement = $db->prepare('SELECT mail_status FROM alert_notifications WHERE id=? AND user_id=? AND alert_id=?');
                $statement->execute(array($notificationId, $alert['user_id'], $alert['id'])); $existing = $statement->fetchColumn();
                if ($existing === false) $notificationId = null;
            }
            if ($existing === 'sending' || $existing === 'unknown') {
                $status = 'mail_unknown'; $mailStatus = 'unknown';
                $error = 'El envío anterior quedó sin confirmación. No se repite automáticamente para evitar duplicados; revisa el buzón y modifica las condiciones para reintentar.';
                $db->prepare("UPDATE alert_notifications SET mail_status='unknown' WHERE id=? AND user_id=?")->execute(array($notificationId, $alert['user_id']));
            } else {
                $eventDirection = $decision['price'] > $decision['notificationReference'] ? 'up' : 'down';
                if (!$notificationId) {
                    $db->prepare('INSERT INTO alert_notifications(user_id,alert_id,label,old_price,price,currency,direction,created_at,mail_status) VALUES(?,?,?,?,?,?,?,?,?)')
                        ->execute(array($alert['user_id'], $alert['id'], $alert['label'], $decision['notificationReference'], $decision['price'], $alert['currency'], $eventDirection, $now, 'sending'));
                    $notificationId = (int) $db->lastInsertId();
                } else $db->prepare("UPDATE alert_notifications SET mail_status='sending' WHERE id=? AND user_id=?")->execute(array($notificationId, $alert['user_id']));
                $checkId = vuelotel_alert_check($db, $alert, $now, 'mail_pending', $decision['price'], $decision['old'], $decision['reference'], $decision['direction'], 'pending');
                $db->prepare('UPDATE alerts SET notify_pending=1,pending_notification_id=?,pending_reference_price=?,notify_reference_price=?,last_checked_at=?,last_status=?,updated_at=? WHERE id=?')
                    ->execute(array($notificationId, $decision['notificationReference'], $decision['reference'], $now, 'mail_pending', $now, $alert['id']));
            }
            $db->commit();
        } catch (Throwable $failure) { if ($db->inTransaction()) $db->rollBack(); throw $failure; }
        if ($status !== 'mail_unknown') {
            try { $sent = (bool) $sendMail($decision); }
            catch (Throwable $failure) { $status = 'mail_unknown'; $mailStatus = 'unknown'; $error = 'El servidor no pudo confirmar el resultado del envío. No se repite automáticamente para evitar duplicados.'; }
            if ($status !== 'mail_unknown') {
                $status = $sent ? 'sent' : 'mail_failed'; $mailStatus = $sent ? 'accepted' : 'failed';
                $error = $sent ? null : 'El servidor no pudo enviar el correo. Se reintentará en una hora.';
            }
        }
    }
    $db->beginTransaction();
    try {
        if ($decision['notify']) {
            // The native event keeps the price snapshot originally shown, even when mail retries later.
            $db->prepare('UPDATE alert_notifications SET mail_status=? WHERE id=? AND user_id=?')->execute(array($mailStatus, $notificationId, $alert['user_id']));
            if ($sent) $db->prepare('INSERT INTO price_history(alert_id,price,currency,direction,checked_at) VALUES(?,?,?,?,?)')->execute(array($alert['id'], $decision['price'], $alert['currency'], $decision['direction'], $now));
        }
        $pending = $decision['eligible'] && !$sent;
        $lastPrice = in_array($status, array('mail_failed', 'mail_unknown'), true) ? $alert['last_price'] : $decision['price'];
        $reference = $sent ? $decision['price'] : $decision['reference'];
        $next = $now + ($status === 'mail_failed' ? 3600 : (int) $alert['frequency_hours'] * 3600);
        $db->prepare('UPDATE alerts SET last_price=?,last_checked_at=?,next_check_at=?,last_status=?,last_error=?,last_notified_at=?,notify_reference_price=?,notify_pending=?,pending_reference_price=?,pending_notification_id=?,updated_at=? WHERE id=?')
            ->execute(array($lastPrice, $now, $next, $status, $error, $sent ? $now : $alert['last_notified_at'], $reference, $pending ? 1 : 0,
                $pending ? $decision['notificationReference'] : null, $pending ? $notificationId : null, $now, $alert['id']));
        if ($checkId !== null) {
            // Complete only this attempt's provisional row; finalized history is never rewritten.
            $db->prepare('UPDATE alert_checks SET status=?,mail_status=?,error=?,notified=? WHERE id=? AND alert_id=?')
                ->execute(array($status, $mailStatus, $error, $sent ? 1 : 0, $checkId, $alert['id']));
        } else vuelotel_alert_check($db, $alert, $now, $status, $decision['price'], $decision['old'], $decision['reference'], $decision['direction'], $mailStatus, $error, $sent);
        $db->commit();
    } catch (Throwable $failure) { if ($db->inTransaction()) $db->rollBack(); throw $failure; }
    return array('status' => $status, 'sent' => $sent, 'error' => $error);
}

function vuelotel_alert_failure($db, $alert, $now, $status, $error, $next) {
    $current = vuelotel_owned_alert($db, (int) $alert['user_id'], (int) $alert['id']);
    if (!$current) return;
    $db->beginTransaction();
    try {
        $db->prepare('UPDATE alerts SET last_checked_at=?,next_check_at=?,last_status=?,last_error=?,updated_at=? WHERE id=?')->execute(array($now, $next, $status, vuelotel_alert_error($error), $now, $alert['id']));
        vuelotel_alert_check($db, $alert, $now, $status, null, $alert['last_price'], $alert['notify_reference_price'] ?? $alert['last_price'], 'unknown', 'not_attempted', $error);
        $db->commit();
    } catch (Throwable $failure) { if ($db->inTransaction()) $db->rollBack(); throw $failure; }
}
function vuelotel_mark_notifications_read($db, $userId, $ids, $now) {
    if (!is_array($ids) || count($ids) > 50) throw new InvalidArgumentException('Notificaciones no válidas.');
    foreach ($ids as $id) if (!is_numeric($id) || (float) $id !== (float) (int) $id || (int) $id < 1) throw new InvalidArgumentException('Identificador no válido.');
    $statement = $db->prepare('UPDATE alert_notifications SET read_at=COALESCE(read_at,?) WHERE id=? AND user_id=?');
    foreach ($ids as $id) $statement->execute(array($now, (int) $id, (int) $userId));
}

function vuelotel_owned_alert($db, $userId, $id) {
    $statement = $db->prepare('SELECT * FROM alerts WHERE id=? AND user_id=?'); $statement->execute(array($id, $userId));
    return $statement->fetch();
}
function vuelotel_alert_open_url($id) {
    $valid = filter_var($id, FILTER_VALIDATE_INT, array('options' => array('min_range' => 1)));
    if ($valid === false) throw new InvalidArgumentException('Identificador de alerta no válido.');
    return vuelotel_app_url('abrir-alerta.html?alertId=' . $valid);
}

function vuelotel_alert_search($alert) {
    $filters = json_decode((string) $alert['query_json'], true);
    if (!is_array($filters) || !in_array($alert['type'], array('hotel', 'flight', 'combined', 'destination'), true)) throw new InvalidArgumentException('No se pudo restaurar esta búsqueda.');
    unset($filters['_alertMode'], $filters['_threshold'], $filters['_coverageVersion']);
    if ($alert['type'] === 'destination' && ($filters['_alertScope'] ?? '') === 'plan') {
        $plan = $filters['_plan'] ?? null;
        if (!is_array($plan)) throw new InvalidArgumentException('No se pudo restaurar el plan de esta alerta.');
        $departure = DateTimeImmutable::createFromFormat('!Y-m-d', (string) ($plan['departureDate'] ?? ''), new DateTimeZone('UTC'));
        $return = DateTimeImmutable::createFromFormat('!Y-m-d', (string) ($plan['returnDate'] ?? ''), new DateTimeZone('UTC'));
        if (!$departure || !$return || $departure->format('Y-m-d') !== ($plan['departureDate'] ?? '') || $return->format('Y-m-d') !== ($plan['returnDate'] ?? '')
            || $return <= $departure || $departure->diff($return)->days > 30 || trim((string) ($plan['hotelName'] ?? '')) === '') throw new InvalidArgumentException('No se pudo restaurar el plan de esta alerta.');
        // Opening a followed plan restores its exact trip rather than its earlier flexible window.
        $filters['flexible'] = false;
        $filters['startDate'] = $departure->format('Y-m-d');
        $filters['endDate'] = $filters['startDate'];
        $filters['minNights'] = (int) $departure->diff($return)->days;
        $filters['destinations'] = array($filters['destination']);
        $filters['selectedPlan'] = array('departureDate' => $plan['departureDate'], 'returnDate' => $plan['returnDate'],
            'destinationCode' => (string) $filters['destination'],
            'destinationText' => (string) ($plan['destinationText'] ?? $filters['destination'] ?? ''), 'hotelName' => (string) $plan['hotelName'],
            'hotel' => array('name' => (string) $plan['hotelName']), 'total' => $alert['last_price'], 'currency' => $alert['currency'],
            'referenceOnly' => true);
    }
    return array('type' => $alert['type'], 'filters' => $filters, 'label' => $alert['label'], 'price' => $alert['last_price'],
        'currency' => $alert['currency'], 'alertId' => (int) $alert['id']);
}

function vuelotel_open_alert($db, $userId, $id) {
    $alert = vuelotel_owned_alert($db, (int) $userId, (int) $id);
    if (!$alert) return null;
    return array('search' => vuelotel_alert_search($alert), 'alert' => array('id' => (int) $alert['id'], 'active' => (int) $alert['active'],
        'expires_at' => (int) $alert['expires_at'], 'expired' => (int) $alert['active'] !== 1 || (int) $alert['expires_at'] <= time()));
}

function vuelotel_alert_mail_content($alert, $decision) {
    $reference = $decision['notificationReference'];
    $verb = $decision['price'] > $reference ? 'ha subido' : 'ha bajado';
    $url = vuelotel_alert_open_url($alert['id']);
    $escape = function($value) { return htmlspecialchars((string) $value, ENT_QUOTES, 'UTF-8'); };
    $link = $escape($url);
    $html = '<h2>' . $escape($alert['label']) . '</h2><p>El precio ' . $verb . ' de <strong>' . number_format($reference, 0, ',', '.')
        . ' €</strong> a <strong>' . number_format($decision['price'], 0, ',', '.') . ' €</strong>.</p><p>Tu alerta seguirá activa hasta '
        . date('d/m/Y', (int) $alert['expires_at']) . '.</p><p><a href="' . $link . '" style="display:inline-block;padding:12px 18px;background:#123f49;color:#fff;text-decoration:none;border-radius:8px">Abrir búsqueda</a></p>'
        . '<p>Accede con la misma cuenta de Rumbiva para abrir esta búsqueda. Los precios son de referencia; vuelve a consultar para comprobarlos.</p>'
        . '<p>Si el botón no se abre, copia este enlace en tu navegador:<br><a href="' . $link . '">' . $link . '</a></p>';
    return array('subject' => 'El precio ' . $verb . ' · ' . preg_replace('/[\r\n]+/', ' ', (string) $alert['label']), 'html' => $html,
        'text' => 'Abrir búsqueda: ' . $url);
}
function vuelotel_set_alert_conditions($db, $alert, $conditions, $resetBaseline = false) {
    $old = vuelotel_alert_conditions($alert);
    $changed = $old['mode'] !== $conditions['mode'] || $old['targetPrice'] != $conditions['targetPrice']
        || $old['minDropPercent'] != $conditions['minDropPercent'] || $old['notificationHours'] !== $conditions['notificationHours'];
    $db->prepare('UPDATE alerts SET condition_mode=?,target_price=?,min_drop_percent=?,notify_cooldown_hours=?,notify_reference_price=?,notify_pending=?,pending_reference_price=?,pending_notification_id=? WHERE id=? AND user_id=?')
        ->execute(array($conditions['mode'], $conditions['targetPrice'], $conditions['minDropPercent'], $conditions['notificationHours'],
            $resetBaseline ? null : ($changed ? $alert['last_price'] : ($alert['notify_reference_price'] ?? null)),
            $changed || $resetBaseline ? 0 : (int) ($alert['notify_pending'] ?? 0),
            $changed || $resetBaseline ? null : ($alert['pending_reference_price'] ?? null),
            $changed || $resetBaseline ? null : ($alert['pending_notification_id'] ?? null), $alert['id'], $alert['user_id']));
}
function vuelotel_alert_history($db, $userId, $id, $beforeId = 0) {
    if (!vuelotel_owned_alert($db, $userId, $id)) return null;
    $statement = $db->prepare('SELECT * FROM alert_checks WHERE alert_id=?' . ($beforeId > 0 ? ' AND id<?' : '') . ' ORDER BY id DESC LIMIT 51');
    $statement->execute($beforeId > 0 ? array($id, $beforeId) : array($id)); $rows = $statement->fetchAll(); $more = count($rows) > 50; $rows = array_slice($rows, 0, 50);
    $checks = array_map(function($row) { return array('id' => (int) $row['id'], 'alertId' => (int) $row['alert_id'], 'checkedAt' => (int) $row['checked_at'],
        'price' => $row['price'], 'oldPrice' => $row['previous_price'], 'referencePrice' => $row['reference_price'], 'currency' => $row['currency'],
        'direction' => $row['direction'], 'status' => $row['status'], 'mailStatus' => $row['mail_status'], 'error' => $row['error'], 'notified' => (bool) $row['notified']); }, $rows);
    return array('checks' => $checks, 'nextBeforeId' => $more ? (int) end($rows)['id'] : null);
}

function vuelotel_notifications($db, $userId, $afterId = null, $limit = 50) {
    $statement = $db->prepare('SELECT COALESCE(MAX(id),0) FROM alert_notifications WHERE user_id=?'); $statement->execute(array($userId)); $newest = (int) $statement->fetchColumn();
    if ($afterId === null) return array('notifications' => array(), 'newestId' => $newest, 'hasMore' => false);
    $limit = max(1, min(50, (int) $limit));
    $statement = $db->prepare("SELECT n.* FROM alert_notifications n JOIN alerts a ON a.id=n.alert_id AND a.user_id=n.user_id WHERE n.user_id=? AND n.id>? AND n.direction='down' ORDER BY n.id LIMIT ?");
    $statement->bindValue(1, $userId, PDO::PARAM_INT); $statement->bindValue(2, max(0, (int) $afterId), PDO::PARAM_INT); $statement->bindValue(3, $limit + 1, PDO::PARAM_INT); $statement->execute();
    $rows = $statement->fetchAll(); $more = count($rows) > $limit; $rows = array_slice($rows, 0, $limit);
    foreach ($rows as $row) $newest = max($newest, (int) $row['id']);
    return array('notifications' => array_map(function($row) { return array('id' => (int) $row['id'], 'alertId' => (int) $row['alert_id'], 'label' => $row['label'],
        'oldPrice' => $row['old_price'], 'price' => $row['price'], 'currency' => $row['currency'], 'direction' => $row['direction'],
        'createdAt' => (int) $row['created_at'], 'readAt' => $row['read_at'], 'mailStatus' => $row['mail_status']); }, $rows), 'newestId' => max($newest, (int) $afterId), 'hasMore' => $more);
}
