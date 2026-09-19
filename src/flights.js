const FLIGHT_PRICE_NOTICE='Los precios son orientativos y pueden cambiar. Confirma siempre el precio final y las condiciones en Google Flights o en la página de compra. Vuelotel no gestiona pagos ni reservas.';

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

async function searchFlightDeals(query,{endpoint=defaultFlightDealsEndpoint(),signal}={}){
  const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify({query}),signal});
  const body=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(body.error||`Error HTTP ${response.status}`);
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

function renderFlightResult(option,index){
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
      <div class="flight-result-price"><strong>${esc(formatMoney(option.price,option.currency))}</strong><small>Precio mostrado por Google Flights</small></div>
    </div>
    ${segments.length>1?`<details><summary>Ver trayecto</summary><ol>${segments.map(segment=>`<li>${esc(segment.departure?.airport||'—')} → ${esc(segment.arrival?.airport||'—')} · ${esc(segment.airline||'Compañía por confirmar')} ${esc(segment.flightNumber||'')}</li>`).join('')}</ol></details>`:''}
  </article>`;
}

function renderFlightResponse(output,body,query){
  const searchUrl=safeGoogleFlightsUrl(body.searchUrl),results=Array.isArray(body.results)?body.results:[];
  if(!searchUrl)throw new Error('La respuesta no incluye un enlace seguro de Google Flights.');
  const roundtripNote=query.tripType==='roundtrip'?'<p class="flight-info">Estas son opciones iniciales de salida. Google Flights completa allí la selección de la vuelta y recalcula el precio final.</p>':'';
  const usage=Number.isFinite(Number(body.limits?.hourlyRemaining))?`<span class="flight-usage">${Number(body.limits.hourlyRemaining)} búsquedas disponibles durante esta hora</span>`:'';
  output.innerHTML=`
    <div class="flight-results-head"><div><span class="eyebrow">Google Flights vía SerpApi</span><h3>${results.length?`${results.length} opciones encontradas`:'Continúa en Google Flights'}</h3></div>${body.cached?'<span class="flight-cache">Resultado reciente</span>':''}</div>
    ${roundtripNote}
    ${results.length?`<div class="flight-result-list">${results.map(renderFlightResult).join('')}</div>`:'<div class="flight-empty">No se han recibido opciones detalladas, pero puedes abrir la búsqueda completa con todos los filtros.</div>'}
    <div class="flight-confirm"><p>${esc(body.notice||FLIGHT_PRICE_NOTICE)}</p><a href="${esc(searchUrl)}" target="_blank" rel="noopener noreferrer">Confirmar precio en Google Flights ↗</a>${usage}</div>`;
  output.querySelectorAll('.flight-result').forEach((card,index)=>{const option=results[index];if(!option)return;const airlines=Array.isArray(option.airlines)?option.airlines.filter(Boolean).join(', '):'Vuelo';const message=`Vuelotel · ${query.origin} → ${query.destination}\n${query.departureDate}${query.returnDate?` → ${query.returnDate}`:''}\n${airlines} · ${formatMoney(option.price,option.currency)}\n${searchUrl}`;card.querySelector('.flight-result-price')?.insertAdjacentHTML('beforeend',`<a class="share-whatsapp" href="${esc(whatsappUrl(message))}" target="_blank" rel="noopener noreferrer">Compartir por WhatsApp</a>`)});
}

function formatDate(value){
  const date=new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime())?String(value||''):new Intl.DateTimeFormat('es-ES',{day:'numeric',month:'short',year:'numeric'}).format(date);
}

function renderFlightDeals(output,body){
  const results=Array.isArray(body.results)?body.results:[];
  if(!results.length){output.innerHTML=`<div class="flight-empty">${esc(body.notice||'No se encontraron destinos para ese intervalo.')}</div>`;return}
  output.innerHTML=`<div class="flight-results-head"><div><span class="eyebrow">Fechas y destinos flexibles</span><h3>${results.length} destinos para explorar</h3></div>${body.cached?'<span class="flight-cache">Resultado reciente</span>':''}</div>
    <p class="flight-info">${esc(body.notice||'Precios orientativos de Google Flights.')}</p>
    <div class="flight-deal-list">${results.map(item=>`<article class="flight-deal">
      <div><span class="flight-deal-code">${esc(item.destinationCode)}</span><h4>${esc(item.destinationName||item.destinationCode)}</h4><p>${esc(item.country||'Destino internacional')}</p></div>
      <div class="flight-deal-dates"><strong>${esc(formatDate(item.departureDate))} → ${esc(formatDate(item.returnDate))}</strong><span>${nightsBetween(item.departureDate,item.returnDate)} noches${item.airline?` · ${esc(item.airline)}`:''}${Number.isFinite(Number(item.stops))?` · ${esc(stopLabel(item.stops))}`:''}</span></div>
      <div class="flight-deal-price"><span><small>Vuelo desde</small><strong>${esc(formatMoney(item.flightPrice,item.currency))}</strong></span>${safeGoogleFlightsUrl(item.flightLink)?`<a href="${esc(safeGoogleFlightsUrl(item.flightLink))}" target="_blank" rel="noopener noreferrer">Ver oferta ↗</a>`:''}</div>
    </article>`).join('')}</div>`;
}

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
    <div class="flight-heading"><div><span class="eyebrow">Vuelos</span><h2 id="flightSearchTitle">Busca tu vuelo</h2><p>Compara opciones sin reservar ni pagar dentro de Vuelotel.</p></div><span class="flight-provider">Google Flights</span></div>
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
    </section><datalist id="${instanceId}ExploreOrigin"></datalist>
  </section>`;

  const form=root.querySelector('.flight-form'),output=root.querySelector('.flight-output'),exploreForm=root.querySelector('.flight-explore-form'),exploreOutput=root.querySelector('.flight-explore-output');
  let airports=[];
  const updateSuggestions=input=>{
    root.querySelector(`#${input.getAttribute('list')}`).innerHTML=searchAirports(input.value,airports).map(airport=>`<option value="${esc(airportLabel(airport))}"></option>`).join('');
  };
  const airportInputs=[form.elements.origin,form.elements.destination,exploreForm.elements.origin];
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
  let controller=null,exploreController=null;
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
    exploreOutput.innerHTML='<div class="flight-loading"><i></i><i></i><i></i><span>Buscando destinos y fechas económicas…</span></div>';
    const startDate=localIso(addDays(new Date(),1)),endDate=localIso(addDays(new Date(),windowDays));
    try{
      const body=await searchFlightDeals({origin,startDate,endDate,minNights,maxNights},{endpoint:options.dealsEndpoint||defaultFlightDealsEndpoint(),signal:requestController.signal});
      renderFlightDeals(exploreOutput,body);
    }catch(error){
      if(error.name!=='AbortError')exploreOutput.innerHTML=`<div class="flight-error"><strong>No se pudieron explorar destinos.</strong><span>${esc(error.message||'Inténtalo de nuevo más tarde.')}</span></div>`;
    }finally{
      if(exploreController===requestController){exploreController=null;button.disabled=false;button.textContent='Explorar ofertas →'}
    }
  };

  tripType.addEventListener('change',syncTripType);
  form.elements.departureDate.addEventListener('change',syncReturnMinimum);
  root.querySelector('.flight-swap').addEventListener('click',swap);
  form.addEventListener('submit',submit);
  exploreForm.addEventListener('submit',explore);
  syncTripType();syncReturnMinimum();

  return {destroy(){controller?.abort();exploreController?.abort();root.replaceChildren()},form};
}

export {FLIGHT_PRICE_NOTICE,resolveAirportCode,searchAirports,searchFlights,showResolvedAirport,validateFlightQuery};
