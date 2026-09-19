<?php
require_once __DIR__ . '/bootstrap.php';
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

$originHeader=(string)($_SERVER['HTTP_ORIGIN']??'');
if(preg_match('#^https?://(?:localhost|127\.0\.0\.1)(?::\d+)?$#',$originHeader)||$originHeader==='capacitor://localhost'){
    header('Access-Control-Allow-Origin: '.$originHeader);
    header('Access-Control-Allow-Methods: POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type');
    header('Vary: Origin');
}
if(($_SERVER['REQUEST_METHOD']??'GET')==='OPTIONS'){http_response_code(204);exit;}
function destination_out($status,$body){http_response_code($status);echo json_encode($body,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES);exit;}
function destination_client_key(){
    $ip=(string)($_SERVER['REMOTE_ADDR']??'unknown');
    if(!filter_var($ip,FILTER_VALIDATE_IP))$ip='unknown';
    return hash_hmac('sha256',$ip,hash('sha256',hotelio_config_path()));
}
function destination_reserve($path,$settings){
    $handle=fopen($path,'c+');if($handle===false)destination_out(503,array('error'=>'No se pudo actualizar el control de consumo.'));
    if(!flock($handle,LOCK_EX)){fclose($handle);destination_out(503,array('error'=>'No se pudo bloquear el control de consumo.'));}
    $raw=stream_get_contents($handle);$state=json_decode($raw?:'',true);if(!is_array($state))$state=array();$now=time();$month=gmdate('Y-m',$now);
    if(($state['month']??'')!==$month){$state['month']=$month;$state['monthly_calls']=0;$state['successes']=array();}
    $client=destination_client_key();$recent=array_filter((array)($state['successes'][$client]??array()),function($stamp)use($now){return is_numeric($stamp)&&(int)$stamp>$now-3600;});
    if(count($recent)>=(int)$settings['per_ip_hourly_limit']){flock($handle,LOCK_UN);fclose($handle);destination_out(429,array('error'=>'Has alcanzado el límite temporal de búsquedas de vuelos. Inténtalo más tarde.','retryAfter'=>3600));}
    if((int)($state['monthly_calls']??0)>=(int)$settings['monthly_limit']){flock($handle,LOCK_UN);fclose($handle);destination_out(429,array('error'=>'Se ha alcanzado el límite mensual de consultas de vuelos. Las búsquedas ya almacenadas siguen disponibles.'));}
    $state['monthly_calls']=(int)($state['monthly_calls']??0)+1;$state['successes'][$client]=array_values($recent);$state['successes'][$client][]=$now;$encoded=json_encode($state,JSON_UNESCAPED_SLASHES);rewind($handle);ftruncate($handle,0);fwrite($handle,$encoded);fflush($handle);flock($handle,LOCK_UN);fclose($handle);
}
if(($_SERVER['REQUEST_METHOD']??'GET')!=='POST')destination_out(405,array('error'=>'Método no permitido.'));
$body=json_decode(file_get_contents('php://input')?:'',true);$query=$body['query']??null;
if(!is_array($query))destination_out(400,array('error'=>'Faltan los datos del seguimiento.'));
$origin=strtoupper(trim((string)($query['origin']??'')));$destination=strtoupper(trim((string)($query['destination']??'')));
$start=(string)($query['startDate']??'');$end=(string)($query['endDate']??'');$nights=(int)($query['minNights']??7);
$adults=(int)($query['adults']??1);$children=(int)($query['children']??0);$infants=(int)($query['infants']??0);$carry=(int)($query['carryOnBags']??0);$checked=(int)($query['checkedBags']??0);
if(!preg_match('/^[A-Z]{3}$/',$origin)||!preg_match('/^[A-Z]{3}$/',$destination)||$origin===$destination)destination_out(400,array('error'=>'El origen y el destino deben ser códigos IATA de tres letras y distintos.'));
function destination_date($value){$date=DateTime::createFromFormat('!Y-m-d',$value,new DateTimeZone('UTC'));return preg_match('/^\d{4}-\d{2}-\d{2}$/',$value)&&$date&&$date->format('Y-m-d')===$value?$date:null;}
$startDate=destination_date($start);$endDate=destination_date($end);$today=new DateTime('today',new DateTimeZone('UTC'));
if(!$startDate||!$endDate||$endDate<$startDate||$startDate<$today||$endDate>(clone $today)->modify('+365 days'))destination_out(400,array('error'=>'La ventana de salida no es válida.'));
if($nights<1||$nights>30)destination_out(400,array('error'=>'La estancia debe ser de entre 1 y 30 noches.'));
if($adults<1||$children<0||$infants<0||$adults+$children+$infants>9||$infants>$adults)destination_out(400,array('error'=>'El número de pasajeros no es válido.'));
if($carry<0||$checked<0||$carry+$checked>$adults+$children+$infants)destination_out(400,array('error'=>'Las maletas no pueden superar el número de pasajeros.'));
$config=hotelio_config();$apiKey=trim((string)($config['providers']['serpapi']['api_key']??''));
if($apiKey==='')destination_out(503,array('error'=>'El seguimiento de destinos todavía no está configurado.'));
$settings=array('per_ip_hourly_limit'=>max(1,min(30,(int)($config['flights']['per_ip_hourly_limit']??8))),'monthly_limit'=>max(1,min(240,(int)($config['flights']['monthly_limit']??120))));$ttl=max(300,min(86400,(int)($config['flights']['cache_ttl']??3600)));
$storage=dirname(hotelio_config_path()).DIRECTORY_SEPARATOR.'.hotelio-flight-data'.DIRECTORY_SEPARATOR.'destinations';
if(!is_dir($storage)&&!mkdir($storage,0700,true)&&!is_dir($storage))destination_out(503,array('error'=>'No se pudo preparar la caché.'));
$normalized=array($origin,$destination,$start,$end,$nights,$adults,$children,$infants,$carry,$checked);
$cache=$storage.DIRECTORY_SEPARATOR.hash('sha256',json_encode($normalized)).'.json';
if(is_file($cache)&&filemtime($cache)>time()-$ttl){$cached=json_decode(file_get_contents($cache),true);if(is_array($cached)){$cached['cached']=true;destination_out(200,$cached);}}
destination_reserve(dirname($storage).DIRECTORY_SEPARATOR.'usage.json',$settings);
$params=array('engine'=>'google_flights_deals','departure_id'=>$origin,'arrival_id'=>$destination,'outbound_date'=>$start.','.$end,'trip_length'=>$nights.','.$nights,'adults'=>$adults,'children'=>$children,'infants'=>$infants,'currency'=>'EUR','hl'=>'es','api_key'=>$apiKey);
$ch=curl_init('https://serpapi.com/search.json?'.http_build_query($params,'','&',PHP_QUERY_RFC3986));curl_setopt_array($ch,array(CURLOPT_RETURNTRANSFER=>true,CURLOPT_TIMEOUT=>25,CURLOPT_CONNECTTIMEOUT=>8,CURLOPT_USERAGENT=>'Vuelotel/2.0'));$response=curl_exec($ch);$status=(int)curl_getinfo($ch,CURLINFO_RESPONSE_CODE);curl_close($ch);
$data=json_decode($response?:'',true);if($status>=400||!is_array($data))destination_out($status===429?429:502,array('error'=>'No se pudieron verificar las fechas económicas.'));
$source=array();foreach(array('deals','destinations','results','flights') as $key){if(isset($data[$key])&&is_array($data[$key]))$source=array_merge($source,$data[$key]);}
$results=array();foreach($source as $item){if(!is_array($item))continue;$airport=strtoupper((string)($item['arrival_airport_code']??$item['destination_airport']['code']??$item['airport_code']??$destination));$departure=(string)($item['start_date']??$item['departure_date']??$item['outbound_date']??'');$return=(string)($item['end_date']??$item['return_date']??$item['inbound_date']??'');$price=(float)($item['flight_price']??$item['price']??$item['total_price']??0);if(!destination_date($departure)||!destination_date($return)||$price<=0)continue;$results[]=array('destinationCode'=>$airport,'destinationName'=>(string)($item['name']??$item['destination_name']??$item['city']??$destination),'departureDate'=>$departure,'returnDate'=>$return,'flightPrice'=>$price,'currency'=>'EUR','airline'=>(string)($item['airline']??$item['airlines'][0]??''),'stops'=>(int)($item['stops']??0),'flightLink'=>(string)($item['flight_link']??$item['link']??''));}
usort($results,function($a,$b){return $a['flightPrice']<=>$b['flightPrice']?:strcmp($a['departureDate'],$b['departureDate']);});$results=array_slice($results,0,20);
$payload=array('results'=>$results,'query'=>array('origin'=>$origin,'destination'=>$destination,'startDate'=>$start,'endDate'=>$end,'minNights'=>$nights,'adults'=>$adults,'children'=>$children,'infants'=>$infants,'carryOnBags'=>$carry,'checkedBags'=>$checked),'notice'=>count($results)?'Fechas verificadas con precios orientativos. Confirma el precio final y el equipaje antes de comprar.':'No se encontraron fechas económicas para esta ventana. Prueba ampliando el intervalo o el número de noches.');
@file_put_contents($cache,json_encode($payload,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES),LOCK_EX);destination_out(200,$payload);
