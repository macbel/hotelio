const esc=value=>String(value??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const money=(value,currency='EUR')=>Number.isFinite(Number(value))&&Number(value)>0?new Intl.NumberFormat('es-ES',{style:'currency',currency,maximumFractionDigits:2}).format(Number(value)):'Sin precio';
export function travelerCount(query={}){
  const count=Number(query.adults||0)+Number(query.children??query.childrenAges?.length??0)+Number(query.infants||0);
  return Number.isInteger(count)&&count>0?count:null;
}
export function renderPriceBreakdown({total,currency='EUR',query={},flightPrice=null,hotelPrice=null,complete=true}={}){
  const travelers=travelerCount(query),valid=Number.isFinite(Number(total))&&Number(total)>0;
  return `<div class="travel-price-breakdown"><strong>${esc(money(total,currency))} · ${complete?'subtotal del grupo':'precio de salida'}</strong>${travelers&&valid?`<span>${esc(money(Number(total)/travelers,currency))} por persona de media · ${travelers} viajeros</span>`:''}<span>${flightPrice!==null?`Vuelo: ${esc(money(flightPrice,currency))}${complete?' · trayecto seleccionado':' · vuelta pendiente'}`:''}${hotelPrice!==null?`${flightPrice!==null?' + ':''}Alojamiento: ${esc(money(hotelPrice,currency))} · estancia consultada`:''}</span><small>Reparto orientativo; adultos, niños y bebés pueden tener tarifas distintas. Equipaje, tasas adicionales y condiciones de cancelación: confirmar en el proveedor.</small></div>`;
}
function stopText(value){return value!==null&&value!==undefined&&Number.isInteger(Number(value))&&Number(value)>=0?(Number(value)===0?'Directo':`${Number(value)} escala(s)`):'Sin confirmar'}
export function planComparisonRows(plan,query={}){
  return [
    ['Subtotal del grupo',money(plan.total,plan.currency||'EUR')],
    ['Desglose',`Vuelo: ${money(plan.flightPrice,plan.currency||'EUR')} · hotel: ${money(plan.hotel?.totalPrice,plan.currency||'EUR')}`],
    ['Media por persona',travelerCount(query)?money(Number(plan.total)/travelerCount(query),plan.currency||'EUR'):'Viajeros sin confirmar'],
    ['Fechas',`${plan.departureDate} → ${plan.returnDate}`],
    ['Horario de salida',`Ida: ${plan.outboundDepartureTime||'sin confirmar'} · vuelta: ${plan.returnDepartureTime||'sin confirmar'}`],
    ['Escalas',`Ida: ${stopText(plan.stops)} · vuelta: ${stopText(plan.returnStops)}`],
    ['Equipaje',`${Number(query.carryOnBags)||0} de mano y ${Number(query.checkedBags)||0} facturadas solicitadas · inclusión y coste sin confirmar`],
    ['Hotel',plan.hotel?.name||'Sin confirmar'],
    ['Valoración del hotel',plan.hotel?.rating?String(plan.hotel.rating):'Sin confirmar'],
    ['Ubicación',plan.hotel?.location||'Sin confirmar'],
    ['Cancelación',plan.hotel?.cancellationPolicy||'Sin confirmar en la tarifa del hotel y del vuelo'],
    ['Por qué aparece',plan.rankReason||'Opción obtenida para las fechas comprobadas']
  ];
}
export function renderPlanComparison(plans=[],query={}){
  if(plans.length<2)return '';
  const rows=plans.map(plan=>planComparisonRows(plan,query));
  return `<details class="travel-comparison" open><summary>Comparar los ${plans.length} planes</summary><p>La clasificación utiliza los datos disponibles; el equipaje y la cancelación pendientes no mejoran la puntuación.</p><div class="travel-comparison-scroll" tabindex="0" role="region" aria-label="Comparación de planes; desplaza horizontalmente para ver todas las opciones"><table><thead><tr><th scope="col">Detalle</th>${plans.map(p=>`<th scope="col">${esc(p.rankLabel||p.destinationText||p.destinationCode)}</th>`).join('')}</tr></thead><tbody>${rows[0].map(([label],i)=>`<tr><th scope="row">${esc(label)}</th>${rows.map(row=>`<td>${esc(row[i][1])}</td>`).join('')}</tr>`).join('')}</tbody></table></div></details>`;
}
const dateValid=value=>/^\d{4}-\d{2}-\d{2}$/.test(String(value))&&!Number.isNaN(Date.parse(`${value}T12:00:00Z`));
export function calendarDates(coverage={},results=[]){
  const known=new Map(results.filter(item=>dateValid(item.departureDate)).map(item=>[item.departureDate,item]));
  const declared=Array.isArray(coverage.dates)?coverage.dates:[];
  const dates=declared.length?declared:results.map(item=>({...item,status:'priced'}));
  return dates.filter(item=>dateValid(item.departureDate)).map(item=>{
    const result=known.get(item.departureDate),status=['priced','no_price','pending','error'].includes(item.status)?item.status:'pending';
    return {...item,status,flightPrice:status==='priced'?item.flightPrice??result?.flightPrice:null};
  }).sort((a,b)=>a.departureDate.localeCompare(b.departureDate));
}
export function renderPriceCalendar(destinations=[]){
  return `<section class="travel-calendar"><h3>Calendario de fechas económicas</h3><p>Precios de vuelo de ida y vuelta para el grupo. Comprobada sin precio significa que no se obtuvo una tarifa comparable; pendiente aún no se ha consultado. Los días fuera de la muestra no están comprobados.</p><div class="travel-calendar-legend"><span>● Con precio</span><span>○ Comprobada sin precio</span><span>◷ Pendiente</span><span>! Error de consulta</span></div>${destinations.map(item=>{
    const dates=calendarDates(item.coverage,item.results),months=Map.groupBy?Map.groupBy(dates,date=>date.departureDate.slice(0,7)):dates.reduce((map,date)=>{const key=date.departureDate.slice(0,7);map.set(key,[...(map.get(key)||[]),date]);return map},new Map());
    const prices=dates.filter(date=>date.status==='priced'&&Number(date.flightPrice)>0).map(date=>Number(date.flightPrice)),lowest=Math.min(...prices);
    return `<div class="travel-calendar-destination"><h4>${esc(item.destination)}</h4>${dates.length?[...months].map(([month,entries])=>`<div class="travel-calendar-month"><h5>${esc(new Intl.DateTimeFormat('es-ES',{month:'long',year:'numeric'}).format(new Date(`${month}-01T12:00:00`)))}</h5><div class="travel-calendar-grid">${entries.map(date=>`<div class="travel-calendar-day ${esc(date.status)} ${date.status==='priced'&&Number(date.flightPrice)===lowest?'lowest':''}"><strong>${Number(date.departureDate.slice(-2))}</strong><span>${date.status==='priced'?esc(money(date.flightPrice,date.currency||'EUR')):date.status==='no_price'?'Sin precio':date.status==='error'?'Error':'Pendiente'}</span><small>${date.status==='priced'?'Comprobada':date.status==='no_price'?'Comprobada sin tarifa':date.status==='error'?'Consulta fallida':'Sin consultar'}${date.returnDate?` · vuelta ${esc(date.returnDate.slice(5))}`:''}</small></div>`).join('')}</div></div>`).join(''):'<p>No se ha recibido el detalle de fechas de la muestra.</p>'}</div>`;
  }).join('')}</section>`;
}
