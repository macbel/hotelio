import test from 'node:test';
import assert from 'node:assert/strict';
import {calendarDates,travelerCount,renderPriceBreakdown,renderPriceCalendar,renderPlanComparison,planComparisonRows} from '../src/travel-insights.js';

test('reparto conserva subtotal grupo y cuenta menores sin inventar tarifa individual',()=>{
  assert.equal(travelerCount({adults:2,childrenAges:[8],infants:1}),4);
  const html=renderPriceBreakdown({total:400,query:{adults:2,children:1,infants:1},flightPrice:250,hotelPrice:150});
  assert.match(html,/400/);assert.match(html,/100/);assert.match(html,/4 viajeros/);assert.match(html,/media/);assert.match(html,/confirmar en el proveedor/);
  assert.doesNotMatch(html,/1600/);
});
test('una salida parcial nunca se presenta como subtotal completo',()=>{
  const html=renderPriceBreakdown({total:90,query:{adults:1},flightPrice:90,complete:false});
  assert.match(html,/precio de salida/);assert.match(html,/vuelta pendiente/);assert.doesNotMatch(html,/subtotal del grupo/);
});
test('calendario mantiene fechas comprobadas sin precio y pendientes sin inventar resultados',()=>{
  const coverage={dates:[{departureDate:'2026-11-03',status:'pending'},{departureDate:'2026-11-02',status:'no_price'},{departureDate:'2026-11-01',status:'priced',flightPrice:120}]};
  const dates=calendarDates(coverage,[{departureDate:'2026-11-03',flightPrice:80}]);
  assert.deepEqual(dates.map(item=>item.status),['priced','no_price','pending']);
  assert.equal(dates[2].flightPrice,null);
  const html=renderPriceCalendar([{destination:'DUB',coverage,results:[]}]);
  assert.match(html,/Comprobada sin tarifa/);assert.match(html,/Pendiente/);assert.match(html,/fuera de la muestra no están comprobados/);
});
test('sin coverage detallada solo muestra resultados conocidos, no rellena meses como comprobados',()=>{
  assert.equal(calendarDates({checked:6,total:12},[{departureDate:'2026-11-03',flightPrice:80}]).length,1);
});
test('una consulta fallida se distingue de pendiente y de comprobada sin precio',()=>{
  const html=renderPriceCalendar([{destination:'DUB',coverage:{dates:[{departureDate:'2026-11-01',status:'error',flightPrice:20}]}}]);
  assert.match(html,/Consulta fallida/);assert.match(html,/travel-calendar-day error/);assert.doesNotMatch(html,/20,00/);
});
test('comparador no convierte escalas o cancelación ausentes en confirmado',()=>{
  const plan={total:300,departureDate:'2026-11-01',returnDate:'2026-11-04',hotel:{name:'Hotel <x>'}};
  const rows=planComparisonRows(plan,{adults:2,checkedBags:1});
  assert.match(rows.find(row=>row[0]==='Escalas')[1],/Sin confirmar/);
  assert.match(rows.find(row=>row[0]==='Equipaje')[1],/coste sin confirmar/);
  assert.match(renderPlanComparison([plan,plan],{adults:2}),/Hotel &lt;x&gt;/);
  assert.equal(renderPlanComparison([plan]),'');
});
