<?php
require_once __DIR__ . '/bootstrap.php';

$vuelotelOrigin = (string) ($_SERVER['HTTP_ORIGIN'] ?? '');
if (in_array($vuelotelOrigin, array('http://localhost', 'https://localhost', 'capacitor://localhost'), true)) {
    header('Access-Control-Allow-Origin: ' . $vuelotelOrigin);
    header('Access-Control-Allow-Credentials: true');
    header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Vuelotel-Cron');
    header('Vary: Origin');
}
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') { http_response_code(204); exit; }

function vuelotel_json($status, $body) {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function vuelotel_body() {
    $raw = file_get_contents('php://input');
    if ($raw === false || strlen($raw) > 100000) vuelotel_json(400, array('error' => 'Petición no válida.'));
    $body = json_decode($raw, true);
    if (!is_array($body)) vuelotel_json(400, array('error' => 'Petición no válida.'));
    return $body;
}

function vuelotel_data_dir() {
    $custom = getenv('VUELOTEL_DATA_PATH');
    return is_string($custom) && trim($custom) !== '' ? trim($custom) : dirname(hotelio_config_path()) . DIRECTORY_SEPARATOR . '.vuelotel-data';
}

function vuelotel_db() {
    static $db = null;
    if ($db instanceof PDO) return $db;
    $dir = vuelotel_data_dir();
    if (!is_dir($dir) && !mkdir($dir, 0700, true)) vuelotel_json(503, array('error' => 'No se pudo preparar el almacenamiento privado.'));
    @chmod($dir, 0700);
    if (!is_file($dir . DIRECTORY_SEPARATOR . '.htaccess')) @file_put_contents($dir . DIRECTORY_SEPARATOR . '.htaccess', "Require all denied\nDeny from all\n", LOCK_EX);
    $db = new PDO('sqlite:' . $dir . DIRECTORY_SEPARATOR . 'vuelotel.sqlite');
    $db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $db->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
    $db->exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000');
    vuelotel_schema($db);
    vuelotel_seed_admin($db);
    return $db;
}

function vuelotel_schema($db) {
    $db->exec("CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL DEFAULT '',
      password_hash TEXT NOT NULL, password_scheme TEXT NOT NULL DEFAULT 'php', password_salt TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT 'user', status TEXT NOT NULL DEFAULT 'active',
      reset_token_hash TEXT, reset_expires_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, last_login_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, token_hash TEXT NOT NULL UNIQUE,
      expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS favorites (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, type TEXT NOT NULL, label TEXT NOT NULL,
      payload_json TEXT NOT NULL, fingerprint TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      UNIQUE(user_id, fingerprint), FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS saved_searches (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, type TEXT NOT NULL, label TEXT NOT NULL,
      filters_json TEXT NOT NULL, last_price REAL, currency TEXT NOT NULL DEFAULT 'EUR', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, saved_search_id INTEGER, type TEXT NOT NULL, label TEXT NOT NULL,
      query_json TEXT NOT NULL, frequency_hours INTEGER NOT NULL, last_price REAL, currency TEXT NOT NULL DEFAULT 'EUR',
      last_checked_at INTEGER, next_check_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1,
      last_status TEXT, last_error TEXT, last_notified_at INTEGER,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE, FOREIGN KEY(saved_search_id) REFERENCES saved_searches(id) ON DELETE SET NULL
    );
    CREATE TABLE IF NOT EXISTS price_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT, alert_id INTEGER NOT NULL, price REAL NOT NULL, currency TEXT NOT NULL,
      direction TEXT NOT NULL, checked_at INTEGER NOT NULL, FOREIGN KEY(alert_id) REFERENCES alerts(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS mail_log (id INTEGER PRIMARY KEY AUTOINCREMENT, recipient TEXT NOT NULL, subject TEXT NOT NULL, success INTEGER NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT OR IGNORE INTO app_settings(key,value) VALUES ('public_registration','1');
    INSERT OR IGNORE INTO app_settings(key,value) VALUES ('max_alerts_per_user','5');");
    $alertColumns = $db->query('PRAGMA table_info(alerts)')->fetchAll();
    $existingColumns = array_column($alertColumns, 'name');
    foreach (array('last_status' => 'TEXT', 'last_error' => 'TEXT', 'last_notified_at' => 'INTEGER') as $column => $type) {
        if (!in_array($column, $existingColumns, true)) $db->exec('ALTER TABLE alerts ADD COLUMN ' . $column . ' ' . $type);
    }
}

function vuelotel_seed_admin($db) {
    $count = (int) $db->query('SELECT COUNT(*) FROM users')->fetchColumn();
    if ($count > 0) return;
    $config = hotelio_config();
    $hash = (string) ($config['admin_password_hash'] ?? '');
    $salt = (string) ($config['admin_password_salt'] ?? '');
    $scheme = $hash !== '' && $salt !== '' ? 'legacy_pbkdf2' : 'php';
    if ($scheme === 'php') $hash = password_hash(bin2hex(random_bytes(24)), PASSWORD_DEFAULT);
    $now = time();
    $statement = $db->prepare('INSERT INTO users(email,display_name,password_hash,password_scheme,password_salt,role,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)');
    $statement->execute(array('mblazquezm@gmail.com', 'Administrador', $hash, $scheme, $salt, 'admin', 'active', $now, $now));
}

function vuelotel_setting($key, $default = null) {
    $statement = vuelotel_db()->prepare('SELECT value FROM app_settings WHERE key=?');
    $statement->execute(array($key));
    $value = $statement->fetchColumn();
    return $value === false ? $default : $value;
}

function vuelotel_token() { return bin2hex(random_bytes(32)); }
function vuelotel_hash_token($token) { return hash('sha256', $token); }

function vuelotel_bearer() {
    $header = $_SERVER['HTTP_AUTHORIZATION'] ?? ($_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '');
    if ($header === '' && function_exists('getallheaders')) {
        $headers = getallheaders();
        $header = (string) ($headers['Authorization'] ?? ($headers['authorization'] ?? ''));
    }
    if (preg_match('/^Bearer\s+(.+)$/i', $header, $match)) return trim($match[1]);
    return isset($_COOKIE['vuelotel_session']) ? (string) $_COOKIE['vuelotel_session'] : '';
}

function vuelotel_current_user($required = true) {
    $token = vuelotel_bearer();
    if ($token === '') { if ($required) vuelotel_json(401, array('error' => 'Inicia sesión para continuar.')); return null; }
    $db = vuelotel_db();
    $statement = $db->prepare('SELECT u.id,u.email,u.display_name,u.role,u.status,s.id session_id FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?');
    $statement->execute(array(vuelotel_hash_token($token), time()));
    $user = $statement->fetch();
    if (!$user || $user['status'] !== 'active') { if ($required) vuelotel_json(401, array('error' => 'La sesión ha caducado.')); return null; }
    $db->prepare('UPDATE sessions SET last_seen_at=? WHERE id=?')->execute(array(time(), $user['session_id']));
    unset($user['session_id'], $user['status']);
    return $user;
}

function vuelotel_require_admin() {
    $user = vuelotel_current_user();
    if ($user['role'] !== 'admin') vuelotel_json(403, array('error' => 'Acceso reservado al administrador.'));
    return $user;
}

function vuelotel_public_user($user) {
    return array('id' => (int) $user['id'], 'email' => $user['email'], 'displayName' => $user['display_name'], 'role' => $user['role']);
}

function vuelotel_verify_password($password, $user) {
    if (($user['password_scheme'] ?? 'php') === 'legacy_pbkdf2') {
        $candidate = hash_pbkdf2('sha256', $password, $user['password_salt'], 210000, 64);
        return hash_equals($user['password_hash'], $candidate);
    }
    return password_verify($password, $user['password_hash']);
}

function vuelotel_issue_session($userId) {
    $db = vuelotel_db(); $token = vuelotel_token(); $now = time();
    $db->prepare('DELETE FROM sessions WHERE expires_at<=?')->execute(array($now));
    $db->prepare('INSERT INTO sessions(user_id,token_hash,expires_at,created_at,last_seen_at) VALUES(?,?,?,?,?)')->execute(array($userId, vuelotel_hash_token($token), $now + 2592000, $now, $now));
    setcookie('vuelotel_session', $token, array('expires' => $now + 2592000, 'path' => '/', 'secure' => !empty($_SERVER['HTTPS']), 'httponly' => true, 'samesite' => 'Lax'));
    return $token;
}

function vuelotel_send_mail($to, $subject, $html) {
    $config = hotelio_config();
    $from = filter_var($config['mail']['from'] ?? '', FILTER_VALIDATE_EMAIL) ?: 'no-reply@alufi.es';
    $headers = "MIME-Version: 1.0\r\nContent-Type: text/html; charset=UTF-8\r\nFrom: Rumbiva <" . $from . ">\r\n";
    $success = @mail($to, $subject, $html, $headers);
    try { vuelotel_db()->prepare('INSERT INTO mail_log(recipient,subject,success,created_at) VALUES(?,?,?,?)')->execute(array($to, $subject, $success ? 1 : 0, time())); } catch (Exception $ignored) {}
    return $success;
}

function vuelotel_app_url($path = '') {
    return 'https://www.alufi.es/vuelotel/' . ltrim($path, '/');
}
