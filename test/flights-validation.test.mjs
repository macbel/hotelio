import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveAirportCode,validateFlightQuery} from '../src/flights.js';

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
