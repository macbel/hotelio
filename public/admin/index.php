<?php
declare(strict_types=1);

session_set_cookie_params(array(
    'httponly' => true,
    'secure' => !empty($_SERVER['HTTPS']),
    'samesite' => 'Strict'
));
session_start();
header('X-Robots-Tag: noindex, nofollow');
header("Content-Security-Policy: default-src 'self'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
header('X-Frame-Options: DENY');
header('Referrer-Policy: no-referrer');
header('Cache-Control: no-store');
require_once dirname(__DIR__) . '/api/bootstrap.php';

const HOTELIO_PASSWORD_ITERATIONS = 210000;
const HOTELIO_RESET_LIFETIME = 3600;
const HOTELIO_RESET_COOLDOWN = 600;

function admin_escape($value) {
    return htmlspecialchars((string) $value, ENT_QUOTES, 'UTF-8');
}

function admin_csrf_is_valid() {
    $expected = (string) ($_SESSION['csrf'] ?? '');
    $received = (string) ($_POST['csrf'] ?? '');
    return $expected !== '' && $received !== '' && hash_equals($expected, $received);
}

function admin_password_matches($password, $config) {
    $hash = (string) ($config['admin_password_hash'] ?? '');
    $salt = (string) ($config['admin_password_salt'] ?? '');
    if ($hash === '' || $salt === '') return false;
    $candidate = hash_pbkdf2('sha256', (string) $password, $salt, HOTELIO_PASSWORD_ITERATIONS, 64);
    return hash_equals($hash, $candidate);
}

function admin_password_error($password, $confirmation) {
    if ((string) $password !== (string) $confirmation) return 'Las dos contraseñas nuevas no coinciden.';
    $length = strlen((string) $password);
    if ($length < 12) return 'La contraseña nueva debe tener al menos 12 caracteres.';
    if ($length > 200) return 'La contraseña nueva es demasiado larga.';
    return '';
}

function admin_store_password(&$config, $password) {
    $config['admin_password_salt'] = bin2hex(random_bytes(24));
    $config['admin_password_hash'] = hash_pbkdf2(
        'sha256',
        (string) $password,
        $config['admin_password_salt'],
        HOTELIO_PASSWORD_ITERATIONS,
        64
    );
    $config['password_reset'] = array('token_hash' => '', 'expires_at' => 0, 'requested_at' => 0);
}

function admin_reset_token_is_valid($token, $config) {
    if (!is_string($token) || !preg_match('/^[a-f0-9]{64}$/', $token)) return false;
    $reset = isset($config['password_reset']) && is_array($config['password_reset']) ? $config['password_reset'] : array();
    $storedHash = (string) ($reset['token_hash'] ?? '');
    $expiresAt = (int) ($reset['expires_at'] ?? 0);
    return $storedHash !== '' && $expiresAt >= time() && hash_equals($storedHash, hash('sha256', $token));
}

function admin_send_reset_email($email, $token) {
    if (!function_exists('mail')) return false;
    $url = 'https://www.alufi.es/hotelio/admin/?reset=' . rawurlencode($token);
    $subject = 'Restablecer la contraseña de Hotelio';
    $encodedSubject = '=?UTF-8?B?' . base64_encode($subject) . '?=';
    $body = "Se ha solicitado cambiar la contraseña del panel privado de Hotelio.\n\n";
    $body .= "Crea una contraseña nueva desde este enlace:\n" . $url . "\n\n";
    $body .= "El enlace caduca en 1 hora y solo puede utilizarse una vez.\n";
    $body .= "Si no has solicitado el cambio, ignora este mensaje.\n";
    $headers = array(
        'From: Hotelio <no-reply@alufi.es>',
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=UTF-8',
        'Content-Transfer-Encoding: 8bit'
    );
    return @mail((string) $email, $encodedSubject, $body, implode("\r\n", $headers));
}

if (empty($_SESSION['csrf'])) $_SESSION['csrf'] = bin2hex(random_bytes(24));

$config = hotelio_config();
$message = (string) ($_SESSION['flash_message'] ?? '');
$error = (string) ($_SESSION['flash_error'] ?? '');
unset($_SESSION['flash_message'], $_SESSION['flash_error']);

if (isset($_GET['logout'])) {
    $_SESSION = array();
    session_destroy();
    header('Location: ./');
    exit;
}

$authenticated = !empty($_SESSION['hotelio_admin']);
$resetToken = trim((string) ($_GET['reset'] ?? ($_POST['reset_token'] ?? '')));

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (!admin_csrf_is_valid()) {
        $error = 'La sesión ha caducado. Recarga la página.';
    } elseif (isset($_POST['login'])) {
        if (admin_password_matches((string) ($_POST['password'] ?? ''), $config)) {
            session_regenerate_id(true);
            $_SESSION['hotelio_admin'] = true;
            $_SESSION['csrf'] = bin2hex(random_bytes(24));
            header('Location: ./');
            exit;
        }
        $error = 'Contraseña incorrecta.';
    } elseif (isset($_POST['forgot_password'])) {
        $requestedEmail = strtolower(trim((string) ($_POST['email'] ?? '')));
        $adminEmail = strtolower(trim((string) ($config['admin_email'] ?? '')));
        $lastRequest = (int) ($config['password_reset']['requested_at'] ?? 0);
        $canRequest = time() - $lastRequest >= HOTELIO_RESET_COOLDOWN;

        if ($adminEmail !== '' && filter_var($adminEmail, FILTER_VALIDATE_EMAIL) && hash_equals($adminEmail, $requestedEmail) && $canRequest) {
            $token = bin2hex(random_bytes(32));
            $config['password_reset'] = array(
                'token_hash' => hash('sha256', $token),
                'expires_at' => time() + HOTELIO_RESET_LIFETIME,
                'requested_at' => time()
            );
            if (hotelio_write_config($config)) {
                if (!admin_send_reset_email($adminEmail, $token)) error_log('Hotelio: el servidor no pudo enviar el correo de recuperación.');
                $config = hotelio_config();
            } else {
                error_log('Hotelio: no se pudo guardar el token de recuperación.');
            }
        }
        $message = 'Si el correo coincide con el configurado, recibirás un enlace válido durante 1 hora. Revisa también la carpeta de spam.';
    } elseif (isset($_POST['reset_password'])) {
        if (!admin_reset_token_is_valid($resetToken, $config)) {
            $error = 'El enlace de recuperación no es válido o ya ha caducado.';
        } else {
            $newPassword = (string) ($_POST['new_password'] ?? '');
            $passwordError = admin_password_error($newPassword, (string) ($_POST['confirm_password'] ?? ''));
            if ($passwordError !== '') {
                $error = $passwordError;
            } else {
                admin_store_password($config, $newPassword);
                if (hotelio_write_config($config)) {
                    $_SESSION = array('csrf' => bin2hex(random_bytes(24)));
                    $authenticated = false;
                    $resetToken = '';
                    $config = hotelio_config();
                    $message = 'Contraseña actualizada. Ya puedes entrar con la nueva.';
                } else {
                    $error = 'No se pudo guardar la contraseña nueva.';
                }
            }
        }
    } elseif ($authenticated && isset($_POST['save_providers'])) {
        $adminEmail = strtolower(trim((string) ($_POST['admin_email'] ?? ($config['admin_email'] ?? ''))));
        if (!filter_var($adminEmail, FILTER_VALIDATE_EMAIL)) {
            $error = 'Indica un correo de recuperación válido.';
        } else {
        $newKey = trim((string) ($_POST['serpapi_key'] ?? ''));
        $storedKey = (string) ($config['providers']['serpapi']['api_key'] ?? '');
        if ($newKey !== '') $storedKey = $newKey;
        if (!empty($_POST['remove_serpapi'])) $storedKey = '';
        $config['admin_email'] = $adminEmail;
        $config['providers']['stay22'] = array('enabled' => !empty($_POST['stay22_enabled']), 'aid' => 'hotelio');
        $config['providers']['serpapi'] = array('enabled' => !empty($_POST['serpapi_enabled']) && $storedKey !== '', 'api_key' => $storedKey);
        $config['flights'] = array(
            'enabled' => !empty($_POST['flights_enabled']),
            'cache_ttl' => 3600,
            'monthly_limit' => max(1, min(240, (int) ($_POST['flights_monthly_limit'] ?? 120))),
            'per_ip_hourly_limit' => max(1, min(30, (int) ($_POST['flights_hourly_limit'] ?? 8)))
        );
        if (hotelio_write_config($config)) {
            $_SESSION['flash_message'] = 'Configuración guardada. Ya se aplica a la web y al APK.';
            header('Location: ./');
            exit;
        }
        $error = 'No se pudo escribir el archivo privado de configuración.';
        }
    } elseif ($authenticated && isset($_POST['change_password'])) {
        $currentPassword = (string) ($_POST['current_password'] ?? '');
        $newPassword = (string) ($_POST['new_password'] ?? '');
        if (!admin_password_matches($currentPassword, $config)) {
            $error = 'La contraseña actual no es correcta.';
        } elseif (hash_equals($currentPassword, $newPassword)) {
            $error = 'La contraseña nueva debe ser distinta de la actual.';
        } else {
            $passwordError = admin_password_error($newPassword, (string) ($_POST['confirm_password'] ?? ''));
            if ($passwordError !== '') {
                $error = $passwordError;
            } else {
                admin_store_password($config, $newPassword);
                if (hotelio_write_config($config)) {
                    session_regenerate_id(true);
                    $_SESSION['csrf'] = bin2hex(random_bytes(24));
                    $_SESSION['flash_message'] = 'Contraseña cambiada correctamente.';
                    header('Location: ./');
                    exit;
                }
                $error = 'No se pudo guardar la contraseña nueva.';
            }
        }
    }
}

$authenticated = !empty($_SESSION['hotelio_admin']);
$configured = (string) ($config['admin_password_hash'] ?? '') !== '';
$hasResetToken = $resetToken !== '';
$validResetToken = $hasResetToken && admin_reset_token_is_valid($resetToken, $config);
?>
<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Administración · Hotelio</title>
  <style>
    :root{font-family:system-ui,sans-serif;color:#102a2e;background:#f5f2eb}*{box-sizing:border-box}body{margin:0;padding:30px 16px}.panel{max-width:680px;margin:auto;background:#fff;border:1px solid #d9ded8;border-radius:22px;padding:26px;box-shadow:0 18px 55px #284d4a18}h1{margin:0 0 7px;font-size:28px}h2{font-size:19px;margin:0 0 6px}p{color:#647678;line-height:1.5}.card{border:1px solid #e0e4df;border-radius:15px;padding:16px;margin:15px 0}.row{display:flex;justify-content:space-between;gap:14px;align-items:center}.field{display:grid;gap:6px;margin:14px 0;font-weight:700;font-size:13px}.field input{width:100%;padding:12px;border:1px solid #bfc9c4;border-radius:10px;font:inherit}input[type=checkbox]{width:19px;height:19px;accent-color:#df6c57}button,.button{border:0;border-radius:11px;padding:12px 17px;background:#102a2e;color:#fff;font-weight:700;text-decoration:none;display:inline-block;cursor:pointer}.logout,.secondary{background:#edf3f0;color:#102a2e}.message{padding:11px;border-radius:10px;background:#e7f5ec;color:#225f45}.error{padding:11px;border-radius:10px;background:#f9e2de;color:#8e3526}.muted{font-size:12px}.actions{display:flex;justify-content:space-between;gap:12px;align-items:center;margin-top:18px}.stack{display:grid;gap:10px}.forgot{margin-top:18px;border-top:1px solid #e0e4df;padding-top:14px}.forgot summary{cursor:pointer;font-weight:700;color:#315d5d}.email{font-weight:700;color:#315d5d;word-break:break-all}@media(max-width:520px){.row{align-items:flex-start}.panel{padding:20px}.actions{align-items:stretch;flex-direction:column}.actions .button,.actions button{text-align:center;width:100%}}
  </style>
</head>
<body>
<main class="panel">
  <h1>Panel privado de Hotelio</h1>
  <p>Configuración común para la web y el APK. Las claves y la cuenta de administración permanecen en el servidor.</p>
  <?php if ($message !== ''): ?><p class="message"><?= admin_escape($message) ?></p><?php endif; ?>
  <?php if ($error !== ''): ?><p class="error"><?= admin_escape($error) ?></p><?php endif; ?>

  <?php if (!$configured): ?>
    <p class="error">El administrador todavía no está inicializado. Crea el archivo privado <code>.hotelio-config.php</code> fuera de la carpeta <code>/hotelio</code>.</p>
  <?php elseif ($hasResetToken && !$validResetToken): ?>
    <p class="error">El enlace de recuperación no es válido, ya se utilizó o ha caducado.</p>
    <a class="button secondary" href="./">Volver al acceso</a>
  <?php elseif ($validResetToken): ?>
    <section class="card">
      <h2>Crear una contraseña nueva</h2>
      <p class="muted">Debe tener al menos 12 caracteres. Al guardarla, este enlace dejará de funcionar.</p>
      <form method="post" class="stack">
        <input type="hidden" name="csrf" value="<?= admin_escape($_SESSION['csrf']) ?>">
        <input type="hidden" name="reset_token" value="<?= admin_escape($resetToken) ?>">
        <label class="field">Contraseña nueva<input type="password" name="new_password" minlength="12" maxlength="200" required autocomplete="new-password"></label>
        <label class="field">Repetir contraseña nueva<input type="password" name="confirm_password" minlength="12" maxlength="200" required autocomplete="new-password"></label>
        <button type="submit" name="reset_password" value="1">Guardar contraseña nueva</button>
      </form>
    </section>
  <?php elseif (!$authenticated): ?>
    <form method="post">
      <input type="hidden" name="csrf" value="<?= admin_escape($_SESSION['csrf']) ?>">
      <label class="field">Contraseña de administración<input type="password" name="password" required autocomplete="current-password"></label>
      <button type="submit" name="login" value="1">Entrar</button>
    </form>
    <details class="forgot">
      <summary>He olvidado la contraseña</summary>
      <p class="muted">Te enviaremos un enlace temporal para elegir otra. Por seguridad, nunca se envía la contraseña existente.</p>
      <form method="post">
        <input type="hidden" name="csrf" value="<?= admin_escape($_SESSION['csrf']) ?>">
        <label class="field">Correo de recuperación<input type="email" name="email" required autocomplete="email" placeholder="tu-correo@ejemplo.com"></label>
        <button class="secondary" type="submit" name="forgot_password" value="1">Enviar enlace</button>
      </form>
    </details>
  <?php else: ?>
    <form method="post">
      <input type="hidden" name="csrf" value="<?= admin_escape($_SESSION['csrf']) ?>">
      <section class="card">
        <h2>Cuenta de administración</h2>
        <label class="field">Correo de recuperación<input type="email" name="admin_email" required autocomplete="email" value="<?= admin_escape($config['admin_email'] ?? '') ?>" placeholder="tu-correo@ejemplo.com"></label>
        <p class="muted">Los enlaces temporales para restablecer la contraseña se enviarán a esta dirección.</p>
      </section>
      <section class="card">
        <div class="row"><div><strong>Stay22</strong><p class="muted">Partner ID fijo: hotelio</p></div><input type="checkbox" name="stay22_enabled" value="1" <?= !empty($config['providers']['stay22']['enabled']) ? 'checked' : '' ?> aria-label="Activar Stay22"></div>
      </section>
      <section class="card">
        <div class="row"><div><strong>SerpApi · Google Hotels</strong><p class="muted"><?= !empty($config['providers']['serpapi']['api_key']) ? 'Clave configurada en el servidor' : 'Clave todavía no configurada' ?></p></div><input type="checkbox" name="serpapi_enabled" value="1" <?= !empty($config['providers']['serpapi']['enabled']) ? 'checked' : '' ?> aria-label="Activar SerpApi"></div>
        <label class="field">Nueva API key (déjalo vacío para conservarla)<input type="password" name="serpapi_key" autocomplete="new-password" placeholder="Pega aquí tu clave de SerpApi"></label>
        <?php if (!empty($config['providers']['serpapi']['api_key'])): ?><label class="row muted"><span>Eliminar la clave guardada</span><input type="checkbox" name="remove_serpapi" value="1"></label><?php endif; ?>
      </section>
      <section class="card">
        <div class="row"><div><strong>Vuelos · Google Flights</strong><p class="muted">Usa la misma clave privada de SerpApi. Caché fija de 1 hora.</p></div><input type="checkbox" name="flights_enabled" value="1" <?= !empty($config['flights']['enabled']) ? 'checked' : '' ?> aria-label="Activar buscador de vuelos"></div>
        <label class="field">Máximo de búsquedas de vuelos al mes<input type="number" name="flights_monthly_limit" min="1" max="240" value="<?= admin_escape($config['flights']['monthly_limit'] ?? 120) ?>"></label>
        <label class="field">Máximo por usuario y hora<input type="number" name="flights_hourly_limit" min="1" max="30" value="<?= admin_escape($config['flights']['per_ip_hourly_limit'] ?? 8) ?>"></label>
        <p class="muted">El plan gratuito actual de SerpApi ofrece 250 búsquedas mensuales compartidas entre hoteles y vuelos. Hotelio reserva margen limitando los vuelos a 120.</p>
      </section>
      <div class="actions"><a class="button logout" href="?logout=1">Cerrar sesión</a><button type="submit" name="save_providers" value="1">Guardar proveedores</button></div>
    </form>

    <section class="card">
      <h2>Seguridad del panel</h2>
      <p class="muted">Correo de recuperación: <span class="email"><?= admin_escape($config['admin_email'] ?: 'No configurado') ?></span></p>
      <form method="post" class="stack">
        <input type="hidden" name="csrf" value="<?= admin_escape($_SESSION['csrf']) ?>">
        <label class="field">Contraseña actual<input type="password" name="current_password" required autocomplete="current-password"></label>
        <label class="field">Contraseña nueva<input type="password" name="new_password" minlength="12" maxlength="200" required autocomplete="new-password"></label>
        <label class="field">Repetir contraseña nueva<input type="password" name="confirm_password" minlength="12" maxlength="200" required autocomplete="new-password"></label>
        <button type="submit" name="change_password" value="1">Cambiar contraseña</button>
      </form>
    </section>
  <?php endif; ?>
</main>
</body>
</html>
