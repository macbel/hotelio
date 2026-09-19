import {searchPublicProvider} from './providers.js?v=2.0.1';
import {FLIGHT_PRICE_NOTICE,resolveAirportCode,searchAirports,searchFlights,showResolvedAirport,validateFlightQuery} from './flights.js?v=2.0.2';

const esc=value=>String(value??'').replace(/[&<>'"]/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[character]));
const iso=date=>date.toISOString().slice(0,10);
const addDays=(date,days)=>{const copy=new Date(date);copy.setDate(copy.getDate()+days);return copy};
const money=(value,currency='EUR')=>new Intl.NumberFormat('es-ES',{style:'currency',currency,maximumFractionDigits:0}).format(Number(value)||0);
const nightsBetween=(from,to)=>Math.max(1,Math.round((new Date(to)-new Date(from))/86400000));
const whatsappUrl=text=>`https://wa.me/?text=${encodeURIComponent(text)}`;

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
      <button class="flight-submit" type="submit">Buscar hotel + vuelo →</button>
    </div></form>
    <datalist id="comboAirports"></datalist><p class="flight-iata-help">Las fechas se aplican al vuelo y a la estancia. Para hoteles, los niños se consultan inicialmente con una edad orientativa de 8 años; confirma sus edades en el proveedor.</p>
    <div class="combo-output" aria-live="polite"></div>
  </section>`;
  const form=root.querySelector('.combo-form'),output=root.querySelector('.combo-output');
  let airports=[],controller=null,flightOptions=[],hotelOptions=[],flightUrl='',combinedContext=null;
  const airportList=root.querySelector('#comboAirports'),airportInputs=[form.elements.origin,form.elements.destination];
  const updateSuggestions=input=>{airportList.innerHTML=searchAirports(input.value,airports).map(airport=>`<option value="${esc(`${[airport.city,airport.name,airport.country].filter(Boolean).join(' · ')} (${airport.iata})`)}"></option>`).join('')};
  airportInputs.forEach(input=>input.addEventListener('input',()=>updateSuggestions(input)));
  const airportsReady=loadAirports(airportList,new URL('./data/airports.json',document.baseURI).href).then(value=>{airports=value;airportInputs.forEach(updateSuggestions)}).catch(()=>{});
  const updateTotal=()=>{
    const selectedFlight=output.querySelector('[name=comboFlight]:checked'),selectedHotel=output.querySelector('[name=comboHotel]:checked');
    const flight=flightOptions[Number(selectedFlight?.value)],hotel=hotelOptions[Number(selectedHotel?.value)],summary=output.querySelector('.combo-summary');
    if(!flight||!hotel||!summary)return;
    const total=Number(flight.price)+Number(hotel.totalPrice);
    const message=['✈️🏨 Vuelotel · Hotel + vuelo',`${form.elements.origin.value} → ${form.elements.destination.value}`,`${form.elements.departureDate.value} → ${form.elements.returnDate.value}`,`Vuelo: ${money(flight.price,flight.currency)}`,`Hotel: ${hotel.name} · ${money(hotel.totalPrice,hotel.currency)}`,`Total estimado: ${money(total,flight.currency||hotel.currency)}`,flightUrl,hotel.url||''].filter(Boolean).join('\n');
    summary.innerHTML=`<div><small>Total estimado</small><strong>${esc(money(total,flight.currency||hotel.currency))}</strong><span>Vuelo ${esc(money(flight.price,flight.currency))} + alojamiento ${esc(money(hotel.totalPrice,hotel.currency))}</span></div><div class="combo-actions"><a href="${esc(flightUrl)}" target="_blank" rel="noopener noreferrer">Confirmar vuelo ↗</a><a href="${esc(hotel.url||'#')}" target="_blank" rel="noopener noreferrer">Confirmar hotel ↗</a><a class="share-whatsapp" href="${esc(whatsappUrl(message))}" target="_blank" rel="noopener noreferrer">Compartir por WhatsApp</a></div>`;
    if(!combinedContext)return;
    const airline=Array.isArray(flight.airlines)?flight.airlines.filter(Boolean).join(', '):'';
    const savedFlight={airlines:airline,departure:flight.departure||{},arrival:flight.arrival||{},price:Number(flight.price)||0,currency:flight.currency||'EUR',stops:Number(flight.stops)||0,durationMinutes:Number(flight.durationMinutes)||0,searchUrl:flightUrl};
    const savedHotel={name:hotel.name||'Alojamiento',location:hotel.location||combinedContext.hotel.destination,totalPrice:Number(hotel.totalPrice)||0,nightlyPrice:Number(hotel.nightlyPrice)||0,currency:hotel.currency||'EUR',rating:hotel.rating??null,provider:hotel.provider||'',url:hotel.url||''};
    const label=`${combinedContext.flight.origin} → ${combinedContext.hotel.destination} · ${savedHotel.name}`;
    window.dispatchEvent(new CustomEvent('vuelotel:search-complete',{detail:{type:'combined',label,query:{...combinedContext,selection:{flight:savedFlight,hotel:savedHotel,total,currency:flight.currency||hotel.currency||'EUR'}},price:total,currency:flight.currency||hotel.currency||'EUR'}}));
  };
  form.elements.departureDate.addEventListener('change',()=>{
    const minimum=addDays(new Date(`${form.elements.departureDate.value}T12:00:00`),1);form.elements.returnDate.min=iso(minimum);
    if(form.elements.returnDate.value<=form.elements.departureDate.value)form.elements.returnDate.value=iso(minimum);
  });
  form.addEventListener('submit',async event=>{
    event.preventDefault();await airportsReady;
    const data=new FormData(form),origin=resolveAirportCode(data.get('origin'),airports),destination=resolveAirportCode(data.get('destination'),airports);
    const adults=Number(data.get('adults')),children=Number(data.get('children')),departureDate=String(data.get('departureDate')),returnDate=String(data.get('returnDate'));
    const flightQuery={tripType:'roundtrip',origin,destination,departureDate,returnDate,adults,children,infants:0,travelClass:String(data.get('travelClass')),stops:String(data.get('stops')),carryOnBags:Number(data.get('carryOnBags')),checkedBags:Number(data.get('checkedBags')),maxPrice:null};
    const validation=validateFlightQuery(flightQuery);if(validation){output.innerHTML=`<div class="flight-error">${esc(validation)}</div>`;return}
    showResolvedAirport(form.elements.origin,origin);
    showResolvedAirport(form.elements.destination,destination);
    const destinationText=destinationName(data.get('destination'),destination,airports),nights=nightsBetween(departureDate,returnDate);
    const hotelQuery={destination:destinationText,checkIn:departureDate,checkOut:returnDate,adults,children,childrenAges:Array(children).fill(8),guests:adults+children,rooms:1,minPrice:null,maxPrice:null,accommodationType:'any',board:'any',currency:'EUR',nights};
    combinedContext={flight:flightQuery,hotel:hotelQuery,checkedBags:Number(data.get('checkedBags'))};
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
    }catch(error){if(error.name!=='AbortError')output.innerHTML=`<div class="flight-error"><strong>No se pudo completar la búsqueda combinada.</strong><span>${esc(error.message||'Inténtalo de nuevo más tarde.')}</span></div>`}
    finally{if(controller===activeController){controller=null;button.disabled=false;button.textContent='Buscar hotel + vuelo →'}}
  });
  return {destroy(){controller?.abort();root.replaceChildren()},form};
}
