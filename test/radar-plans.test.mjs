import test from 'node:test';
import assert from 'node:assert/strict';
import {rankRadarPlans,radarShareUrl,readRadarShare} from '../src/radar-plans.js';

const plan=(destinationCode,total,departureDate,stops=0)=>({destinationCode,destinationText:destinationCode,total,departureDate,returnDate:'2026-12-12',flightPrice:total-200,stops,returnStops:stops,outboundDepartureTime:'2026-12-05 10:30',returnDepartureTime:'2026-12-12 12:30',checkedAt:'2026-09-27T12:00:00Z',hotelCheckedAt:'2026-09-27T12:00:00Z',hotel:{name:'Hotel prueba',totalPrice:200,rating:4.5}});

test('el radar solo clasifica planes con subtotal válido y distingue precio y equilibrio',()=>{
  const ranked=rankRadarPlans([plan('FCO',300,'2026-12-05',2),plan('CDG',330,'2026-12-06',0),plan('LHR',500,'2026-12-07',1),plan('JFK',0,'2026-12-08')]);
  assert.equal(ranked[0].destinationCode,'FCO');
  assert.equal(ranked[0].rankLabel,'Más barato');
  assert.equal(ranked[1].rankLabel,'Mejor equilibrio');
  assert.equal(ranked.length,3);
});

test('el enlace compartido contiene solo un resumen validado',()=>{
  const url=radarShareUrl(plan('FCO',300,'2026-12-05'),'https://www.alufi.es/vuelotel/#vuelos');
  const snapshot=readRadarShare(new URL(url).hash);
  assert.equal(snapshot.destinationCode,'FCO');
  assert.equal(snapshot.total,300);
  assert.equal(readRadarShare('#plan=%7B%22v%22%3A1%7D'),null);
  assert.doesNotMatch(url,/api_token|flightLink|password/);
});
