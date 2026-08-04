import {searchPublicProvider} from './providers.js?v=1.2.2';
import {FLIGHT_PRICE_NOTICE,resolveAirportCode,searchFlights,showResolvedAirport,validateFlightQuery} from './flights.js?v=1.2.2';

const esc=value=>String(value??'').replace(/[&<>'"]/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[character]));
const iso=date=>date.toISOString().slice(0,10);
const addDays=(date,days)=>{const copy=new Date(date);copy.setDate(copy.getDate()+days);return copy};
const money=(value,currency='EUR')=>new Intl.NumberFormat('es-ES',{style:'currency',currency,maximumFractionDigits:0}).format(Number(value)||0);
const nightsBetween=(from,to)=>Math.max(1,Math.round((new Date(to)-new Date(from))/86400000));
const flexibleDealsEndpoint=()=>location.protocol==='capacitor:'||location.protocol==='file:'?'https://www.alufi.es/vuelotel/api/flight-deals.php':new URL('./api/flight-deals.php',document.baseURI).href;

async function loadAirports(list,url){
  const response=await fetch(url,{headers:{Accept:'application/json'},cache:'force-cache'}),body=await response.json();
  const airports=Array.isArray(body.airports)?body.airports:[];
  list.innerHTML=airports.map(airport=>`<option value="${esc(`${[airport.city,airport.name,airport.country].filter(Boolean).join(' · ')} (${airport.iata})`)}"></option>`).join('');
  return airports;
}

function destinationName(value,code,airports){
  const airport=airports.find(item=>item.iata===code);
  return airport?.city||String(value||'').replace(/\s*\([A-Za-z]{3}\)\s*$/,'').split(' · ')[0].trim()||code;
}

function flightLabel(option,index){
  const airlines=Array.isArray(option.airlines)?option.airlines.filter(Boolean).join(', '):'';
  const departure=option.departure||{},arrival=option.arrival||{},stops=Number(option.stops)||0;
  return `<label class="combo-option"><input type="radio" name="comboFlight" value="${index}" ${index===0?'checked':''}><span><strong>${esc(airlines||`Vuelo ${index+1}`)}</strong><small>${esc(departure.time||departure.airport||'Origen')} → ${esc(arrival.time||arrival.airport||'Destino')} · ${stops?`${stops} escala(s)`:'Directo'}</small></span><b>${esc(money(option.price,option.currency))}</b></label>`;
}

function hotelLabel(hotel,index){
  return `<label class="combo-option"><input type="radio" name="comboHotel" value="${index}" ${index===0?'checked':''}><span><strong>${esc(hotel.name||`Alojamiento ${index+1}`)}</strong><small>${esc(hotel.provider||'Proveedor')} ${hotel.rating?`· ★ ${esc(hotel.rating)}`:''}</small></span><b>${esc(money(hotel.totalPrice,hotel.currency))}</b></label>`;
}

export function mountCombinedSearch(container,{providersPromise}={}){
  const root=typeof container==='string'?document.querySelector(container):container;
  if(!(root instanceof Element))throw new Error('No se encontró el contenedor de hotel + vuelo.');
  const today=new Date(),departure=addDays(today,14),returnDate=addDays(today,21);
  root.innerHTML=`<section class="combo-search">
    <div class="flight-heading"><div><span class="eyebrow">Viaje completo</span><h2>Hotel + vuelo</h2><p>Busca ambos a la vez, elige tu combinación y calcula el total estimado.</p></div><span class="flight-provider">Reserva por separado</span></div>
    <form class="combo-form" novalidate><div class="combo-grid">
      <label class="flight-field"><span>Origen</span><input name="origin" list="comboAirports" required placeholder="Madrid o MAD" value="MAD"></label>
      <label class="flight-field"><span>Destino</span><input name="destination" list="comboAirports" required placeholder="Roma o FCO"></label>
      <label class="flight-field"><span>Ida / entrada</span><input name="departureDate" type="date" required min="${iso(today)}" value="${iso(departure)}"></label>
      <label class="flight-field"><span>Vuelta / salida</span><input name="returnDate" type="date" required min="${iso(addDays(departure,1))}" value="${iso(returnDate)}"></label>
      <label class="flight-field"><span>Adultos</span><select name="adults">${Array.from({length:6},(_,i)=>`<option value="${i+1}" ${i===1?'selected':''}>${i+1}</option>`).join('')}</select></label>
      <label class="flight-field"><span>Niños (2–11)</span><select name="children">${Array.from({length:5},(_,i)=>`<option value="${i}">${i}</option>`).join('')}</select></label>
      <label class="flight-field"><span>Clase</span><select name="travelClass"><option value="economy">Turista</option><option value="premium_economy">Turista premium</option><option value="business">Business</option><option value="first">Primera</option></select></label>
      <label class="flight-field"><span>Escalas</span><select name="stops"><option value="any">Cualquiera</option><option value="nonstop">Solo directos</option><option value="up_to_one">Máximo 1 escala</option></select></label>
      <label class="flight-field"><span>Maletas de mano (total)</span><select name="carryOnBags">${Array.from({length:10},(_,i)=>`<option value="${i}">${i}</option>`).join('')}</select></label>
      <label class="flight-field"><span>Maletas facturadas (opcional)</span><select name="checkedBags">${Array.from({length:10},(_,i)=>`<option value="${i}">${i}</option>`).join('')}</select></label>
      <label class="flight-field combo-flex"><span>Fechas</span><select name="dateMode"><option value="exact">Fechas exactas</option><option value="flexible">Flexibles (próximos 90 días)</option></select></label>
      <label class="flight-field combo-duration" hidden><span>Duración flexible</span><span class="combo-duration-inputs"><input name="minNights" type="number" min="1" max="30" value="3"><b>–</b><input name="maxNights" type="number" min="1" max="30" value="7"> noches</span></label>
      <button class="flight-submit" type="submit">Buscar hotel + vuelo →</button>
    </div></form>
    <datalist id="comboAirports"></datalist><p class="flight-iata-help">Las fechas se aplican al vuelo y a la estancia. Para hoteles, los niños se consultan inicialmente con una edad orientativa de 8 años; confirma sus edades en el proveedor.</p>
    <div class="combo-output" aria-live="polite"></div>
  </section>`;
  const form=root.querySelector('.combo-form'),output=root.querySelector('.combo-output');
  let airports=[],controller=null,flightOptions=[],hotelOptions=[],flightUrl='';
  const airportsReady=loadAirports(root.querySelector('#comboAirports'),new URL('./data/airports.json',document.baseURI).href).then(value=>{airports=value}).catch(()=>{});
  const updateTotal=()=>{
    const selectedFlight=output.querySelector('[name=comboFlight]:checked'),selectedHotel=output.querySelector('[name=comboHotel]:checked');
    const flight=flightOptions[Number(selectedFlight?.value)],hotel=hotelOptions[Number(selectedHotel?.value)],summary=output.querySelector('.combo-summary');
    if(!flight||!hotel||!summary)return;
    const total=Number(flight.price)+Number(hotel.totalPrice);
    summary.innerHTML=`<div><small>Total estimado</small><strong>${esc(money(total,flight.currency||hotel.currency))}</strong><span>Vuelo ${esc(money(flight.price,flight.currency))} + alojamiento ${esc(money(hotel.totalPrice,hotel.currency))}</span></div><div class="combo-actions"><a href="${esc(flightUrl)}" target="_blank" rel="noopener noreferrer">Confirmar vuelo ↗</a><a href="${esc(hotel.url||'#')}" target="_blank" rel="noopener noreferrer">Confirmar hotel ↗</a></div>`;
  };
  form.elements.departureDate.addEventListener('change',()=>{
    const minimum=addDays(new Date(`${form.elements.departureDate.value}T12:00:00`),1);form.elements.returnDate.min=iso(minimum);
    if(form.elements.returnDate.value<=form.elements.departureDate.value)form.elements.returnDate.value=iso(minimum);
  });
  form.elements.dateMode.addEventListener('change',()=>{const flexible=form.elements.dateMode.value==='flexible';root.querySelector('.combo-duration').hidden=!flexible;form.elements.departureDate.closest('label').hidden=flexible;form.elements.returnDate.closest('label').hidden=flexible});
  form.addEventListener('submit',async event=>{
    event.preventDefault();await airportsReady;
    const data=new FormData(form),origin=resolveAirportCode(data.get('origin'),airports),destination=resolveAirportCode(data.get('destination'),airports);
    const adults=Number(data.get('adults')),children=Number(data.get('children')),departureDate=String(data.get('departureDate')),returnDate=String(data.get('returnDate'));
    if(String(data.get('dateMode'))==='flexible'){
      const startDate=iso(addDays(new Date(),1)),endDate=iso(addDays(new Date(),90)),minNights=Number(data.get('minNights')),maxNights=Number(data.get('maxNights'));
      if(minNights<1||maxNights>30||minNights>maxNights){output.innerHTML='<div class="flight-error">La duración flexible no es válida.</div>';return}
      output.innerHTML='<div class="flight-loading"><i></i><i></i><i></i><span>Buscando los periodos más baratos…</span></div>';
      try{const response=await fetch(flexibleDealsEndpoint(),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query:{origin,destination,startDate,endDate,minNights,maxNights}})}),body=await response.json();if(!response.ok)throw new Error(body.error||'No se encontraron fechas flexibles.');if(!body.results?.length)throw new Error(body.notice);output.innerHTML=`<section class="flex-results"><div class="combo-title"><span>1</span><div><h3>Elige uno de los periodos más baratos</h3><p>${esc(body.notice)}</p></div></div>${body.results.map((item,index)=>`<button type="button" data-flex-index="${index}"><span><strong>${esc(item.departureDate)} → ${esc(item.returnDate)}</strong><small>${nightsBetween(item.departureDate,item.returnDate)} noches</small></span><b>Vuelo desde ${esc(money(item.flightPrice,item.currency))}</b></button>`).join('')}</section>`;output.querySelectorAll('[data-flex-index]').forEach(button=>button.onclick=()=>{const item=body.results[Number(button.dataset.flexIndex)];form.elements.departureDate.value=item.departureDate;form.elements.returnDate.value=item.returnDate;form.elements.dateMode.value='exact';form.elements.dateMode.dispatchEvent(new Event('change'));form.requestSubmit()});}catch(error){output.innerHTML=`<div class="flight-error"><strong>No se pudieron calcular fechas flexibles.</strong><span>${esc(error.message)}</span></div>`}return;
    }
    const flightQuery={tripType:'roundtrip',origin,destination,departureDate,returnDate,adults,children,infants:0,travelClass:String(data.get('travelClass')),stops:String(data.get('stops')),carryOnBags:Number(data.get('carryOnBags')),checkedBags:Number(data.get('checkedBags')),maxPrice:null};
    const validation=validateFlightQuery(flightQuery);if(validation){output.innerHTML=`<div class="flight-error">${esc(validation)}</div>`;return}
    showResolvedAirport(form.elements.origin,origin);
    showResolvedAirport(form.elements.destination,destination);
    const destinationText=destinationName(data.get('destination'),destination,airports),nights=nightsBetween(departureDate,returnDate);
    const hotelQuery={destination:destinationText,checkIn:departureDate,checkOut:returnDate,adults,children,childrenAges:Array(children).fill(8),guests:adults+children,rooms:1,minPrice:null,maxPrice:null,accommodationType:'any',board:'any',currency:'EUR',nights};
    controller?.abort();controller=new AbortController();const activeController=controller,button=form.querySelector('.flight-submit');button.disabled=true;button.textContent='Buscando…';
    output.innerHTML='<div class="flight-loading"><i></i><i></i><i></i><span>Consultando vuelos y alojamientos…</span></div>';
    try{
      const providers=(await providersPromise||[]).filter(provider=>provider.enabled);
      const [flightResult,...hotelResults]=await Promise.allSettled([searchFlights(flightQuery,{signal:activeController.signal}),...providers.map(provider=>searchPublicProvider(provider,hotelQuery))]);
      if(flightResult.status==='rejected')throw flightResult.reason;
      flightOptions=(flightResult.value.results||[]).filter(option=>Number(option.price)>0).slice(0,5);flightUrl=flightResult.value.searchUrl||'';
      hotelOptions=hotelResults.filter(result=>result.status==='fulfilled').flatMap(result=>result.value.results||[]).filter(hotel=>Number(hotel.totalPrice)>0).sort((a,b)=>a.totalPrice-b.totalPrice).slice(0,8);
      const hotelErrors=hotelResults.filter(result=>result.status==='rejected').map(result=>result.reason?.message).filter(Boolean);
      if(!flightOptions.length||!hotelOptions.length)throw new Error(!flightOptions.length?'No se recibieron vuelos con precio para combinar.':'No se recibieron alojamientos con precio para combinar.');
      output.innerHTML=`<div class="combo-results"><section><div class="combo-title"><span>1</span><div><h3>Elige un vuelo</h3><p>Opciones iniciales; la vuelta y el precio final se confirman en Google Flights.</p></div></div><div class="combo-options">${flightOptions.map(flightLabel).join('')}</div></section><section><div class="combo-title"><span>2</span><div><h3>Elige un alojamiento</h3><p>${esc(destinationText)} · ${nights} noches</p></div></div><div class="combo-options">${hotelOptions.map(hotelLabel).join('')}</div></section></div><aside class="combo-summary"></aside>${hotelErrors.length?`<p class="combo-warning">Algunos proveedores no respondieron: ${esc(hotelErrors.join(' · '))}</p>`:''}<p class="flight-legal">${esc(FLIGHT_PRICE_NOTICE)} El total es una suma orientativa; Vuelotel no vende un paquete combinado ni garantiza disponibilidad simultánea. Las maletas facturadas se guardan como preferencia y deben confirmarse con la tarifa final.</p>`;
      output.querySelectorAll('[name=comboFlight],[name=comboHotel]').forEach(input=>input.addEventListener('change',updateTotal));updateTotal();
      const initialTotal=Number(flightOptions[0]?.price)+Number(hotelOptions[0]?.totalPrice);
      window.dispatchEvent(new CustomEvent('vuelotel:search-complete',{detail:{type:'combined',label:`${origin} → ${destinationText} · hotel + vuelo`,query:{flight:flightQuery,hotel:hotelQuery,checkedBags:Number(data.get('checkedBags'))},price:initialTotal,currency:flightOptions[0]?.currency||'EUR'}}));
    }catch(error){if(error.name!=='AbortError')output.innerHTML=`<div class="flight-error"><strong>No se pudo completar la búsqueda combinada.</strong><span>${esc(error.message||'Inténtalo de nuevo más tarde.')}</span></div>`}
    finally{if(controller===activeController){controller=null;button.disabled=false;button.textContent='Buscar hotel + vuelo →'}}
  });
  return {destroy(){controller?.abort();root.replaceChildren()},form};
}
