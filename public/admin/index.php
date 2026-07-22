<?php
declare(strict_types=1);
session_set_cookie_params(array('httponly' => true, 'secure' => !empty($_SERVER['HTTPS']), 'samesite' => 'Strict'));
session_start();
header('X-Robots-Tag: noindex, nofollow');
header("Content-Security-Policy: default-src 'self'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
header('X-Frame-Options: DENY');
header('Referrer-Policy: no-referrer');
require_once dirname(__DIR__) . '/api/bootstrap.php';

$config = hotelio_config();
$message = '';
$error = '';

if (isset($_GET['logout'])) {
    $_SESSION = array();
    session_destroy();
    header('Location: ./');
    exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['login'])) {
    $password = (string) ($_POST['password'] ?? '');
    $candidate = hash_pbkdf2('sha256', $password, (string) $config['admin_password_salt'], 210000, 64);
    if ($config['admin_password_hash'] !== '' && $config['admin_password_salt'] !== '' && hash_equals($config['admin_password_hash'], $candidate)) {
        session_regenerate_id(true);
        $_SESSION['hotelio_admin'] = true;
        $_SESSION['csrf'] = bin2hex(random_bytes(24));
        header('Location: ./');
        exit;
    }
    $error = 'Contraseña incorrecta.';
}

$authenticated = !empty($_SESSION['hotelio_admin']);
if ($authenticated && $_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['save'])) {
    if (!hash_equals((string) ($_SESSION['csrf'] ?? ''), (string) ($_POST['csrf'] ?? ''))) {
        $error = 'La sesión ha caducado. Recarga la página.';
    } else {
        $newKey = trim((string) ($_POST['serpapi_key'] ?? ''));
        $storedKey = (string) ($config['providers']['serpapi']['api_key'] ?? '');
        if ($newKey !== '') $storedKey = $newKey;
        if (!empty($_POST['remove_serpapi'])) $storedKey = '';
        $config['providers']['stay22'] = array('enabled' => !empty($_POST['stay22_enabled']), 'aid' => 'hotelio');
        $config['providers']['serpapi'] = array('enabled' => !empty($_POST['serpapi_enabled']) && $storedKey !== '', 'api_key' => $storedKey);
        if (hotelio_write_config($config)) {
            $config = hotelio_config();
            $message = 'Configuración guardada. Ya se aplica a la web y al APK.';
        } else {
            $error = 'No se pudo escribir el archivo privado de configuración.';
        }
    }
}

$configured = $config['admin_password_hash'] !== '';
?>
<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Administración · Hotelio</title>
  <style>
    :root{font-family:system-ui,sans-serif;color:#102a2e;background:#f5f2eb}*{box-sizing:border-box}body{margin:0;padding:30px 16px}.panel{max-width:620px;margin:auto;background:#fff;border:1px solid #d9ded8;border-radius:22px;padding:26px;box-shadow:0 18px 55px #284d4a18}h1{margin:0 0 7px;font-size:28px}p{color:#647678;line-height:1.5}.card{border:1px solid #e0e4df;border-radius:15px;padding:16px;margin:15px 0}.row{display:flex;justify-content:space-between;gap:14px;align-items:center}.field{display:grid;gap:6px;margin:14px 0;font-weight:700;font-size:13px}input[type=password]{width:100%;padding:12px;border:1px solid #bfc9c4;border-radius:10px}input[type=checkbox]{width:19px;height:19px;accent-color:#df6c57}button,.button{border:0;border-radius:11px;padding:12px 17px;background:#102a2e;color:#fff;font-weight:700;text-decoration:none;display:inline-block}.logout{background:#edf3f0;color:#102a2e}.message{padding:11px;border-radius:10px;background:#e7f5ec;color:#225f45}.error{padding:11px;border-radius:10px;background:#f9e2de;color:#8e3526}.muted{font-size:12px}.actions{display:flex;justify-content:space-between;align-items:center;margin-top:18px}@media(max-width:520px){.row{align-items:flex-start}.panel{padding:20px}}
  </style>
</head>
<body>
<main class="panel">
  <h1>Proveedores de Hotelio</h1>
  <p>Configuración privada y común para todos los usuarios. Las claves permanecen en el servidor.</p>
  <?php if ($message !== ''): ?><p class="message"><?= htmlspecialchars($message, ENT_QUOTES, 'UTF-8') ?></p><?php endif; ?>
  <?php if ($error !== ''): ?><p class="error"><?= htmlspecialchars($error, ENT_QUOTES, 'UTF-8') ?></p><?php endif; ?>
  <?php if (!$configured): ?>
    <p class="error">El administrador todavía no está inicializado. Crea el archivo privado <code>.hotelio-config.php</code> fuera de la carpeta <code>/hotelio</code>.</p>
  <?php elseif (!$authenticated): ?>
    <form method="post">
      <label class="field">Contraseña de administración<input type="password" name="password" required autocomplete="current-password"></label>
      <button type="submit" name="login" value="1">Entrar</button>
    </form>
  <?php else: ?>
    <form method="post">
      <input type="hidden" name="csrf" value="<?= htmlspecialchars((string) $_SESSION['csrf'], ENT_QUOTES, 'UTF-8') ?>">
      <section class="card">
        <div class="row"><div><strong>Stay22</strong><p class="muted">Partner ID fijo: hotelio</p></div><input type="checkbox" name="stay22_enabled" value="1" <?= !empty($config['providers']['stay22']['enabled']) ? 'checked' : '' ?> aria-label="Activar Stay22"></div>
      </section>
      <section class="card">
        <div class="row"><div><strong>SerpApi · Google Hotels</strong><p class="muted"><?= !empty($config['providers']['serpapi']['api_key']) ? 'Clave configurada en el servidor' : 'Clave todavía no configurada' ?></p></div><input type="checkbox" name="serpapi_enabled" value="1" <?= !empty($config['providers']['serpapi']['enabled']) ? 'checked' : '' ?> aria-label="Activar SerpApi"></div>
        <label class="field">Nueva API key (déjalo vacío para conservarla)<input type="password" name="serpapi_key" autocomplete="new-password" placeholder="Pega aquí tu clave de SerpApi"></label>
        <?php if (!empty($config['providers']['serpapi']['api_key'])): ?><label class="row muted"><span>Eliminar la clave guardada</span><input type="checkbox" name="remove_serpapi" value="1"></label><?php endif; ?>
      </section>
      <div class="actions"><a class="button logout" href="?logout=1">Cerrar sesión</a><button type="submit" name="save" value="1">Guardar configuración</button></div>
    </form>
  <?php endif; ?>
</main>
</body>
</html>
