import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const [backend,frontend]=await Promise.all([
  readFile(new URL('../public/api/search.php',import.meta.url),'utf8'),
  readFile(new URL('../src/main.js',import.meta.url),'utf8')
]);

test('SerpApi usa únicamente tipos de alojamiento documentados y exactos',()=>{
  const expected={
    beach_hotel:'12',boutique_hotel:'13',hostel:'14',inn:'15',motel:'16',resort:'17',
    spa_hotel:'18',bed_and_breakfast:'19',apartment_hotel:'21',apartment:'1'
  };
  for(const [name,id] of Object.entries(expected)){
    assert.match(backend,new RegExp(`'${name}'\\s*=>\\s*'${id}'`));
  }
  assert.doesNotMatch(frontend,/value="hotel"/);
  assert.doesNotMatch(frontend,/Casa rural \/ B&amp;B/);
});

test('desayuno y todo incluido son disponibilidad aproximada; los demás regímenes se confirman',()=>{
  assert.match(backend,/'breakfast'\s*=>\s*'9'/);
  assert.match(backend,/'all_inclusive'\s*=>\s*'52'/);
  assert.match(backend,/array\('breakfast', 'all_inclusive'\).*return 'approximate'/s);
  assert.match(backend,/array\('room_only', 'half_board', 'full_board'\).*return 'confirm'/s);
});

test('los portales directos no recuperan parámetros internos eliminados',()=>{
  for(const forbidden of ['nflt=','kayakOccupancy','search=200-','/pwa/s?','Hotel-Search?']){
    assert.equal(frontend.includes(forbidden),false,`Parámetro interno encontrado: ${forbidden}`);
  }
  assert.match(frontend,/Booking\.com'.*url:'https:\/\/www\.booking\.com\/index\.es\.html'/);
  assert.match(frontend,/KAYAK'.*url:'https:\/\/www\.kayak\.es\/hotels'/);
  assert.match(frontend,/Trivago'.*url:'https:\/\/www\.trivago\.es\/'/);
  assert.match(frontend,/Hostelworld'.*url:'https:\/\/www\.hostelworld\.com\/'/);
});
