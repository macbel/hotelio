<?php
require_once __DIR__ . '/user-bootstrap.php';
require_once __DIR__ . '/alert-policy.php';
$user=vuelotel_current_user();$db=vuelotel_db();$method=$_SERVER['REQUEST_METHOD']??'GET';
if($method==='GET'){
  if(($_GET['action']??'')==='open_alert'){
    try{$opened=vuelotel_open_alert($db,(int)$user['id'],(int)($_GET['id']??0));}
    catch(InvalidArgumentException $error){vuelotel_json(400,array('error'=>$error->getMessage()));}
    if($opened===null)vuelotel_json(404,array('error'=>'No se encontró esta alerta.'));
    vuelotel_json(200,$opened);
  }
  if(($_GET['action']??'')==='alert_history'){
    $history=vuelotel_alert_history($db,(int)$user['id'],(int)($_GET['id']??0),max(0,(int)($_GET['beforeId']??0)));
    if($history===null)vuelotel_json(404,array('error'=>'No se encontró esta alerta.'));
    vuelotel_json(200,$history);
  }
  $result=array();
  foreach(array('favorites','saved_searches','alerts') as $table){$statement=$db->prepare("SELECT * FROM $table WHERE user_id=? ORDER BY created_at DESC");$statement->execute(array($user['id']));$result[$table]=$statement->fetchAll();}
  foreach($result['favorites'] as &$item)$item['payload']=json_decode($item['payload_json'],true);
  foreach($result['saved_searches'] as &$item)$item['filters']=json_decode($item['filters_json'],true);
  foreach($result['alerts'] as &$item){$item['query']=json_decode($item['query_json'],true);$item['conditions']=vuelotel_alert_conditions($item);}
  vuelotel_json(200,array('favorites'=>$result['favorites'],'searches'=>$result['saved_searches'],'alerts'=>$result['alerts']));
}
if($method!=='POST')vuelotel_json(405,array('error'=>'Método no permitido.'));
$body=vuelotel_body();$action=(string)($body['action']??'');$kind=(string)($body['kind']??'');$now=time();
function vuelotel_alert_expiry($value,$now){
  if(!is_string($value)||!preg_match('/^\d{4}-\d{2}-\d{2}$/',$value))vuelotel_json(400,array('error'=>'Indica una fecha de caducidad válida.'));
  $date=DateTimeImmutable::createFromFormat('!Y-m-d',$value,new DateTimeZone('UTC'));
  if(!$date||$date->format('Y-m-d')!==$value)vuelotel_json(400,array('error'=>'Indica una fecha de caducidad válida.'));
  $expires=$date->getTimestamp()+86399;
  if($expires<=$now||$expires>$now+366*86400)vuelotel_json(400,array('error'=>'La caducidad debe ser futura y estar dentro del próximo año.'));
  return $expires;
}
if($action==='update_alert'){
  $id=(int)($body['id']??0);$frequency=(int)($body['frequencyHours']??0);
  if($id<1||!in_array($frequency,array(12,24,72,168),true))vuelotel_json(400,array('error'=>'Frecuencia de alerta no válida.'));
  $expires=vuelotel_alert_expiry($body['expiresDate']??null,$now);
  if($expires<=$now+$frequency*3600)vuelotel_json(400,array('error'=>'La caducidad debe ser posterior a la próxima comprobación.'));
  $existing=vuelotel_owned_alert($db,(int)$user['id'],$id);
  if(!$existing)vuelotel_json(404,array('error'=>'No se encontró esta alerta.'));
  $conditions=null;
  if(array_key_exists('conditions',$body)){try{$conditions=vuelotel_validate_conditions($body['conditions']);}catch(InvalidArgumentException $error){vuelotel_json(400,array('error'=>$error->getMessage()));}}
  $expired=(int)$existing['active']!==1||(int)$existing['expires_at']<=$now;
  if($expired&&($body['reactivate']??false)!==true)vuelotel_json(409,array('error'=>'Para reactivar una alerta caducada, confirma la reactivación.'));
  if($expired){$count=$db->prepare('SELECT COUNT(*) FROM alerts WHERE user_id=? AND active=1 AND expires_at>?');$count->execute(array($user['id'],$now));if((int)$count->fetchColumn()>=(int)vuelotel_setting('max_alerts_per_user','5'))vuelotel_json(409,array('error'=>'Has alcanzado el máximo de alertas activas.'));}
  $next=$now+$frequency*3600;
  $db->prepare('UPDATE alerts SET frequency_hours=?,expires_at=?,next_check_at=?,active=1,last_price=CASE WHEN ? THEN NULL ELSE last_price END,last_status=CASE WHEN ? THEN NULL ELSE last_status END,last_error=CASE WHEN ? THEN NULL ELSE last_error END,updated_at=? WHERE id=? AND user_id=?')->execute(array($frequency,$expires,$next,$expired?1:0,$expired?1:0,$expired?1:0,$now,$id,$user['id']));
  if($conditions!==null)vuelotel_set_alert_conditions($db,$existing,$conditions,$expired);
  elseif($expired)$db->prepare('UPDATE alerts SET notify_reference_price=NULL,notify_pending=0,pending_reference_price=NULL,pending_notification_id=NULL WHERE id=? AND user_id=?')->execute(array($id,$user['id']));
  vuelotel_json(200,array('ok'=>true,'expiresAt'=>$expires,'nextCheckAt'=>$next));
}
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
  $expires=vuelotel_alert_expiry($body['expiresDate']??gmdate('Y-m-d',$now+604800),$now);
  $conditions=null;
  if(array_key_exists('conditions',$body)){try{$conditions=vuelotel_validate_conditions($body['conditions']);}catch(InvalidArgumentException $error){vuelotel_json(400,array('error'=>$error->getMessage()));}}
  if(isset($body['price'])&&(!is_numeric($body['price'])||!is_finite((float)$body['price'])||round((float)$body['price'],2)<=0))vuelotel_json(400,array('error'=>'El precio de referencia no es válido.'));
  if(isset($body['savedSearchId'])){$own=$db->prepare('SELECT id FROM saved_searches WHERE id=? AND user_id=?');$own->execute(array((int)$body['savedSearchId'],$user['id']));if(!$own->fetchColumn())vuelotel_json(404,array('error'=>'No se encontró esta búsqueda.'));}
  if($expires<=$now+$frequency*3600)vuelotel_json(400,array('error'=>'La caducidad debe ser posterior a la primera comprobación.'));
  if($type==='destination'){
    $mode=(string)($body['alertMode']??'lower');$threshold=(float)($body['threshold']??0);
    if(!in_array($mode,array('lower','threshold'),true)||($mode==='threshold'&&($threshold<=0||!is_finite($threshold))))vuelotel_json(400,array('error'=>'Configura una condición de alerta válida.'));
    $scope=(string)($body['alertScope']??'flight');
    if(!in_array($scope,array('flight','plan'),true))vuelotel_json(400,array('error'=>'El tipo de seguimiento no es válido.'));
    $plan=$query['plans'][0]??null;
    if($scope==='plan'){
      if(!is_array($plan)||($plan['priceStatus']??'')!=='complete'||!preg_match('/^\d{4}-\d{2}-\d{2}$/',(string)($plan['departureDate']??''))||!preg_match('/^\d{4}-\d{2}-\d{2}$/',(string)($plan['returnDate']??''))||trim((string)($plan['hotel']['name']??''))===''||!is_numeric($plan['total']??null)||$plan['total']<=0)vuelotel_json(400,array('error'=>'Guarda primero un plan completo para seguir su precio.'));
      $query['_plan']=array('departureDate'=>$plan['departureDate'],'returnDate'=>$plan['returnDate'],'destinationText'=>mb_substr((string)($plan['destinationText']??$query['destination']??''),0,120),'hotelName'=>mb_substr((string)$plan['hotel']['name'],0,180));
    }
    unset($query['plans'],$query['coverage'],$query['planCheckedAt']);
    $query['_alertMode']=$mode;$query['_threshold']=$threshold;$query['_alertScope']=$scope;
  }
  if(in_array($type,array('destination','flight','combined'),true))$query['_coverageVersion']=3;
  $count=$db->prepare('SELECT COUNT(*) FROM alerts WHERE user_id=? AND active=1 AND expires_at>?');$count->execute(array($user['id'],$now));if((int)$count->fetchColumn()>=(int)vuelotel_setting('max_alerts_per_user','5'))vuelotel_json(409,array('error'=>'Has alcanzado el máximo de 5 alertas activas.'));
  $label=trim((string)($body['label']??'Alerta de precio'));$db->prepare('INSERT INTO alerts(user_id,saved_search_id,type,label,query_json,frequency_hours,last_price,currency,next_check_at,expires_at,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')->execute(array($user['id'],isset($body['savedSearchId'])?(int)$body['savedSearchId']:null,$type,mb_substr($label,0,120),json_encode($query,JSON_UNESCAPED_UNICODE),$frequency,isset($body['price'])?round((float)$body['price'],2):null,(string)($body['currency']??'EUR'),$now+$frequency*3600,$expires,1,$now,$now));
  $id=(int)$db->lastInsertId();if($conditions!==null)vuelotel_set_alert_conditions($db,vuelotel_owned_alert($db,(int)$user['id'],$id),$conditions);
  vuelotel_json(201,array('id'=>$id,'expiresAt'=>$expires));
}
vuelotel_json(400,array('error'=>'Acción no válida.'));
