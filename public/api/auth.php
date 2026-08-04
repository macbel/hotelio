<?php
require_once __DIR__ . '/user-bootstrap.php';

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($method === 'GET') {
    $user = vuelotel_current_user(false);
    vuelotel_json(200, array('authenticated' => $user !== null, 'user' => $user ? vuelotel_public_user($user) : null, 'registrationEnabled' => vuelotel_setting('public_registration', '1') === '1'));
}
if ($method !== 'POST') vuelotel_json(405, array('error' => 'Método no permitido.'));
$body = vuelotel_body(); $action = (string) ($body['action'] ?? ''); $db = vuelotel_db(); $now = time();

if ($action === 'login') {
    $email = strtolower(trim((string) ($body['email'] ?? ''))); $password = (string) ($body['password'] ?? '');
    $statement = $db->prepare('SELECT * FROM users WHERE email=?'); $statement->execute(array($email)); $user = $statement->fetch();
    if (!$user || $user['status'] !== 'active' || !vuelotel_verify_password($password, $user)) vuelotel_json(401, array('error' => 'Correo o contraseña incorrectos.'));
    if ($user['password_scheme'] !== 'php') $db->prepare("UPDATE users SET password_hash=?,password_scheme='php',password_salt='',updated_at=? WHERE id=?")->execute(array(password_hash($password, PASSWORD_DEFAULT), $now, $user['id']));
    $db->prepare('UPDATE users SET last_login_at=? WHERE id=?')->execute(array($now, $user['id']));
    $token = vuelotel_issue_session($user['id']);
    vuelotel_json(200, array('token' => $token, 'user' => vuelotel_public_user($user)));
}

if ($action === 'register') {
    if (vuelotel_setting('public_registration', '1') !== '1') vuelotel_json(403, array('error' => 'El registro público está desactivado.'));
    $email = strtolower(trim((string) ($body['email'] ?? ''))); $name = trim((string) ($body['displayName'] ?? '')); $password = (string) ($body['password'] ?? '');
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) vuelotel_json(400, array('error' => 'Introduce un correo válido.'));
    if (strlen($password) < 10) vuelotel_json(400, array('error' => 'La contraseña debe tener al menos 10 caracteres.'));
    try { $db->prepare('INSERT INTO users(email,display_name,password_hash,role,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')->execute(array($email, mb_substr($name,0,80), password_hash($password,PASSWORD_DEFAULT), 'user','active',$now,$now)); }
    catch (PDOException $error) { vuelotel_json(409, array('error' => 'Ya existe una cuenta con ese correo.')); }
    $id = (int) $db->lastInsertId(); $token = vuelotel_issue_session($id);
    vuelotel_json(201, array('token'=>$token,'user'=>array('id'=>$id,'email'=>$email,'displayName'=>$name,'role'=>'user')));
}

if ($action === 'logout') {
    $token = vuelotel_bearer(); if ($token !== '') $db->prepare('DELETE FROM sessions WHERE token_hash=?')->execute(array(vuelotel_hash_token($token)));
    setcookie('vuelotel_session','',array('expires'=>1,'path'=>'/','secure'=>!empty($_SERVER['HTTPS']),'httponly'=>true,'samesite'=>'Lax'));
    vuelotel_json(200, array('ok'=>true));
}

if ($action === 'request_reset') {
    $email = strtolower(trim((string) ($body['email'] ?? ''))); $statement=$db->prepare("SELECT id,email FROM users WHERE email=? AND status='active'"); $statement->execute(array($email)); $user=$statement->fetch();
    if ($user) { $token=vuelotel_token(); $db->prepare('UPDATE users SET reset_token_hash=?,reset_expires_at=?,updated_at=? WHERE id=?')->execute(array(vuelotel_hash_token($token),$now+3600,$now,$user['id'])); $link=vuelotel_app_url('?reset='.rawurlencode($token)); vuelotel_send_mail($user['email'],'Recupera tu contraseña de Vuelotel','<p>Usa este enlace durante la próxima hora:</p><p><a href="'.htmlspecialchars($link,ENT_QUOTES,'UTF-8').'">Crear una nueva contraseña</a></p>'); }
    vuelotel_json(200,array('ok'=>true,'message'=>'Si la cuenta existe, recibirá un enlace de recuperación.'));
}

if ($action === 'reset') {
    $token=(string)($body['token']??''); $password=(string)($body['password']??''); if(strlen($password)<10)vuelotel_json(400,array('error'=>'La contraseña debe tener al menos 10 caracteres.'));
    $statement=$db->prepare('SELECT id FROM users WHERE reset_token_hash=? AND reset_expires_at>?');$statement->execute(array(vuelotel_hash_token($token),$now));$id=$statement->fetchColumn();
    if(!$id)vuelotel_json(400,array('error'=>'El enlace no es válido o ha caducado.'));
    $db->prepare("UPDATE users SET password_hash=?,password_scheme='php',password_salt='',reset_token_hash=NULL,reset_expires_at=NULL,updated_at=? WHERE id=?")->execute(array(password_hash($password,PASSWORD_DEFAULT),$now,$id));
    $db->prepare('DELETE FROM sessions WHERE user_id=?')->execute(array($id)); vuelotel_json(200,array('ok'=>true));
}
vuelotel_json(400,array('error'=>'Acción no válida.'));
