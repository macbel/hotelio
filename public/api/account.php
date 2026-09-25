<?php
require_once __DIR__ . '/user-bootstrap.php';
$user=vuelotel_current_user();$db=vuelotel_db();$method=$_SERVER['REQUEST_METHOD']??'GET';
if($method==='GET'){
  $result=array();
  foreach(array('favorites','saved_searches','alerts') as $table){$statement=$db->prepare("SELECT * FROM $table WHERE user_id=? ORDER BY created_at DESC");$statement->execute(array($user['id']));$result[$table]=$statement->fetchAll();}
  foreach($result['favorites'] as &$item)$item['payload']=json_decode($item['payload_json'],true);
  foreach($result['saved_searches'] as &$item)$item['filters']=json_decode($item['filters_json'],true);
  foreach($result['alerts'] as &$item)$item['query']=json_decode($item['query_json'],true);
  vuelotel_json(200,array('favorites'=>$result['favorites'],'searches'=>$result['saved_searches'],'alerts'=>$result['alerts']));
}
if($method!=='POST')vuelotel_json(405,array('error'=>'Método no permitido.'));
$body=vuelotel_body();$action=(string)($body['action']??'');$kind=(string)($body['kind']??'');$now=time();
if($action==='delete'){
  $tables=array('favorite'=>'favorites','search'=>'saved_searches','alert'=>'alerts');if(!isset($tables[$kind]))vuelotel_json(400,array('error'=>'Tipo no válido.'));
  $statement=$db->prepare('DELETE FROM '.$tables[$kind].' WHERE id=? AND user_id=?');$statement->execute(array((int)($body['id']??0),$user['id']));vuelotel_json(200,array('ok'=>true));
}
if($action==='save_favorite'){
  $payload=$body['payload']??null;$fingerprint=trim((string)($body['fingerprint']??''));$label=trim((string)($body['label']??'Favorito'));$type=(string)($body['type']??'hotel');
  if(!is_array($payload)||$fingerprint==='')vuelotel_json(400,array('error'=>'Favorito no válido.'));
  $statement=$db->prepare('INSERT INTO favorites(user_id,type,label,payload_json,fingerprint,created_at,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(user_id,fingerprint) DO UPDATE SET label=excluded.label,payload_json=excluded.payload_json,updated_at=excluded.updated_at');
  $statement->execute(array($user['id'],$type,mb_substr($label,0,120),json_encode($payload,JSON_UNESCAPED_UNICODE),mb_substr($fingerprint,0,180),$now,$now));vuelotel_json(201,array('id'=>(int)$db->lastInsertId()));
}
if($action==='save_search'){
  $filters=$body['filters']??null;$type=(string)($body['type']??'hotel');$label=trim((string)($body['label']??'Búsqueda guardada'));if(!is_array($filters)||!in_array($type,array('hotel','flight','combined','destination'),true))vuelotel_json(400,array('error'=>'Búsqueda no válida.'));
  $db->prepare('INSERT INTO saved_searches(user_id,type,label,filters_json,last_price,currency,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)')->execute(array($user['id'],$type,mb_substr($label,0,120),json_encode($filters,JSON_UNESCAPED_UNICODE),isset($body['price'])?(float)$body['price']:null,(string)($body['currency']??'EUR'),$now,$now));vuelotel_json(201,array('id'=>(int)$db->lastInsertId()));
}
if($action==='create_alert'){
  $query=$body['query']??null;$frequency=(int)($body['frequencyHours']??24);$type=(string)($body['type']??'hotel');if(!is_array($query)||!in_array($frequency,array(12,24,72,168),true)||!in_array($type,array('hotel','flight','combined','destination'),true))vuelotel_json(400,array('error'=>'Alerta no válida.'));
  if($type==='destination'){$mode=(string)($body['alertMode']??'lower');$threshold=(float)($body['threshold']??0);if(!in_array($mode,array('lower','threshold'),true)||($mode==='threshold'&&$threshold<=0))vuelotel_json(400,array('error'=>'Configura una condición de alerta válida.'));$query['_alertMode']=$mode;$query['_threshold']=$threshold;$query['_coverageVersion']=2;}
  $count=$db->prepare('SELECT COUNT(*) FROM alerts WHERE user_id=? AND active=1 AND expires_at>?');$count->execute(array($user['id'],$now));if((int)$count->fetchColumn()>=(int)vuelotel_setting('max_alerts_per_user','5'))vuelotel_json(409,array('error'=>'Has alcanzado el máximo de 5 alertas activas.'));
  $label=trim((string)($body['label']??'Alerta de precio'));$db->prepare('INSERT INTO alerts(user_id,saved_search_id,type,label,query_json,frequency_hours,last_price,currency,next_check_at,expires_at,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')->execute(array($user['id'],isset($body['savedSearchId'])?(int)$body['savedSearchId']:null,$type,mb_substr($label,0,120),json_encode($query,JSON_UNESCAPED_UNICODE),$frequency,isset($body['price'])?(float)$body['price']:null,(string)($body['currency']??'EUR'),$now+$frequency*3600,$now+604800,1,$now,$now));vuelotel_json(201,array('id'=>(int)$db->lastInsertId(),'expiresAt'=>$now+604800));
}
vuelotel_json(400,array('error'=>'Acción no válida.'));
