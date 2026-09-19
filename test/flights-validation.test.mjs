import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolveAirportCode,searchAirports,validateDestinationQuery,validateFlightQuery} from '../src/flights.js';
const catalog=JSON.parse(readFileSync(new URL('../public/data/airports.json',import.meta.url))).airports;

const validQuery={
  tripType:'roundtrip',origin:'MAD',destination:'FCO',departureDate:'2026-09-10',returnDate:'2026-09-17',
  adults:2,children:1,infants:0,travelClass:'economy',stops:'any',carryOnBags:1,maxPrice:null
};

test('acepta una búsqueda de vuelo válida',()=>{
  assert.equal(validateFlightQuery(validQuery),'');
});

test('exige códigos IATA válidos y diferentes',()=>{
  assert.match(validateFlightQuery({...validQuery,origin:'Madrid'}),/IATA/);
  assert.match(validateFlightQuery({...validQuery,destination:'MAD'}),/distintos/);
});

test('valida vuelta y ocupación',()=>{
  assert.match(validateFlightQuery({...validQuery,returnDate:'2026-09-09'}),/posterior/);
  assert.match(validateFlightQuery({...validQuery,adults:1,infants:2}),/adulto/);
  assert.match(validateFlightQuery({...validQuery,adults:5,children:5}),/máximo de 9/);
  assert.match(validateFlightQuery({...validQuery,adults:1,children:0,carryOnBags:2}),/maletas de mano/);
});

test('permite solo ida sin fecha de regreso',()=>{
  assert.equal(validateFlightQuery({...validQuery,tripType:'oneway',returnDate:''}),'');
});

test('valida el seguimiento flexible de un destino',()=>{
  const query={origin:'MAD',destination:'FCO',startDate:'2026-10-01',endDate:'2026-12-15',minNights:7,adults:2,children:1,infants:0,carryOnBags:2,checkedBags:1};
  assert.equal(validateDestinationQuery(query),'');
  assert.match(validateDestinationQuery({...query,origin:'Madrid'}),/IATA/);
  assert.match(validateDestinationQuery({...query,endDate:'2026-09-01'}),/ventana/);
  assert.match(validateDestinationQuery({...query,checkedBags:4}),/maletas/);
  assert.match(validateDestinationQuery({...query,infants:3,adults:2}),/adulto/);
});

test('resuelve ciudad, aeropuerto seleccionado y código IATA',()=>{
  const airports=[
    {iata:'MAD',city:'Madrid',name:'Adolfo Suárez Madrid–Barajas Airport',country:'ES',type:'large_airport'},
    {iata:'BCN',city:'Barcelona',name:'Josep Tarradellas Barcelona-El Prat Airport',country:'ES',type:'large_airport'},
    {iata:'BLA',city:'Barcelona',name:'General José Antonio Anzoategui International Airport',country:'VE',type:'large_airport'}
  ];
  assert.equal(resolveAirportCode('Madrid',airports),'MAD');
  assert.equal(resolveAirportCode('Barcelona',airports),'BCN');
  assert.equal(resolveAirportCode('Roma · Fiumicino (FCO)',airports),'FCO');
  assert.equal(resolveAirportCode('jfk',airports),'JFK');
  assert.equal(resolveAirportCode('Ciudad desconocida',airports),'');
});

test('reconoce ciudades españolas, traducciones y municipios del catálogo real',()=>{
  for(const [city,codes] of Object.entries({Sevilla:['SVQ'],Roma:['CIA','FCO'],Londres:['LCY','LGW','LHR','LTN','SEN','STN'],Paris:['CDG','ORY','BVA'],'A Coruña':['LCG'],'San Sebastian':['EAS'],Bruselas:['BRU','CRL'],Venecia:['VCE','TSF'],Florencia:['FLR'],Munich:['MUC']})){
    assert.ok(codes.includes(resolveAirportCode(city,catalog)),city);
    const suggestions=searchAirports(city,catalog).map(airport=>airport.iata);
    for(const code of codes)assert.ok(suggestions.includes(code),`${city}: falta ${code}`);
  }
});

test('permite nombres parciales inequívocos y exige selección si son ambiguos',()=>{
  assert.equal(resolveAirportCode('Barajas',catalog),'MAD');
  assert.equal(resolveAirportCode('Heathrow',catalog),'LHR');
  assert.equal(resolveAirportCode('Ciudad inventada',catalog),'');
  assert.equal(resolveAirportCode('San',catalog),'SAN'); // El código IATA continúa funcionando.
  assert.equal(resolveAirportCode('Lond',catalog),'');
  assert.equal(searchAirports('bcn',catalog)[0].iata,'BCN');
  assert.equal(resolveAirportCode('Sevilla · Seville Airport · ES (SVQ)',catalog),'SVQ');
});

test('prioriza coincidencias de ciudad e ignora acentos y espacios',()=>{
  assert.equal(resolveAirportCode('  MÚNICH  ',catalog),'MUC');
  assert.ok(searchAirports('lond',catalog).some(airport=>airport.iata==='LHR'));
  assert.deepEqual(searchAirports('',catalog),[]);
  assert.ok(searchAirports('a',catalog).length<=20);
  assert.equal(resolveAirportCode('mad',[]),'MAD');
});
