import {renderPriceBreakdown,renderPlanComparison,renderPriceCalendar} from './travel-insights.js?v=2.6.0';
const FLIGHT_PRICE_NOTICE='Los precios son orientativos y pueden cambiar. Confirma siempre el precio final y las condiciones en Google Flights o en la página de compra. Rumbiva no gestiona pagos ni reservas.';

const esc=value=>String(value??'').replace(/[&<>'"]/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[character]));
const whatsappUrl=text=>`https://wa.me/?text=${encodeURIComponent(text)}`;

function localIso(date){
  const year=date.getFullYear(),month=String(date.getMonth()+1).padStart(2,'0'),day=String(date.getDate()).padStart(2,'0');
  return `${year}-${month}-${day}`;
}

function addDays(date,days){
  const copy=new Date(date.getFullYear(),date.getMonth(),date.getDate());
  copy.setDate(copy.getDate()+days);
  return copy;
}

function defaultFlightEndpoint(){
  const native=Boolean(globalThis.Capacitor?.isNativePlatform?.());
  if(native)return 'https://www.alufi.es/vuelotel/api/flights.php';
  if(['localhost','127.0.0.1'].includes(location.hostname))return 'https://www.alufi.es/vuelotel/api/flights.php';
  return new URL('./api/flights.php',location.href).href;
}

const nightsBetween=(from,to)=>Math.max(1,Math.round((new Date(to)-new Date(from))/86400000));

function defaultFlightDealsEndpoint(){
  const native=Boolean(globalThis.Capacitor?.isNativePlatform?.());
  if(native)return 'https://www.alufi.es/vuelotel/api/flight-deals.php';
  if(['localhost','127.0.0.1'].includes(location.hostname))return 'https://www.alufi.es/vuelotel/api/flight-deals.php';
  return new URL('./api/flight-deals.php',location.href).href;
}

function defaultDestinationSearchEndpoint(){
  const native=Boolean(globalThis.Capacitor?.isNativePlatform?.());
  if(native)return 'https://www.alufi.es/vuelotel/api/destination-search.php';
  if(['localhost','127.0.0.1'].includes(location.hostname))return 'https://www.alufi.es/vuelotel/api/destination-search.php';
  return new URL('./api/destination-search.php',location.href).href;
}

async function searchFlightDeals(query,{endpoint=defaultFlightDealsEndpoint(),signal}={}){
  const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify({query}),signal});
  const body=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(body.error||`Error HTTP ${response.status}`);
  return body;
}

async function searchDestination(query,{endpoint=defaultDestinationSearchEndpoint(),signal,continueSearch=false}={}){
  const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify({query,continue:continueSearch}),signal});
  const body=await response.json().catch(()=>({}));
  if(!response.ok){
    const retry=Number(body.retryAfter)>0?` Podrás intentarlo de nuevo en unos ${Math.ceil(Number(body.retryAfter)/60)} minutos.`:'';
    throw new Error(`${body.error||`Error HTTP ${response.status}`}${retry}`);
  }
  return body;
}

async function searchFlights(query,{endpoint=defaultFlightEndpoint(),signal}={}){
  const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify({query}),signal});
  const body=await response.json().catch(()=>({}));
  if(!response.ok){
    const retry=Number(body.retryAfter)>0?` Podrás intentarlo de nuevo en unos ${Math.ceil(Number(body.retryAfter)/60)} minutos.`:'';
    throw new Error(`${body.error||`Error HTTP ${response.status}`}${retry}`);
  }
  return body;
}

function defaultAirportDataUrl(){
  return new URL('./data/airports.json',document.baseURI).href;
}

async function loadAirports(url){
  try{
    const response=await fetch(url,{headers:{Accept:'application/json'},cache:'force-cache'});
    const body=await response.json();
    if(!response.ok||!Array.isArray(body.airports))return [];
    return body.airports;
  }catch{
    // La búsqueda por código IATA sigue disponible si el catálogo local falla.
    return [];
  }
}

const normalizedAirportText=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
const airportRank=airport=>({large_airport:3,medium_airport:2,small_airport:1}[airport?.type]||0);
// Nombres de ciudades servidas, incluidos los que difieren del municipio del catálogo.
const cityAliases={
  MAD:['Madrid'],BCN:['Barcelona'],SVQ:['Sevilla'],LCG:['A Coruña','La Coruña'],EAS:['San Sebastián','Donostia'],
  OVD:['Asturias','Oviedo','Gijón'],SDR:['Santander'],PMI:['Palma','Palma de Mallorca'],LPA:['Las Palmas','Gran Canaria'],
  FCO:['Roma'],CIA:['Roma'],LHR:['Londres'],LGW:['Londres'],STN:['Londres'],LTN:['Londres'],LCY:['Londres'],SEN:['Londres'],
  CDG:['París'],ORY:['París'],BVA:['París'],BRU:['Bruselas'],CRL:['Bruselas'],
  VCE:['Venecia'],TSF:['Venecia'],FLR:['Florencia'],MXP:['Milán'],LIN:['Milán'],BGY:['Milán'],
  NAP:['Nápoles'],TRN:['Turín'],BLQ:['Bolonia'],PRG:['Praga'],MUC:['Múnich'],VIE:['Viena'],
  LIS:['Lisboa'],OPO:['Oporto'],ATH:['Atenas'],WAW:['Varsovia'],KRK:['Cracovia'],
  CPH:['Copenhague'],ARN:['Estocolmo'],GVA:['Ginebra'],ZRH:['Zúrich'],BER:['Berlín'],
  CGN:['Colonia'],FRA:['Fráncfort','Frankfurt'],EDI:['Edimburgo'],DUB:['Dublín'],
  JFK:['Nueva York'],EWR:['Nueva York'],LGA:['Nueva York'],PEK:['Pekín','Beijing'],PKX:['Pekín','Beijing']
};
const airportCities=airport=>[airport.city,String(airport.city||'').replace(/\s*\(.*$/,''),...(cityAliases[airport.iata]||[])].filter(Boolean);
const airportLabel=airport=>[...new Set([...(cityAliases[airport.iata]||[]),airport.city,airport.name,airport.country].filter(Boolean))].join(' · ')+` (${airport.iata})`;

function airportMatchScore(airport,wanted){
  if(normalizedAirportText(airport.iata)===wanted)return 5;
  const cities=airportCities(airport).map(normalizedAirportText);
  if(cities.includes(wanted))return 4;
  const name=normalizedAirportText(airport.name);
  if(name===wanted)return 3;
  if(cities.some(city=>city.startsWith(wanted)))return 2;
  return normalizedAirportText(airportLabel(airport)).includes(wanted)?1:0;
}

function searchAirports(value,airports=[],limit=20){
  const wanted=normalizedAirportText(value);
  if(!wanted)return [];
  return airports.map(airport=>({airport,score:airportMatchScore(airport,wanted)})).filter(item=>item.score)
    .sort((a,b)=>b.score-a.score||airportRank(b.airport)-airportRank(a.airport)||String(a.airport.iata).localeCompare(String(b.airport.iata)))
    .slice(0,limit).map(item=>item.airport);
}

function bestAirport(matches){
  return [...matches].sort((left,right)=>{
    const spanish=Number(right.country==='ES')-Number(left.country==='ES');
    return spanish||airportRank(right)-airportRank(left)||String(left.iata).localeCompare(String(right.iata));
  })[0];
}

function resolveAirportCode(value,airports=[]){
  const text=String(value||'').trim();
  const selected=text.match(/\(([A-Za-z]{3})\)\s*$/);
  if(selected)return selected[1].toUpperCase();
  const wanted=normalizedAirportText(text);
  if(!wanted)return '';
  const code=airports.find(airport=>normalizedAirportText(airport.iata)===wanted);
  if(code)return code.iata.toUpperCase();
  const exactCity=airports.filter(airport=>airportCities(airport).some(city=>normalizedAirportText(city)===wanted));
  if(exactCity.length)return String(bestAirport(exactCity)?.iata||'').toUpperCase();
  const exactName=airports.filter(airport=>normalizedAirportText(airport.name)===wanted);
  if(exactName.length)return String(bestAirport(exactName)?.iata||'').toUpperCase();
  if(/^[A-Za-z]{3}$/.test(text))return text.toUpperCase();
  const matches=searchAirports(text,airports,2);
  if(matches.length===1)return matches[0].iata.toUpperCase();
  return '';
}

function showResolvedAirport(input,code){
  const current=String(input.value||'').trim();
  if(!code)return;
  input.value=/^[A-Za-z]{3}$/.test(current)?code:/\([A-Za-z]{3}\)\s*$/.test(current)?current:`${current} (${code})`;
}

function safeGoogleFlightsUrl(value){
  try{
    const url=new URL(value);
    return url.protocol==='https:'&&['google.com','www.google.com'].includes(url.hostname)&&url.pathname.startsWith('/travel/flights')?url.href:'';
  }catch{return ''}
}

function safeImageUrl(value){
  try{
    const url=new URL(value);
    return url.protocol==='https:'?url.href:'';
  }catch{return ''}
}

function formatMoney(value,currency='EUR'){
  const number=Number(value);
  if(!Number.isFinite(number)||number<=0)return 'Precio a consultar';
  return new Intl.NumberFormat('es-ES',{style:'currency',currency,maximumFractionDigits:0}).format(number);
}

function formatDuration(value){
  const minutes=Number(value);
  if(!Number.isFinite(minutes)||minutes<=0)return 'Duración no indicada';
  const hours=Math.floor(minutes/60),rest=minutes%60;
  return `${hours?`${hours} h `:''}${rest?`${rest} min`:''}`.trim();
}

function stopLabel(stops){
  const count=Number(stops)||0;
  return count===0?'Directo':count===1?'1 escala':`${count} escalas`;
}

function flightTimeLabel(point){
  const time=String(point?.time||'').trim();
  return time?time.slice(-5):'—';
}

function readFlightQuery(form,airports){
  const data=new FormData(form),optionalNumber=name=>data.get(name)===''?null:Number(data.get(name));
  return {
    tripType:String(data.get('tripType')||'roundtrip'),
    origin:resolveAirportCode(data.get('origin'),airports),
    destination:resolveAirportCode(data.get('destination'),airports),
    departureDate:String(data.get('departureDate')||''),
    returnDate:String(data.get('returnDate')||''),
    adults:Number(data.get('adults')),
    children:Number(data.get('children')),
    infants:Number(data.get('infants')),
    travelClass:String(data.get('travelClass')||'economy'),
    stops:String(data.get('stops')||'any'),
    carryOnBags:Number(data.get('carryOnBags')),
    maxPrice:optionalNumber('maxPrice')
  };
}

function validateFlightQuery(query){
  if(!/^[A-Z]{3}$/.test(query.origin)||!/^[A-Z]{3}$/.test(query.destination))return 'Escribe una ciudad o un aeropuerto y elige una sugerencia, o introduce su código IATA.';
  if(query.origin===query.destination)return 'El origen y el destino deben ser distintos.';
  if(!query.departureDate)return 'Indica la fecha de ida.';
  if(query.tripType==='roundtrip'&&!query.returnDate)return 'Indica la fecha de vuelta.';
  if(query.tripType==='roundtrip'&&query.returnDate<=query.departureDate)return 'La fecha de vuelta debe ser posterior a la ida.';
  if(query.infants>query.adults)return 'Debe viajar al menos un adulto por cada bebé.';
  if(query.adults+query.children+query.infants>9)return 'La búsqueda admite un máximo de 9 pasajeros.';
  if(query.carryOnBags>query.adults+query.children+query.infants)return 'Las maletas de mano no pueden superar el número de pasajeros con asiento.';
  if(query.maxPrice!==null&&(!Number.isFinite(query.maxPrice)||query.maxPrice<1))return 'El precio máximo debe ser mayor que cero.';
  return '';
}

function renderFlightResult(option,index,query={}){
  const departure=option.departure||{},arrival=option.arrival||{};
  const airlines=Array.isArray(option.airlines)?option.airlines.filter(Boolean).join(', '):'';
  const logo=safeImageUrl(option.airlineLogo);
  const segments=Array.isArray(option.segments)?option.segments:[];
  return `<article class="flight-result">
    <div class="flight-result-main">
      <div class="flight-airline">${logo?`<img src="${esc(logo)}" alt="" loading="lazy" referrerpolicy="no-referrer">`:''}<span><small>${esc(option.group||`Opción ${index+1}`)}</small><strong>${esc(airlines||'Compañía por confirmar')}</strong></span></div>
      <div class="flight-route">
        <span><strong>${esc(flightTimeLabel(departure))}</strong><small>${esc(departure.airport||'Origen')}</small></span>
        <i aria-hidden="true"></i>
        <span><strong>${esc(flightTimeLabel(arrival))}</strong><small>${esc(arrival.airport||'Destino')}</small></span>
      </div>
      <div class="flight-meta"><span>${esc(formatDuration(option.durationMinutes))}</span><span>${esc(stopLabel(option.stops))}</span></div>
      <div class="flight-result-price"><strong>${esc(formatMoney(option.price,option.currency))}</strong><small>${option.priceStatus==='complete'?'Ida y vuelta seleccionadas · confirmar tarifa':'Salida vista · vuelta pendiente'}</small></div>
    </div>
    ${renderPriceBreakdown({total:option.price,currency:option.currency,query,flightPrice:option.price,complete:option.priceStatus==='complete'})}
    ${option.returnLeg?`<p class="flight-info">Vuelta: ${esc(option.returnLeg.departure?.airport||'—')} → ${esc(option.returnLeg.arrival?.airport||'—')} · ${esc(stopLabel(option.returnLeg.stops))}</p>`:''}
    ${segments.length>1?`<details><summary>Ver trayecto</summary><ol>${segments.map(segment=>`<li>${esc(segment.departure?.airport||'—')} → ${esc(segment.arrival?.airport||'—')} · ${esc(segment.airline||'Compañía por confirmar')} ${esc(segment.flightNumber||'')}</li>`).join('')}</ol></details>`:''}
  </article>`;
}

function renderFlightResponse(output,body,query){
  const searchUrl=safeGoogleFlightsUrl(body.searchUrl),results=Array.isArray(body.results)?body.results:[];
  if(!searchUrl)throw new Error('La respuesta no incluye un enlace seguro de Google Flights.');
  const roundtripNote=query.tripType==='roundtrip'?'<p class="flight-info">Solo la opción marcada “Ida y vuelta seleccionadas” incluye una vuelta comprobada. El resto son salidas pendientes de completar.</p>':'';
  const usage=Number.isFinite(Number(body.limits?.hourlyRemaining))?`<span class="flight-usage">${Number(body.limits.hourlyRemaining)} búsquedas disponibles durante esta hora</span>`:'';
  output.innerHTML=`
    <div class="flight-results-head"><div><span class="eyebrow">Google Flights vía SerpApi</span><h3>${results.length?`${results.length} opciones encontradas`:'Continúa en Google Flights'}</h3></div>${body.cached?'<span class="flight-cache">Resultado reciente</span>':''}</div>
    ${roundtripNote}
    ${results.length?`<div class="flight-result-list">${results.map((option,index)=>renderFlightResult(option,index,query)).join('')}</div>`:'<div class="flight-empty">No se han recibido opciones detalladas, pero puedes abrir la búsqueda completa con todos los filtros.</div>'}
    <div class="flight-confirm"><p>${esc(body.notice||FLIGHT_PRICE_NOTICE)}</p><a href="${esc(searchUrl)}" target="_blank" rel="noopener noreferrer">Confirmar precio en Google Flights ↗</a>${usage}</div>`;
  output.querySelectorAll('.flight-result').forEach((card,index)=>{const option=results[index];if(!option)return;const airlines=Array.isArray(option.airlines)?option.airlines.filter(Boolean).join(', '):'Vuelo';const message=`Rumbiva · ${query.origin} → ${query.destination}\n${query.departureDate}${query.returnDate?` → ${query.returnDate}`:''}\n${airlines} · ${formatMoney(option.price,option.currency)}\n${searchUrl}`;card.querySelector('.flight-result-price')?.insertAdjacentHTML('beforeend',`<a class="share-whatsapp" href="${esc(whatsappUrl(message))}" target="_blank" rel="noopener noreferrer">Compartir por WhatsApp</a>`)});
}

function formatDate(value){
  const date=new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime())?String(value||''):new Intl.DateTimeFormat('es-ES',{day:'numeric',month:'short',year:'numeric'}).format(date);
}

function renderFlightDeals(output,body){
  const results=Array.isArray(body.results)?body.results:[];
  if(!results.length){output.innerHTML=`<div class="flight-results-head"><h3>Sin destinos disponibles</h3><button class="ghost flight-results-close" type="button" data-close-explore>Cerrar resultados ×</button></div><div class="flight-empty">${esc(body.notice||'No se encontraron destinos para ese intervalo.')}</div>`;return}
  output.innerHTML=`<div class="flight-results-head"><div><span class="eyebrow">Fechas y destinos flexibles</span><h3>${results.length} destinos para explorar</h3></div><button class="ghost flight-results-close" type="button" data-close-explore>Cerrar resultados ×</button>${body.cached?'<span class="flight-cache">Resultado reciente</span>':''}</div>
    <p class="flight-info">${esc(body.notice||'Precios orientativos de Google Flights.')}</p>
    <div class="flight-deal-list">${results.map(item=>`<article class="flight-deal">
      <div><span class="flight-deal-code">${esc(item.destinationCode)}</span><h4>${esc(item.destinationName||item.destinationCode)}</h4><p>${esc(item.country||'Destino internacional')}</p></div>
      <div class="flight-deal-dates"><strong>${esc(formatDate(item.departureDate))} → ${esc(formatDate(item.returnDate))}</strong><span>${nightsBetween(item.departureDate,item.returnDate)} noches${item.airline?` · ${esc(item.airline)}`:''}${Number.isFinite(Number(item.stops))?` · ${esc(stopLabel(item.stops))}`:''}</span></div>
      <div class="flight-deal-price"><span><small>Vuelo desde</small><strong>${esc(formatMoney(item.flightPrice,item.currency))}</strong></span>${safeGoogleFlightsUrl(item.flightLink)?`<a href="${esc(safeGoogleFlightsUrl(item.flightLink))}" target="_blank" rel="noopener noreferrer">Ver oferta ↗</a>`:''}</div>
    </article>`).join('')}</div>`;
}

function validateDestinationQuery(query){
  const destinations=Array.isArray(query.destinations)&&query.destinations.length?query.destinations:[query.destination];
  if(!/^[A-Z]{3}$/.test(query.origin)||!destinations.length||destinations.length>3||destinations.some(code=>!/^[A-Z]{3}$/.test(code)))return 'Elige entre uno y tres destinos usando una ciudad, aeropuerto o código IATA.';
  if(new Set(destinations).size!==destinations.length||destinations.includes(query.origin))return 'Los destinos deben ser distintos del origen y entre sí.';
  if(query.flexible){if(!['3m','6m'].includes(query.flexiblePeriod)&&!/^\d{4}-(0[1-9]|1[0-2])$/.test(query.flexiblePeriod||''))return 'Elige un periodo dentro de los próximos seis meses.'}
  else {if(!/^\d{4}-\d{2}-\d{2}$/.test(query.startDate)||!/^\d{4}-\d{2}-\d{2}$/.test(query.endDate)||query.endDate<query.startDate)return 'La ventana de salida no es válida.';if((new Date(query.endDate)-new Date(query.startDate))/86400000>6)return 'Elige una ventana de salida de hasta 7 días.'}
  if(query.minNights<1||query.minNights>30)return 'La estancia debe ser de entre 1 y 30 noches.';
  if(query.adults<1||query.adults+query.children+query.infants>9)return 'La búsqueda admite entre 1 y 9 pasajeros.';
  if(query.infants>query.adults)return 'Debe viajar al menos un adulto por cada bebé.';
  if(query.carryOnBags<0||query.checkedBags<0||query.carryOnBags+query.checkedBags>query.adults+query.children+query.infants)return 'Las maletas no pueden superar el número de pasajeros.';
  if(query.maxBudget!==null&&(!Number.isFinite(query.maxBudget)||query.maxBudget<1))return 'El presupuesto debe ser mayor que cero.';
  if(!['any','nonstop','up_to_one'].includes(query.stops||'any'))return 'El filtro de escalas no es válido.';
  return '';
}

function renderDestinationResults(output,body,query,city,plans=[],hotelNotice=''){
  const results=Array.isArray(body.results)?body.results:[];
  const coverage=body.coverage||{},checked=Number(coverage.checked)||0,total=Number(coverage.total)||0,remaining=Number(coverage.remaining)||0,complete=coverage.complete===true;
  const baggageNotice=query.checkedBags>0?`<p class="flight-info">Has indicado ${query.checkedBags} maleta${query.checkedBags===1?' facturada':'s facturadas'}. La preferencia se guarda con el seguimiento; el coste exacto de equipaje se confirma en la web de compra.</p>`:'';
  const planCards=plans.length?`<section class="radar-plans"><div class="flight-results-head"><div><span class="eyebrow">Radar de escapadas</span><h3>${plans.length} ${plans.length===1?'plan comparable':'planes comparables'}</h3></div></div><p class="flight-info">El plan más barato es el menor subtotal de vuelo de ida y vuelta y hotel entre las fechas comprobadas recientemente. No se han consultado todos los días del periodo.</p>${plans.map((plan,index)=>`<article class="radar-plan"><div><span class="eyebrow">${esc(plan.rankLabel||'Plan comparable')}</span><h4>${esc(plan.destinationText||plan.destinationCode)} · ${esc(formatDate(plan.departureDate))} → ${esc(formatDate(plan.returnDate))}</h4><p>${esc(plan.airline||'Vuelo')} · ${esc(plan.hotel.name||'Alojamiento')}</p><small>${esc(plan.rankReason||'')}</small><label><input type="radio" name="selectedRadarPlan" value="${index}" ${index===0?'checked':''}> Seleccionar este plan para guardar o crear una alerta</label></div><div class="radar-plan-price"><strong>${esc(formatMoney(plan.total,'EUR'))}</strong><small>Vuelo ${esc(formatMoney(plan.flightPrice,'EUR'))} + hotel ${esc(formatMoney(plan.hotel.totalPrice,'EUR'))}</small>${renderPriceBreakdown({total:plan.total,currency:plan.currency,query,flightPrice:plan.flightPrice,hotelPrice:plan.hotel.totalPrice})}<div class="radar-plan-links">${safeGoogleFlightsUrl(plan.flightLink)?`<a href="${esc(safeGoogleFlightsUrl(plan.flightLink))}" target="_blank" rel="noopener noreferrer">Comprobar vuelo ↗</a>`:''}${safeOfferUrl(plan.hotel.url)?`<a href="${esc(safeOfferUrl(plan.hotel.url))}" target="_blank" rel="noopener noreferrer">Comprobar hotel ↗</a>`:''}<button type="button" data-share-plan="${index}">Compartir resumen</button></div></div></article>`).join('')}</section>`:`<p class="flight-info">${esc(hotelNotice||'Aún no hay planes con vuelo completo y hotel para las fechas comprobadas.')}</p>`;
  output.innerHTML=`<div class="flight-results-head"><div><span class="eyebrow">Seguimiento de destino · ${esc(city||query.destinations?.join(', ')||query.destination)}</span><h3>${results.length?`Más barato encontrado entre ${results.length} ${results.length===1?'fecha comprobada':'fechas comprobadas'}`:'Aún sin precios para las fechas comparadas'}</h3></div><button class="ghost flight-results-close" type="button" data-close-destination aria-label="Cerrar resultados de seguimiento">Cerrar resultados ×</button>${body.cached?'<span class="flight-cache">Resultado reciente</span>':''}</div>
    <p class="destination-coverage" role="status"><strong>${checked} de ${total} fechas de muestra comprobadas</strong>${complete?' · Muestra completa':` · ${remaining} muestras pendientes`}${coverage.sampled?` · Periodo de ${Number(coverage.horizonDays)||0} días. El menor precio se refiere solo a las fechas comprobadas.`:''}</p>${(body.byDestination||[]).map(item=>`<p class="destination-coverage"><strong>${esc(item.destination)}:</strong> ${Number(item.coverage?.checked)||0} de ${Number(item.coverage?.total)||0} fechas${item.error?` · ${esc(item.error)}`:''}</p>`).join('')}
    <p class="flight-info">${esc(body.notice||'Precios orientativos verificados en la última consulta.')}${Number(body.retryAfter)>0?` Vuelve en unos ${Math.ceil(Number(body.retryAfter)/60)} minutos.`:''}</p>${baggageNotice}
    ${remaining>0?'<button class="flight-submit destination-more" type="button">Comprobar otra fecha →</button>':''}
    ${renderPriceCalendar(body.byDestination||[])}${renderPlanComparison(plans,query)}${planCards}${results.length?`<details class="radar-flight-dates"><summary>Ver fechas de vuelo comprobadas</summary><div class="flight-deal-list">${results.map(item=>`<article class="flight-deal destination-deal"><div><span class="flight-deal-code">${esc(item.destinationCode)}</span><h4>${esc(city||item.destinationName||query.destination)}</h4><p>${esc(item.airline||'Compañía por confirmar')}${Number.isFinite(Number(item.stops))?` · ${esc(stopLabel(item.stops))}`:''}</p></div><div class="flight-deal-dates"><strong>${esc(formatDate(item.departureDate))} → ${esc(formatDate(item.returnDate))}</strong><span>${nightsBetween(item.departureDate,item.returnDate)} noches · ${query.adults+query.children+query.infants} pasajeros</span></div><div class="flight-deal-price"><span><small>Ida y vuelta · comprobado ${esc(item.checkedAt?new Date(item.checkedAt).toLocaleDateString('es-ES'):'recientemente')}</small><strong>${esc(formatMoney(item.flightPrice,item.currency))}</strong></span>${safeGoogleFlightsUrl(item.flightLink)?`<a href="${esc(safeGoogleFlightsUrl(item.flightLink))}" target="_blank" rel="noopener noreferrer">Ver vuelo ↗</a>`:''}</div></article>`).join('')}</div></details>`:'<div class="flight-empty">Aún no hay un precio verificable para este destino y las fechas comparadas.</div>'}`;
}

function safeOfferUrl(value){try{const url=new URL(value);return url.protocol==='https:'&&url.hostname.includes('.')?url.href:''}catch{return ''}}

/**
 * Inserta y activa el MVP de vuelos dentro de un elemento existente.
 * La hoja src/flights.css debe estar enlazada por la página anfitriona.
 */
let flightSearchInstance=0;
export function mountFlightSearch(container,options={}){
  const root=typeof container==='string'?document.querySelector(container):container;
  if(!(root instanceof Element))throw new Error('No se encontró el contenedor del buscador de vuelos.');
  const today=new Date(),departure=addDays(today,14),returnDate=addDays(today,21);
  const defaults={origin:'MAD',destination:'',...options.defaults};
  const instanceId=`hotelioAirports${++flightSearchInstance}`;
  root.innerHTML=`<section class="flight-search" aria-labelledby="flightSearchTitle">
    <nav class="flight-quick-nav" aria-label="Ir a una búsqueda de vuelos"><button type="button" data-flight-jump="flightSearchTitle">Vuelo con fechas</button><button type="button" data-flight-jump="flightExploreTitle">Explorar destinos</button><button type="button" data-flight-jump="destinationFollowTitle">Seguir un destino</button></nav>
    <div class="flight-heading"><div><span class="eyebrow">Vuelos</span><h2 id="flightSearchTitle">Busca tu vuelo</h2><p>Compara opciones sin reservar ni pagar dentro de Rumbiva.</p></div><span class="flight-provider">Google Flights</span></div>
    <form class="flight-form" novalidate>
      <div class="flight-grid flight-grid-main">
        <label class="flight-field"><span>Viaje</span><select name="tripType"><option value="roundtrip">Ida y vuelta</option><option value="oneway">Solo ida</option></select></label>
        <label class="flight-field"><span>Origen</span><input name="origin" list="${instanceId}Origin" required autocomplete="off" placeholder="Ciudad, aeropuerto o IATA" value="${esc(defaults.origin||'')}"></label>
        <button class="flight-swap" type="button" aria-label="Intercambiar origen y destino">⇄</button>
        <label class="flight-field"><span>Destino</span><input name="destination" list="${instanceId}Destination" required autocomplete="off" placeholder="Ciudad, aeropuerto o IATA" value="${esc(defaults.destination||'')}"></label>
        <label class="flight-field"><span>Ida</span><input name="departureDate" type="date" required min="${localIso(today)}" value="${localIso(departure)}"></label>
        <label class="flight-field flight-return"><span>Vuelta</span><input name="returnDate" type="date" required min="${localIso(addDays(departure,1))}" value="${localIso(returnDate)}"></label>
      </div>
      <div class="flight-grid flight-grid-options">
        <label class="flight-field"><span>Adultos</span><select name="adults">${Array.from({length:9},(_,index)=>`<option value="${index+1}" ${index===0?'selected':''}>${index+1}</option>`).join('')}</select></label>
        <label class="flight-field"><span>Niños (2–11)</span><select name="children">${Array.from({length:9},(_,index)=>`<option value="${index}">${index}</option>`).join('')}</select></label>
        <label class="flight-field"><span>Bebés con asiento</span><select name="infants">${Array.from({length:9},(_,index)=>`<option value="${index}">${index}</option>`).join('')}</select></label>
        <label class="flight-field"><span>Clase</span><select name="travelClass"><option value="economy">Turista</option><option value="premium_economy">Turista premium</option><option value="business">Business</option><option value="first">Primera</option></select></label>
        <label class="flight-field"><span>Escalas</span><select name="stops"><option value="any">Cualquiera</option><option value="nonstop">Solo directos</option><option value="up_to_one">Máximo 1 escala</option></select></label>
        <label class="flight-field"><span>Maletas de mano (total)</span><select name="carryOnBags">${Array.from({length:10},(_,index)=>`<option value="${index}">${index}</option>`).join('')}</select></label>
        <label class="flight-field"><span>Precio máximo total (€)</span><input name="maxPrice" type="number" min="1" max="100000" step="1" placeholder="Opcional"></label>
        <button class="flight-submit" type="submit">Buscar vuelos →</button>
      </div>
    </form>
    <datalist id="${instanceId}Origin"></datalist><datalist id="${instanceId}Destination"></datalist>
    <p class="flight-iata-help">Escribe una ciudad o un aeropuerto y elige una sugerencia; también puedes usar directamente MAD, BCN, FCO o JFK. Catálogo local de <a href="https://ourairports.com/data/" target="_blank" rel="noopener">OurAirports</a>; no consume búsquedas.</p>
    <p class="flight-legal">${esc(FLIGHT_PRICE_NOTICE)}</p>
    <div class="flight-output" aria-live="polite"></div>
    <section class="flight-explore" aria-labelledby="flightExploreTitle">
      <div class="flight-heading"><div><span class="eyebrow">Inspírate</span><h2 id="flightExploreTitle">Explorar destinos</h2><p>Encuentra los vuelos más baratos sin decidir antes el destino ni las fechas exactas.</p></div><span class="flight-provider">Google Flights Deals</span></div>
      <form class="flight-explore-form" novalidate>
        <div class="flight-grid flight-explore-grid">
          <label class="flight-field"><span>Origen</span><input name="origin" list="${instanceId}ExploreOrigin" required autocomplete="off" placeholder="Ciudad, aeropuerto o IATA" value="${esc(defaults.origin||'')}"></label>
          <label class="flight-field"><span>Próximos</span><select name="windowDays"><option value="30">30 días</option><option value="60">60 días</option><option value="90" selected>90 días</option></select></label>
          <label class="flight-field"><span>Estancia mínima</span><select name="minNights">${Array.from({length:14},(_,index)=>`<option value="${index+1}" ${index===2?'selected':''}>${index+1} noches</option>`).join('')}</select></label>
          <label class="flight-field"><span>Estancia máxima</span><select name="maxNights">${Array.from({length:30},(_,index)=>`<option value="${index+1}" ${index===6?'selected':''}>${index+1} noches</option>`).join('')}</select></label>
          <button class="flight-submit" type="submit">Explorar ofertas →</button>
        </div>
      </form>
      <p class="flight-iata-help">Esta búsqueda no pide destino: muestra las ofertas flexibles que el proveedor tenga disponibles desde tu aeropuerto.</p>
      <div class="flight-explore-output" aria-live="polite"></div>
    </section>
    <section class="flight-explore flight-destination-follow" aria-labelledby="destinationFollowTitle">
      <div class="flight-heading"><div><span class="eyebrow">Viaje flexible</span><h2 id="destinationFollowTitle">¿Cuándo sale más barato ir?</h2><p>Elige Roma, Dublín u otro destino. Buscaremos fechas repartidas por el periodo que prefieras y ordenaremos los viajes comprobados por precio.</p></div><span class="flight-provider">Fechas flexibles</span></div>
      <form class="flight-destination-form" novalidate>
        <div class="flight-grid flight-explore-grid">
          <label class="flight-field"><span>Origen</span><input name="origin" list="${instanceId}FollowOrigin" required autocomplete="off" placeholder="Ciudad, aeropuerto o IATA" value="${esc(defaults.origin||'')}"></label>
          <label class="flight-field"><span>Destino 1</span><input name="destination" list="${instanceId}FollowDestination" required autocomplete="off" placeholder="Ciudad, aeropuerto o IATA"></label>
          <label class="flight-field"><span>Destino 2 (opcional)</span><input name="destination2" list="${instanceId}FollowDestination2" autocomplete="off" placeholder="Ciudad, aeropuerto o IATA"></label>
          <label class="flight-field"><span>Destino 3 (opcional)</span><input name="destination3" list="${instanceId}FollowDestination3" autocomplete="off" placeholder="Ciudad, aeropuerto o IATA"></label>
          <label class="flight-field"><span>¿Cuándo puedes viajar?</span><select name="flexiblePeriod"><option value="6m" selected>Cualquier fecha · próximos 6 meses</option><option value="3m">Cualquier fecha · próximos 3 meses</option>${Array.from({length:6},(_,index)=>{const month=new Date(today.getFullYear(),today.getMonth()+index,1);return `<option value="${month.getFullYear()}-${String(month.getMonth()+1).padStart(2,'0')}">${esc(new Intl.DateTimeFormat('es-ES',{month:'long',year:'numeric'}).format(month))}</option>`}).join('')}</select></label>
          <label class="flight-field"><span>Noches</span><select name="minNights">${Array.from({length:14},(_,index)=>`<option value="${index+1}" ${index===6?'selected':''}>${index+1} ${index===0?'noche':'noches'}</option>`).join('')}</select></label>
        </div>
        <div class="flight-grid flight-grid-options destination-options">
          <label class="flight-field"><span>Adultos</span><select name="adults">${Array.from({length:9},(_,index)=>`<option value="${index+1}" ${index===0?'selected':''}>${index+1}</option>`).join('')}</select></label>
          <label class="flight-field"><span>Niños (2–11)</span><select name="children">${Array.from({length:9},(_,index)=>`<option value="${index}">${index}</option>`).join('')}</select></label>
          <label class="flight-field"><span>Bebés</span><select name="infants">${Array.from({length:9},(_,index)=>`<option value="${index}">${index}</option>`).join('')}</select></label>
          <label class="flight-field"><span>Maletas de mano</span><select name="carryOnBags">${Array.from({length:10},(_,index)=>`<option value="${index}">${index}</option>`).join('')}</select></label>
          <label class="flight-field"><span>Maletas facturadas</span><select name="checkedBags">${Array.from({length:10},(_,index)=>`<option value="${index}">${index}</option>`).join('')}</select></label>
          <label class="flight-field"><span>Presupuesto total (€)</span><input name="maxBudget" type="number" min="1" step="1" placeholder="Opcional"></label>
          <label class="flight-field"><span>Escalas</span><select name="stops"><option value="any">Cualquiera</option><option value="nonstop">Sin escalas</option><option value="up_to_one">Máximo una</option></select></label>
          <label class="flight-field"><input name="noEarlyDeparture" type="checkbox"> Evitar salidas antes de las 08:00</label>
          <button class="flight-submit" type="submit">Buscar fechas baratas →</button>
        </div>
      </form>
      <p class="flight-iata-help">Comparamos fechas repartidas entre los próximos meses, sin pedirte una ventana concreta. Verás el menor precio encontrado entre las fechas realmente comprobadas y cuántas faltan en la muestra. Cada fecha verificada requiere consultas del proveedor; puedes ampliar la muestra poco a poco. Las maletas facturadas se confirman al comprar.</p>
      <div class="flight-destination-output" aria-live="polite"></div>
    </section><datalist id="${instanceId}ExploreOrigin"></datalist><datalist id="${instanceId}FollowOrigin"></datalist><datalist id="${instanceId}FollowDestination"></datalist><datalist id="${instanceId}FollowDestination2"></datalist><datalist id="${instanceId}FollowDestination3"></datalist>
  </section>`;

  const form=root.querySelector('.flight-form'),output=root.querySelector('.flight-output'),exploreForm=root.querySelector('.flight-explore-form'),exploreOutput=root.querySelector('.flight-explore-output'),destinationForm=root.querySelector('.flight-destination-form'),destinationOutput=root.querySelector('.flight-destination-output');
  let airports=[];
  const updateSuggestions=input=>{
    root.querySelector(`#${input.getAttribute('list')}`).innerHTML=searchAirports(input.value,airports).map(airport=>`<option value="${esc(airportLabel(airport))}"></option>`).join('');
  };
  const airportInputs=[form.elements.origin,form.elements.destination,exploreForm.elements.origin,destinationForm.elements.origin,destinationForm.elements.destination,destinationForm.elements.destination2,destinationForm.elements.destination3];
  airportInputs.forEach(input=>input.addEventListener('input',()=>updateSuggestions(input)));
  const airportsReady=loadAirports(options.airportsUrl||defaultAirportDataUrl()).then(loaded=>{
    airports=loaded;airportInputs.forEach(updateSuggestions);
    if(!airports.length)root.querySelector('.flight-iata-help').textContent='No se pudo cargar el catálogo de ciudades y aeropuertos. Puedes usar un código IATA o recargar la página para volver a intentarlo.';
  });
  const tripType=form.elements.tripType,returnField=root.querySelector('.flight-return');
  const syncTripType=()=>{
    const roundtrip=tripType.value==='roundtrip';
    returnField.hidden=!roundtrip;
    form.elements.returnDate.required=roundtrip;
  };
  const syncReturnMinimum=()=>{
    const departureValue=form.elements.departureDate.value;
    if(!departureValue)return;
    const minimum=new Date(`${departureValue}T12:00:00`);minimum.setDate(minimum.getDate()+1);
    form.elements.returnDate.min=localIso(minimum);
    if(form.elements.returnDate.value<=departureValue)form.elements.returnDate.value=localIso(minimum);
  };
  const swap=()=>{
    const origin=form.elements.origin.value;
    form.elements.origin.value=form.elements.destination.value;
    form.elements.destination.value=origin;
    airportInputs.forEach(updateSuggestions);
  };
  let controller=null,exploreController=null,destinationController=null;
  const submit=async event=>{
    event.preventDefault();
    await airportsReady;
    const query=readFlightQuery(form,airports),validation=validateFlightQuery(query);
    if(validation){output.innerHTML=`<div class="flight-error">${esc(validation)}</div>`;return}
    showResolvedAirport(form.elements.origin,query.origin);
    showResolvedAirport(form.elements.destination,query.destination);
    controller?.abort();
    const requestController=new AbortController();controller=requestController;
    const button=form.querySelector('.flight-submit');button.disabled=true;button.textContent='Buscando…';
    output.innerHTML='<div class="flight-loading"><i></i><i></i><i></i><span>Consultando una vez y buscando en la caché…</span></div>';
    try{
      const body=await searchFlights(query,{endpoint:options.endpoint||defaultFlightEndpoint(),signal:requestController.signal});
      renderFlightResponse(output,body,query);
      const cheapest=(body.results||[]).filter(item=>Number(item.price)>0).sort((a,b)=>a.price-b.price)[0];
      window.dispatchEvent(new CustomEvent('vuelotel:search-complete',{detail:{type:'flight',label:`${query.origin} → ${query.destination}`,query,price:cheapest?.price??null,currency:cheapest?.currency||'EUR'}}));
    }catch(error){
      if(error.name!=='AbortError')output.innerHTML=`<div class="flight-error"><strong>No se pudo completar la búsqueda.</strong><span>${esc(error.message||'Inténtalo de nuevo más tarde.')}</span></div>`;
    }finally{
      if(controller===requestController){controller=null;button.disabled=false;button.textContent='Buscar vuelos →'}
    }
  };

  const explore=async event=>{
    event.preventDefault();
    await airportsReady;
    const data=new FormData(exploreForm),origin=resolveAirportCode(data.get('origin'),airports),windowDays=Number(data.get('windowDays')),minNights=Number(data.get('minNights')),maxNights=Number(data.get('maxNights'));
    if(!/^[A-Z]{3}$/.test(origin)){exploreOutput.innerHTML='<div class="flight-error">Escribe una ciudad o aeropuerto y elige una sugerencia, o introduce su código IATA.</div>';return}
    if(minNights<1||maxNights>30||minNights>maxNights){exploreOutput.innerHTML='<div class="flight-error">La estancia máxima debe ser igual o mayor que la mínima.</div>';return}
    showResolvedAirport(exploreForm.elements.origin,origin);
    exploreController?.abort();
    const requestController=new AbortController();exploreController=requestController;
    const button=exploreForm.querySelector('.flight-submit');button.disabled=true;button.textContent='Explorando…';
    exploreOutput.innerHTML='<button class="ghost flight-results-close" type="button" data-close-explore>Cerrar búsqueda ×</button><div class="flight-loading"><i></i><i></i><i></i><span>Buscando destinos y fechas económicas…</span></div>';
    const startDate=localIso(addDays(new Date(),1)),endDate=localIso(addDays(new Date(),windowDays));
    try{
      const body=await searchFlightDeals({origin,startDate,endDate,minNights,maxNights},{endpoint:options.dealsEndpoint||defaultFlightDealsEndpoint(),signal:requestController.signal});
      if(exploreController!==requestController)return;
      renderFlightDeals(exploreOutput,body);
    }catch(error){
      if(exploreController===requestController&&error.name!=='AbortError')exploreOutput.innerHTML=`<button class="ghost flight-results-close" type="button" data-close-explore>Cerrar resultados ×</button><div class="flight-error"><strong>No se pudieron explorar destinos.</strong><span>${esc(error.message||'Inténtalo de nuevo más tarde.')}</span></div>`;
    }finally{
      if(exploreController===requestController){exploreController=null;button.disabled=false;button.textContent='Explorar ofertas →'}
    }
  };
  exploreOutput.addEventListener('click',event=>{if(event.target.closest('[data-close-explore]')){exploreController?.abort();exploreController=null;exploreOutput.replaceChildren();const button=exploreForm.querySelector('.flight-submit');button.disabled=false;button.textContent='Explorar ofertas →';button.focus()}});

  const hotelByDate=new Map();
  const readDestinationQuery=()=>{
    const data=new FormData(destinationForm);return {
      origin:resolveAirportCode(data.get('origin'),airports),destination:resolveAirportCode(data.get('destination'),airports),destinations:['destination','destination2','destination3'].map(name=>String(data.get(name)||'').trim()).filter(Boolean).map(value=>resolveAirportCode(value,airports)),
      flexible:true,flexiblePeriod:String(data.get('flexiblePeriod')||'6m'),startDate:'',endDate:'',minNights:Number(data.get('minNights')),
      adults:Number(data.get('adults')),children:Number(data.get('children')),infants:Number(data.get('infants')),
      carryOnBags:Number(data.get('carryOnBags')),checkedBags:Number(data.get('checkedBags')),maxBudget:data.get('maxBudget')===''?null:Number(data.get('maxBudget')),travelClass:'economy',stops:String(data.get('stops')||'any'),noEarlyDeparture:data.has('noEarlyDeparture')
    }};
  const comparablePlans=async(body,query,signal)=>{
    const departures=(body.results||[]).filter(item=>item.priceStatus==='complete'&&Number(item.flightPrice)>0&&(!query.flexible||Date.now()-Date.parse(item.checkedAt)<86400000)).sort((a,b)=>a.flightPrice-b.flightPrice).filter((item,_,items)=>items.filter(other=>other.destinationCode===item.destinationCode&&other.flightPrice<=item.flightPrice).indexOf(item)<2).slice(0,6);
    if(!departures.length)return {plans:[],notice:'No se confirmó aún una ida y vuelta para estas fechas.'};
    const providers=await (options.providersPromise||Promise.resolve([]));
    const provider=providers.find(item=>item.enabled&&item.id==='serpapi');
    if(!provider)return {plans:[],notice:'Los planes con hotel necesitan que Google Hotels esté habilitado. Los vuelos comprobados siguen disponibles abajo.'};
    const failures=[];
    const plans=await Promise.all(departures.map(async flight=>{
      const city=airports.find(airport=>airport.iata===flight.destinationCode)?.city;
      const hotelQuery={destination:city||flight.destinationCode,checkIn:flight.departureDate,checkOut:flight.returnDate,adults:query.adults,children:query.children,childrenAges:Array(query.children).fill(8),guests:query.adults+query.children,rooms:1,minPrice:null,maxPrice:null,accommodationType:'any',board:'any',currency:'EUR',nights:query.minNights};
      const key=JSON.stringify(hotelQuery),cached=hotelByDate.get(key);
      let hotels;
      if(cached&&cached.at>Date.now()-3600000)hotels=cached.hotels;
      else {
        try{const response=await searchPublicProvider(provider,hotelQuery,{signal});hotels=response.results||[];hotelByDate.set(key,{at:Date.now(),hotels})}
        catch(error){failures.push(error.message||'No se pudo consultar el hotel.');return null}
      }
      const hotel=hotels.filter(item=>item.persistable!==false&&Number(item.totalPrice)>0&&item.currency==='EUR'&&safeOfferUrl(item.url)).sort((a,b)=>a.totalPrice-b.totalPrice)[0];
      if(!hotel)return null;
      const total=Number(flight.flightPrice)+Number(hotel.totalPrice);
      if(query.maxBudget!==null&&total>query.maxBudget)return null;
      return {destinationCode:flight.destinationCode,departureDate:flight.departureDate,returnDate:flight.returnDate,destinationText:city||flight.destinationCode,flightPrice:Number(flight.flightPrice),flightLink:flight.flightLink,airline:flight.airline,stops:flight.stops,returnStops:flight.returnStops,outboundDepartureTime:flight.outboundDepartureTime,returnDepartureTime:flight.returnDepartureTime,priceStatus:'complete',hotel:{name:hotel.name,totalPrice:Number(hotel.totalPrice),currency:'EUR',provider:hotel.provider,url:hotel.url,rating:hotel.rating,location:hotel.location},total,currency:'EUR',checkedAt:flight.checkedAt||new Date().toISOString(),hotelCheckedAt:new Date().toISOString()};
    }));
    return {plans:plans.filter(Boolean).sort((a,b)=>a.total-b.total),notice:failures[0]||(query.maxBudget!==null?'Ningún plan comprobado entra en el presupuesto indicado.':'No se recibió una oferta de hotel comparable para las fechas de vuelo comprobadas.')};
  };
  const runDestination=async(query,continueSearch=false)=>{
    const validation=validateDestinationQuery(query);
    if(validation){destinationOutput.innerHTML=`<div class="flight-error">${esc(validation)}</div>`;return}
    showResolvedAirport(destinationForm.elements.origin,query.origin);
    ['destination','destination2','destination3'].forEach((name,index)=>{if(query.destinations[index])showResolvedAirport(destinationForm.elements[name],query.destinations[index])});
    destinationController?.abort();const requestController=new AbortController();destinationController=requestController;
    const button=continueSearch?destinationOutput.querySelector('.destination-more'):destinationForm.querySelector('.flight-submit');button.disabled=true;button.textContent='Comparando…';if(!continueSearch)destinationOutput.innerHTML='<button class="ghost flight-results-close" type="button" data-close-destination>Cerrar búsqueda ×</button><div class="flight-loading"><i></i><i></i><i></i><span>Buscando fechas flexibles y verificando el precio…</span></div>';
    try{
      const byDestination=[];
      for(const destination of query.destinations){
        if(requestController.signal.aborted)return;
        try{const response=await searchDestination({...query,destination,compareDestinations:query.destinations.length>1},{endpoint:options.destinationEndpoint||defaultDestinationSearchEndpoint(),signal:requestController.signal,continueSearch});byDestination.push({destination,...response})}
        catch(error){if(error.name==='AbortError')throw error;byDestination.push({destination,error:error.message,results:[],coverage:{checked:0,total:0,remaining:0,complete:false,sampled:true}})}
      }
      if(byDestination.every(item=>item.error))throw new Error(byDestination.map(item=>`${item.destination}: ${item.error}`).join(' · '));
      const results=byDestination.flatMap(item=>(item.results||[]).map(result=>({...result,destinationCode:item.destination}))).sort((a,b)=>Number(a.flightPrice)-Number(b.flightPrice));
      const checked=byDestination.reduce((sum,item)=>sum+(Number(item.coverage?.checked)||0),0),total=byDestination.reduce((sum,item)=>sum+(Number(item.coverage?.total)||0),0);
      const body={results,byDestination,coverage:{checked,total,remaining:Math.max(0,total-checked),complete:byDestination.every(item=>item.coverage?.complete===true),sampled:query.flexible,horizonDays:byDestination[0]?.coverage?.horizonDays},cached:byDestination.every(item=>item.cached),notice:byDestination.map(item=>item.error?`${item.destination}: ${item.error}`:item.notice).filter(Boolean).join(' · ')};
      const {plans:allPlans,notice}=await comparablePlans(body,query,requestController.signal);
      const plans=rankRadarPlans(allPlans);
      if(destinationController!==requestController)return;
      renderDestinationResults(destinationOutput,body,query,'',plans,notice);
      destinationOutput.querySelector('.destination-more')?.addEventListener('click',()=>runDestination(query,true));
      const cheapest=(body.results||[]).filter(item=>Number(item.flightPrice)>0).sort((a,b)=>a.flightPrice-b.flightPrice)[0]||null;
      const emitSelection=index=>{const selected=plans[index],selectedCode=selected?.destinationCode||query.destinations[0],selectedCoverage=byDestination.find(item=>item.destination===selectedCode)?.coverage||body.coverage;window.dispatchEvent(new CustomEvent('vuelotel:search-complete',{detail:{type:'destination',label:`Seguir ${selected?.destinationText||query.destinations.join(', ')} desde ${query.origin}`,query:{...query,destination:selectedCode,plans:selected?[selected]:[],coverage:selectedCoverage,coverageByDestination:byDestination.map(item=>({destination:item.destination,coverage:item.coverage})),planCheckedAt:new Date().toISOString()},price:selected?.flightPrice??cheapest?.flightPrice??null,currency:'EUR'}}))};
      emitSelection(0);
      destinationOutput.querySelectorAll('[name="selectedRadarPlan"]').forEach(radio=>radio.addEventListener('change',()=>emitSelection(Number(radio.value))));
      destinationOutput.querySelectorAll('[data-share-plan]').forEach(share=>share.addEventListener('click',async()=>{try{const link=radarShareUrl(plans[Number(share.dataset.sharePlan)],location.href);if(navigator.share)await navigator.share({title:'Plan Rumbiva',url:link});else if(navigator.clipboard){await navigator.clipboard.writeText(link);share.textContent='Enlace copiado'}else window.open(`https://wa.me/?text=${encodeURIComponent(link)}`,'_blank','noopener')}catch(error){if(error.name!=='AbortError')share.textContent='No se pudo compartir'}}));
    }catch(error){
      if(destinationController===requestController&&error.name!=='AbortError'){const message=`<div class="flight-error"><strong>No se pudieron buscar fechas.</strong><span>${esc(error.message||'Inténtalo de nuevo más tarde.')}</span></div>`;if(continueSearch)destinationOutput.insertAdjacentHTML('beforeend',message);else destinationOutput.innerHTML=`<button class="ghost flight-results-close" type="button" data-close-destination>Cerrar resultados ×</button>${message}`}
    }finally{
      if(destinationController===requestController){destinationController=null;if(button.isConnected){button.disabled=false;button.textContent=continueSearch?'Comprobar otra fecha →':'Buscar fechas baratas →'}}
    }
  };
  destinationOutput.addEventListener('click',event=>{if(event.target.closest('[data-close-destination]')){destinationController?.abort();destinationController=null;destinationOutput.replaceChildren();document.querySelector('#searchActions')?.remove();const button=destinationForm.querySelector('.flight-submit');button.disabled=false;button.textContent='Buscar fechas baratas →';button.focus()}});
  const followDestination=async event=>{event.preventDefault();await airportsReady;await runDestination(readDestinationQuery())};

  tripType.addEventListener('change',syncTripType);
  form.elements.departureDate.addEventListener('change',syncReturnMinimum);
  root.querySelector('.flight-swap').addEventListener('click',swap);
  form.addEventListener('submit',submit);
  exploreForm.addEventListener('submit',explore);
  destinationForm.addEventListener('submit',followDestination);
  root.querySelectorAll('[data-flight-jump]').forEach(button=>button.addEventListener('click',()=>root.querySelector(`#${button.dataset.flightJump}`)?.scrollIntoView({behavior:'smooth',block:'start'})));
  syncTripType();syncReturnMinimum();

  return {destroy(){controller?.abort();exploreController?.abort();destinationController?.abort();root.replaceChildren()},form};
}

export {FLIGHT_PRICE_NOTICE,resolveAirportCode,searchAirports,searchFlights,searchDestination,showResolvedAirport,validateFlightQuery,validateDestinationQuery};
import {searchPublicProvider} from './providers.js?v=1.2.2';
import {rankRadarPlans,radarShareUrl} from './radar-plans.js?v=2.6.0';
