<?php
require_once __DIR__ . '/bootstrap.php';
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

$originHeader=(string)($_SERVER['HTTP_ORIGIN']??'');
$localOrigin=(bool)preg_match('#^https?://(?:localhost|127\.0\.0\.1)(?::\d+)?$#',$originHeader);
if($localOrigin||$originHeader==='capacitor://localhost'){
    header('Access-Control-Allow-Origin: '.$originHeader);
    header('Access-Control-Allow-Methods: POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type');
    header('Vary: Origin');
}
if(($_SERVER['REQUEST_METHOD']??'GET')==='OPTIONS'){http_response_code(204);exit;}

function deals_out($status,$body){http_response_code($status);echo json_encode($body,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES);exit;}
if(($_SERVER['REQUEST_METHOD']??'GET')!=='POST')deals_out(405,array('error'=>'Método no permitido.'));

$body=json_decode(file_get_contents('php://input')?:'',true);
$query=$body['query']??null;
if(!is_array($query))deals_out(400,array('error'=>'Faltan los datos para explorar destinos.'));
$origin=strtoupper(trim((string)($query['origin']??'')));
$start=(string)($query['startDate']??'');
$end=(string)($query['endDate']??'');
$min=(int)($query['minNights']??3);
$max=(int)($query['maxNights']??7);
if(!preg_match('/^[A-Z]{3}$/',$origin))deals_out(400,array('error'=>'El aeropuerto de origen no es válido.'));
if(!preg_match('/^\d{4}-\d{2}-\d{2}$/',$start)||!preg_match('/^\d{4}-\d{2}-\d{2}$/',$end)||$end<$start)deals_out(400,array('error'=>'El intervalo de fechas no es válido.'));
if($min<1||$max>30||$min>$max)deals_out(400,array('error'=>'La duración debe estar entre 1 y 30 noches.'));

$config=hotelio_config();
$apiKey=trim((string)($config['providers']['serpapi']['api_key']??''));
if($apiKey==='')deals_out(503,array('error'=>'La exploración de destinos todavía no está configurada.'));
$dir=dirname(hotelio_config_path()).DIRECTORY_SEPARATOR.'.hotelio-flight-data'.DIRECTORY_SEPARATOR.'deals';
if(!is_dir($dir)&&!mkdir($dir,0700,true))deals_out(503,array('error'=>'No se pudo preparar la caché.'));
$cache=$dir.DIRECTORY_SEPARATOR.hash('sha256',json_encode(array($origin,$start,$end,$min,$max))).'.json';
if(is_file($cache)&&filemtime($cache)>time()-21600){
    $cached=json_decode(file_get_contents($cache),true);
    if(is_array($cached)){$cached['cached']=true;deals_out(200,$cached);}
}

$params=array('engine'=>'google_flights_deals','departure_id'=>$origin,'outbound_date'=>$start.','.$end,'trip_length'=>$min.','.$max,'currency'=>'EUR','hl'=>'es','api_key'=>$apiKey);
$ch=curl_init('https://serpapi.com/search.json?'.http_build_query($params,'','&',PHP_QUERY_RFC3986));
curl_setopt_array($ch,array(CURLOPT_RETURNTRANSFER=>true,CURLOPT_TIMEOUT=>25,CURLOPT_CONNECTTIMEOUT=>8,CURLOPT_USERAGENT=>'Vuelotel/2.0'));
$response=curl_exec($ch);
$status=(int)curl_getinfo($ch,CURLINFO_RESPONSE_CODE);
curl_close($ch);
$data=json_decode($response?:'',true);
if($status>=400||!is_array($data))deals_out($status===429?429:502,array('error'=>'No se pudieron consultar los destinos flexibles.'));

$source=array();
foreach(array('deals','destinations','results') as $keyName){if(isset($data[$keyName])&&is_array($data[$keyName]))$source=array_merge($source,$data[$keyName]);}
$results=array();
foreach($source as $item){
    if(!is_array($item))continue;
    $airport=strtoupper((string)($item['arrival_airport_code']??$item['destination_airport']['code']??$item['destination_airport']??$item['airport_code']??''));
    $departure=(string)($item['start_date']??$item['departure_date']??$item['outbound_date']??'');
    $return=(string)($item['end_date']??$item['return_date']??$item['inbound_date']??'');
    $price=(float)($item['flight_price']??$item['price']??0);
    if(!preg_match('/^[A-Z]{3}$/',$airport)||$departure===''||$return===''||$price<=0)continue;
    $results[]=array('destinationCode'=>$airport,'destinationName'=>(string)($item['name']??$item['destination_name']??$item['city']??$airport),'country'=>(string)($item['country']??$item['country_name']??''),'departureDate'=>$departure,'returnDate'=>$return,'flightPrice'=>$price,'currency'=>'EUR','airline'=>(string)($item['airline']??''),'stops'=>(int)($item['stops']??0),'flightLink'=>(string)($item['flight_link']??''));
}
usort($results,function($a,$b){return $a['flightPrice']<=>$b['flightPrice'];});
$payload=array('results'=>array_slice($results,0,12),'notice'=>count($results)?'Destinos con precios orientativos encontrados desde '.$origin.'.':'Ahora mismo el catálogo no ofrece destinos para ese origen e intervalo. Prueba una ventana distinta.');
@file_put_contents($cache,json_encode($payload,JSON_UNESCAPED_UNICODE),LOCK_EX);
deals_out(200,$payload);
