import {searchHttpProvider, searchPublicProvider} from './providers.js';

const storeKey = 'hotelio-providers-v1';
let providers = (JSON.parse(localStorage.getItem(storeKey) || 'null') || []).filter(provider => provider.type !== 'demo');
const apiKeyStore='hotelio-public-api-keys-v1';
let publicApiSettings=JSON.parse(localStorage.getItem(apiKeyStore)||'{}');
const stay22Aid='hotelio';
const publicSearchProviders=[
  {id:'stay22',name:'Stay22 · Booking, Expedia, Hotels.com y Vrbo',signup:'https://hub.stay22.com/',docs:'https://community.stay22.com/search-bar-monetization-tab-under-with-allez',free:'Partner ID activo: hotelio · reservas atribuidas a tu cuenta',defaultEnabled:true},
  {id:'serpapi',name:'SerpApi · Google Hotels',signup:'https://serpapi.com/users/sign_up',docs:'https://serpapi.com/google-hotels-api',free:'100 búsquedas gratis/mes'}
];
const publicSetting=provider=>provider.id==='stay22'
  ? {token:'',aid:stay22Aid,enabled:publicApiSettings.stay22?.enabled??true}
  : {token:'',enabled:Boolean(provider.defaultEnabled),...(publicApiSettings[provider.id]||{})};
if(publicApiSettings.stay22?.token){
  publicApiSettings.stay22={aid:stay22Aid,enabled:publicApiSettings.stay22.enabled??true};
  localStorage.setItem(apiKeyStore,JSON.stringify(publicApiSettings));
}
let results = [];
let errors = [];
const savedStoreKey='hotelio-saved-hotels-v1';
let savedHotels=JSON.parse(localStorage.getItem(savedStoreKey)||'[]');
if(!Array.isArray(savedHotels))savedHotels=[];
const selectedSaved=new Set();
let currentQuery=null;
const providerCatalog = [
  {name:'Amadeus Hotel Search', kind:'API self-service', hint:'Búsqueda, disponibilidad y ofertas de hoteles. Requiere API key.', docs:'https://developers.amadeus.com/self-service/apis-docs/guides/developer-guides/resources/hotels/'},
  {name:'Booking.com Demand API', kind:'API de afiliado', hint:'Inventario y precios en tiempo real. Requiere partner, token y Affiliate ID.', docs:'https://developers.booking.com/demand/docs/open-api/3.2/demand-api'},
  {name:'Expedia Group Rapid', kind:'API para partners', hint:'Alojamientos de Expedia y Hotels.com. Requiere aprobación y credenciales.', docs:'https://developers.expediagroup.com/rapid/api/explorer?locale=en_US'},
  {name:'Hotelbeds / HBX', kind:'API B2B', hint:'Disponibilidad y reservas mayoristas. Requiere cuenta profesional.', docs:'https://developer.hotelbeds.com/documentation/hotels/booking-api/'},
  {name:'Travelgate Hotel-X', kind:'API agregadora', hint:'Una integración para consultar varios vendedores; ofrece datos de prueba.', docs:'https://docs.travelgate.com/docs/apis/for-buyers/hotel-x-pull-buyers-api/quickstart/'},
  {name:'Sabre Hospitality', kind:'API B2B', hint:'Disponibilidad y precios hoteleros. Requiere acceso comercial.', docs:'https://developer.sabre.com/product-catalog'},
  {name:'Hostelworld Affiliates', kind:'Afiliación / API', hint:'Más de 36.000 propiedades; requiere alta como afiliado.', docs:'https://partners.hostelworld.com/solutions/'},
  {name:'Proveedor personalizado', kind:'Conector HTTP', hint:'Tu propia API o adaptador para cualquier fuente autorizada.', docs:''}
];

const today = new Date();
const iso = date => date.toISOString().slice(0, 10);
const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
const nextWeek = new Date(today); nextWeek.setDate(today.getDate() + 5);

document.querySelector('#app').innerHTML = `
  <main class="shell">
    <nav class="topbar"><div class="brand"><span class="brand-mark">H</span> Hotelio</div><div class="nav-actions"><button class="ghost saved-nav" id="savedBtn">♡ Guardados <span id="savedCount">0</span></button><button class="ghost" id="providersBtn">⚙ Proveedores</button></div></nav>
    <section class="hero"><div><div class="eyebrow">Tu viaje, al precio justo</div><h1>Duerme bien.<br>Ahorra más.</h1><p>Compara en un solo lugar los alojamientos de tus proveedores favoritos y encuentra la opción que encaja contigo.</p></div><div class="hero-art" aria-hidden="true"><div class="sun"></div><div class="hotel"><div class="windows"><i></i><i></i><i></i><i></i></div></div></div></section>
    <form class="search-card" id="searchForm">
      <div class="fields">
        <div class="field"><label for="destination">Destino</label><input id="destination" required placeholder="¿Adónde quieres ir?" value="Valencia"></div>
        <div class="field"><label for="checkIn">Entrada</label><input id="checkIn" type="date" required min="${iso(today)}" value="${iso(tomorrow)}"></div>
        <div class="field"><label for="checkOut">Salida</label><input id="checkOut" type="date" required min="${iso(tomorrow)}" value="${iso(nextWeek)}"></div>
        <div class="field"><label for="adults">Adultos</label><select id="adults"><option value="1">1 adulto</option><option value="2" selected>2 adultos</option><option value="3">3 adultos</option><option value="4">4 adultos</option><option value="5">5 adultos</option><option value="6">6 adultos</option></select></div>
        <div class="field"><label for="children">Niños</label><select id="children"><option value="0" selected>Sin niños</option><option value="1">1 niño</option><option value="2">2 niños</option><option value="3">3 niños</option><option value="4">4 niños</option></select></div>
        <div class="field"><label>Precio/noche</label><div class="range-row"><input id="minPrice" type="number" min="0" value="20" aria-label="Precio mínimo"><span>—</span><input id="maxPrice" type="number" min="1" value="180" aria-label="Precio máximo"></div></div>
        <div class="child-ages" id="childAges" hidden></div>
        <button class="search-btn" type="submit">Buscar el mejor precio →</button>
      </div>
    </form>
    <section id="results"><div class="empty">Introduce tus preferencias y empieza a comparar.</div></section>
  </main><div id="modal"></div>`;

const money = (value, currency='EUR') => new Intl.NumberFormat('es-ES',{style:'currency',currency,maximumFractionDigits:0}).format(value);
const nightsBetween = (a,b) => Math.max(1, Math.round((new Date(b)-new Date(a))/86400000));
const esc = text => String(text ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const newId=()=>crypto.randomUUID?.()||`hotel-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const normalized=text=>String(text||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase().replace(/[^a-z0-9]+/g,'-');

function readQueryFromForm(){
  const checkIn=document.querySelector('#checkIn').value,checkOut=document.querySelector('#checkOut').value;
  const adults=Number(document.querySelector('#adults').value),childrenAges=[...document.querySelectorAll('.child-age')].map(el=>Number(el.value));
  return {destination:document.querySelector('#destination').value.trim(),checkIn,checkOut,adults,children:childrenAges.length,childrenAges,guests:adults+childrenAges.length,rooms:1,minPrice:Number(document.querySelector('#minPrice').value),maxPrice:Number(document.querySelector('#maxPrice').value),currency:'EUR',nights:nightsBetween(checkIn,checkOut)};
}

function searchFingerprint(search={}){
  return [search.checkIn,search.checkOut,search.adults,(search.childrenAges||[]).join('-')].join('|');
}

function hotelIdentity(hotel,search){
  return `${normalized(hotel.name)}|${normalized(hotel.location||search.destination)}|${searchFingerprint(search)}`;
}

function cheapestOffer(hotel){
  return [...(hotel.offers||[])].sort((a,b)=>Number(a.totalPrice)-Number(b.totalPrice))[0]||{};
}

function persistSaved(){
  localStorage.setItem(savedStoreKey,JSON.stringify(savedHotels));
  updateSavedButton();
}

function updateSavedButton(){
  const count=document.querySelector('#savedCount');
  if(count)count.textContent=String(savedHotels.length);
}

function findSavedHotel(hotel,query){
  const identity=hotelIdentity(hotel,query);
  return savedHotels.find(saved=>saved.identity===identity);
}

function saveHotelOffer(hotel,query,{manual=false}={}){
  const identity=hotelIdentity(hotel,query);
  let saved=savedHotels.find(item=>item.identity===identity);
  if(!saved){
    saved={id:newId(),identity,name:hotel.name,location:hotel.location||query.destination,rating:hotel.rating||'',features:[...(hotel.features||[])],search:{destination:query.destination,checkIn:query.checkIn,checkOut:query.checkOut,adults:query.adults,childrenAges:[...(query.childrenAges||[])],nights:query.nights},offers:[]};
    savedHotels.unshift(saved);
  }
  const offer={provider:hotel.provider||'Oferta manual',url:hotel.url||'',nightlyPrice:Number(hotel.nightlyPrice)||0,totalPrice:Number(hotel.totalPrice)||0,currency:hotel.currency||'EUR',manual,savedAt:new Date().toISOString()};
  const existing=saved.offers.findIndex(item=>(item.url&&item.url===offer.url)||(!item.url&&item.provider===offer.provider));
  if(existing>=0)saved.offers[existing]=offer;else saved.offers.push(offer);
  if(!saved.rating&&hotel.rating)saved.rating=hotel.rating;
  saved.features=[...new Set([...(saved.features||[]),...(hotel.features||[])])];
  persistSaved();
  return saved;
}

function directSearches(query) {
  const destination=encodeURIComponent(query.destination), childAges=query.childrenAges;
  const expediaChildren=encodeURIComponent(childAges.map((age,i)=>`${age}_${i+1}`).join(','));
  const kayakOccupancy=`${query.adults}adults${childAges.length?`/${query.children}children-${childAges.join('-')}`:''}`;
  const destinationKey=query.destination.normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
  const portalDestinations={
    salou:{trivago:'https://www.trivago.es/es/odr/hoteles-salou-espa%C3%B1a?search=200-53957',hostelworld:{q:'Salou, Catalonia, Spain',country:'Catalonia, Spain',city:'Salou',id:'800'}},
    valencia:{trivago:'https://www.trivago.es/es/odr/hoteles-valencia-espa%C3%B1a?search=200-53826'}
  };
  const portalDestination=portalDestinations[destinationKey], hostelworld=portalDestination?.hostelworld;
  return [
    {name:'Booking.com', public:true, note:`Fechas, ocupantes y ${query.minPrice}–${query.maxPrice} €/noche`, url:`https://www.booking.com/searchresults.es.html?ss=${destination}&checkin=${query.checkIn}&checkout=${query.checkOut}&group_adults=${query.adults}&no_rooms=${query.rooms}&group_children=${query.children}${childAges.map(age=>`&age=${age}`).join('')}&nflt=${encodeURIComponent(`price=EUR-${query.minPrice}-${query.maxPrice}-1`)}`},
    {name:'Expedia', public:true, note:`Fechas, ocupantes y ${query.minPrice}–${query.maxPrice} €/noche`, url:`https://www.expedia.es/Hotel-Search?destination=${destination}&startDate=${query.checkIn}&endDate=${query.checkOut}&rooms=1&adults=${query.adults}${childAges.length?`&children=${expediaChildren}`:''}&price=${query.minPrice}&price=${query.maxPrice}`},
    {name:'Hotels.com', public:true, note:`Fechas, ocupantes y ${query.minPrice}–${query.maxPrice} €/noche`, url:`https://www.hotels.com/Hotel-Search?destination=${destination}&startDate=${query.checkIn}&endDate=${query.checkOut}&rooms=1&adults=${query.adults}${childAges.length?`&children=${expediaChildren}`:''}&price=${query.minPrice}&price=${query.maxPrice}`},
    {name:'Google Hotels', note:'Destino incluido · fechas, ocupantes y precio se eligen allí', manual:true, url:`https://www.google.com/travel/hotels?q=${encodeURIComponent('hoteles en '+query.destination)}`},
    {name:'Kayak', public:true, note:'Destino, fechas, adultos y edades de los niños incluidos · precio se ajusta allí', url:`https://www.kayak.es/hotels/${destination}/${query.checkIn}/${query.checkOut}/${kayakOccupancy}`},
    {name:'Momondo', public:true, note:'Destino, fechas, adultos y edades de los niños incluidos · precio se ajusta allí', url:`https://www.momondo.es/hotels/${destination}/${query.checkIn}/${query.checkOut}/${kayakOccupancy}`},
    {name:'HotelsCombined', public:true, note:'Destino, fechas, adultos y edades de los niños incluidos · precio se ajusta allí', url:`https://www.hotelscombined.es/hotels/${destination}/${query.checkIn}/${query.checkOut}/${kayakOccupancy}`},
    {name:'Trivago', note:portalDestination?.trivago?'Destino incluido · fechas, huéspedes y precio se eligen allí':'Requiere seleccionar destino, fechas y precio en Trivago', manual:true, url:portalDestination?.trivago||'https://www.trivago.es/es-US'},
    {name:'Hostelworld', note:hostelworld?'Destino, fechas y huéspedes incluidos · precio se elige allí':'Requiere seleccionar destino, fechas y precio en Hostelworld', manual:true, url:hostelworld?`https://www.hostelworld.com/pwa/s?q=${encodeURIComponent(hostelworld.q)}&country=${encodeURIComponent(hostelworld.country)}&city=${encodeURIComponent(hostelworld.city)}&type=city&id=${hostelworld.id}&from=${query.checkIn}&to=${query.checkOut}&guests=${query.guests}&page=1`:'https://www.hostelworld.com/'},
    {name:'eDreams', note:'Selecciona destino, fechas, ocupantes y precio en eDreams', manual:true, url:'https://www.edreams.es/hoteles/'},
    {name:'lastminute.com', note:'Selecciona los filtros dentro de Lastminute', manual:true, url:'https://www.es.lastminute.com/hoteles/'},
    {name:'Rumbo', note:'Selecciona los filtros dentro de Rumbo', manual:true, url:'https://www.rumbo.es/hoteles'},
    {name:'Agoda', note:'Selecciona destino, fechas, ocupantes y precio en Agoda', manual:true, url:'https://www.agoda.com/'},
    {name:'Trip.com', note:'Selecciona los filtros dentro de Trip.com', manual:true, url:'https://es.trip.com/hotels/'},
    {name:'Skyscanner', note:'Selecciona los filtros dentro de Skyscanner', manual:true, url:'https://www.skyscanner.es/hoteles'}
  ];
}

function renderDirectSearches(query) {
  const people=`${query.adults} ${query.adults===1?'adulto':'adultos'}${query.children?` · ${query.children} ${query.children===1?'niño':'niños'} (${query.childrenAges.join(', ')} años)`:''}`;
  return `<section class="direct-search"><div class="results-head"><div><span class="eyebrow">Búsqueda real sin cuenta</span><h2>Consultar en otras webs</h2><p>${esc(query.destination)} · ${query.nights} noches · ${esc(people)}</p></div></div><div class="portal-grid">${directSearches(query).map(p=>`<a class="portal ${p.manual?'portal-manual':''}" href="${esc(p.url)}" target="_blank" rel="noopener"><span class="portal-logo">${esc(p.name.slice(0,1))}</span><span><strong>${esc(p.name)} ${p.manual?'<i>Manual</i>':p.public?'<i class="public-link">Público</i>':''}</strong><small>${esc(p.note)}</small></span><b>↗</b></a>`).join('')}</div><p class="direct-note">Los enlaces públicos reciben automáticamente los filtros que admite cada web. El rango de precios debe ajustarse allí cuando el portal no lo conserva en su URL.</p></section>`;
}

function renderChildAges() {
  const count=Number(document.querySelector('#children').value), root=document.querySelector('#childAges');
  root.hidden=count===0;
  root.innerHTML=count ? `<span>Edades al viajar</span>${Array.from({length:count},(_,i)=>`<label>Niño ${i+1}<select class="child-age" aria-label="Edad del niño ${i+1}">${Array.from({length:18},(_,age)=>`<option value="${age}" ${age===8?'selected':''}>${age} ${age===1?'año':'años'}</option>`).join('')}</select></label>`).join('')}` : '';
}
document.querySelector('#children').addEventListener('change',renderChildAges);

function renderResults(query) {
  const root = document.querySelector('#results');
  const stay22Notice=results.some(result=>String(result.provider).startsWith('Stay22'))?`<p class="provider-notice"><strong>Stay22:</strong> ${query.children?'ha transmitido el número de niños, pero no sus edades. Confírmalas al abrir la oferta. ':''}Sus resultados se consultan en tiempo real y no se guardan automáticamente.</p>`:'';
  const connected=results.length ? `<div class="results-head"><div><h2>${results.length} alojamientos encontrados</h2><p>Ordenados por precio total · ${query.nights} noches</p></div></div>${stay22Notice}<div class="result-list">${results.map((r,i)=>`
    <article class="result" style="animation-delay:${i*45}ms"><div class="result-img">${['⌂','◇','◒','△'][i%4]}</div><div><div class="result-title"><h3>${esc(r.name)}</h3><button class="save-hotel ${r.persistable===false?'is-restricted':findSavedHotel(r,query)?'is-saved':''}" type="button" ${r.persistable===false?'disabled title="Stay22 solo permite consultar los resultados en tiempo real"':`data-save-result="${i}"`} aria-label="${r.persistable===false?'Resultado de consulta no guardable':`Guardar ${esc(r.name)}`}">${r.persistable===false?'Solo consulta':findSavedHotel(r,query)?'♥ Guardado':'♡ Guardar'}</button></div><div class="meta">★ ${esc(r.rating || '—')} · ${esc(r.location || query.destination)} · ${esc(r.provider)}</div><div class="chips">${(r.features||[]).slice(0,3).map(f=>`<span class="chip">${esc(f)}</span>`).join('')}</div></div><div class="price"><strong>${money(r.totalPrice,r.currency)}</strong><small>${money(r.nightlyPrice,r.currency)} / noche</small><a href="${esc(r.url || '#')}" target="_blank" rel="noopener">Ver oferta →</a></div></article>`).join('')}</div>`
    : (errors.length ? `<div class="provider-errors">${esc(errors.join(' · '))}</div>` : '');
  root.innerHTML=renderDirectSearches(query)+connected;
}

document.querySelector('#searchForm').addEventListener('submit', async e => {
  e.preventDefault(); const btn=e.currentTarget.querySelector('button');
  const checkIn=document.querySelector('#checkIn').value, checkOut=document.querySelector('#checkOut').value;
  if (new Date(checkOut)<=new Date(checkIn)) { alert('La fecha de salida debe ser posterior a la entrada.'); return; }
  const query=readQueryFromForm(); currentQuery=query;
  btn.disabled=true; btn.textContent='Comparando…'; document.querySelector('#results').innerHTML='<div class="loading"><i></i><i></i><i></i></div>';
  errors=[]; const jobs=providers.filter(p=>p.enabled).map(provider=>({name:provider.name,run:()=>searchHttpProvider(provider,query)}));
  publicSearchProviders.forEach(provider=>{const setting=publicSetting(provider);if(setting.enabled&&(provider.id==='stay22'||setting.token))jobs.push({name:provider.name,run:()=>searchPublicProvider(provider,setting,query)})});
  const settled=await Promise.allSettled(jobs.map(job=>job.run()));
  results=settled.flatMap((r,i)=>{if(r.status==='rejected'){errors.push(r.reason?.message||jobs[i]?.name);return []}return r.value}).filter(r=>Number(r.nightlyPrice)>=query.minPrice&&Number(r.nightlyPrice)<=query.maxPrice).sort((a,b)=>a.totalPrice-b.totalPrice);
  renderResults(query); btn.disabled=false; btn.textContent='Buscar el mejor precio →';
});

document.querySelector('#results').addEventListener('click',event=>{
  const button=event.target.closest('[data-save-result]');
  if(!button||!currentQuery)return;
  const hotel=results[Number(button.dataset.saveResult)];
  if(!hotel)return;
  saveHotelOffer(hotel,currentQuery);
  button.classList.add('is-saved');button.textContent='♥ Guardado';
});

function searchSummary(search){
  const children=(search.childrenAges||[]).length?` · niños ${search.childrenAges.join(', ')} años`:'';
  return `${search.destination} · ${search.checkIn} → ${search.checkOut} · ${search.adults} adultos${children}`;
}

function renderComparison(){
  const hotels=savedHotels.filter(hotel=>selectedSaved.has(hotel.id));
  if(hotels.length<2)return '';
  const offers=hotels.map(cheapestOffer),lowest=Math.min(...offers.map(offer=>Number(offer.totalPrice)||Infinity));
  const differentSearches=new Set(hotels.map(hotel=>searchFingerprint(hotel.search))).size>1;
  const cells=content=>hotels.map(content).join('');
  return `<section class="comparison"><div class="comparison-head"><div><span class="eyebrow">Comparación</span><h3>${hotels.length} hoteles frente a frente</h3></div></div>${differentSearches?'<p class="compare-warning">Atención: hay hoteles guardados para fechas u ocupantes diferentes.</p>':''}<div class="compare-scroll"><table><tbody>
    <tr><th>Hotel</th>${cells(hotel=>`<td><strong>${esc(hotel.name)}</strong><small>${esc(hotel.location)}</small></td>`)}</tr>
    <tr><th>Viaje</th>${cells(hotel=>`<td>${esc(hotel.search.checkIn)} → ${esc(hotel.search.checkOut)}<small>${hotel.search.nights} noches</small></td>`)}</tr>
    <tr><th>Precio total</th>${cells((hotel,index)=>`<td class="compare-price ${Number(offers[index].totalPrice)===lowest?'best-value':''}">${money(offers[index].totalPrice,offers[index].currency)}${Number(offers[index].totalPrice)===lowest?'<em>Más barato</em>':''}</td>`)}</tr>
    <tr><th>Por noche</th>${cells((hotel,index)=>`<td>${money(offers[index].nightlyPrice,offers[index].currency)}</td>`)}</tr>
    <tr><th>Valoración</th>${cells(hotel=>`<td>${hotel.rating?`★ ${esc(hotel.rating)}`:'Sin valoración'}</td>`)}</tr>
    <tr><th>Mejor proveedor</th>${cells((hotel,index)=>`<td>${esc(offers[index].provider)}<small>${hotel.offers.length} ${hotel.offers.length===1?'oferta guardada':'ofertas guardadas'}</small></td>`)}</tr>
    <tr><th>Servicios</th>${cells(hotel=>`<td>${(hotel.features||[]).length?hotel.features.slice(0,4).map(esc).join(' · '):'Sin datos'}</td>`)}</tr>
    <tr><th></th>${cells((hotel,index)=>`<td>${offers[index].url?`<a class="primary compare-link" href="${esc(offers[index].url)}" target="_blank" rel="noopener">Ver oferta</a>`:'Sin enlace'}</td>`)}</tr>
  </tbody></table></div></section>`;
}

function openSaved(showComparison=false){
  const root=document.querySelector('#modal');
  const activeQuery=currentQuery||readQueryFromForm();
  [...selectedSaved].forEach(id=>{if(!savedHotels.some(hotel=>hotel.id===id))selectedSaved.delete(id)});
  const list=savedHotels.length?savedHotels.map(hotel=>{const offer=cheapestOffer(hotel);return `<article class="saved-card"><label class="compare-check"><input type="checkbox" data-compare="${esc(hotel.id)}" ${selectedSaved.has(hotel.id)?'checked':''}><span>Comparar</span></label><div class="saved-main"><div><h3>${esc(hotel.name)}</h3><p>${esc(searchSummary(hotel.search))}</p></div><div class="saved-price"><strong>${money(offer.totalPrice,offer.currency)}</strong><small>${money(offer.nightlyPrice,offer.currency)} / noche · ${esc(offer.provider)}</small></div></div><div class="saved-bottom"><span>${hotel.offers.length} ${hotel.offers.length===1?'oferta':'ofertas'}${hotel.rating?` · ★ ${esc(hotel.rating)}`:''}</span><button class="danger" type="button" data-remove-saved="${esc(hotel.id)}">Eliminar</button></div></article>`}).join(''):'<div class="saved-empty"><span>♡</span><h3>Aún no has guardado hoteles</h3><p>Busca un alojamiento y pulsa “Guardar”, o añade una oferta externa.</p></div>';
  root.innerHTML=`<div class="modal-backdrop"><section class="modal saved-modal"><div class="modal-title"><div><span class="eyebrow">Tu selección</span><h2>Hoteles guardados</h2></div><button class="ghost" id="closeModal">Cerrar</button></div><p class="note">Se guardan en este dispositivo junto con las fechas, los ocupantes y el precio visto.</p><div class="saved-list">${list}</div><div class="saved-toolbar"><span id="compareStatus">${selectedSaved.size} de 4 seleccionados</span><button class="primary" id="compareBtn" type="button" ${selectedSaved.size<2?'disabled':''}>Comparar seleccionados</button></div>${showComparison?renderComparison():''}<details class="manual-add"><summary>＋ Añadir una oferta de otra web</summary><p class="note">Para un hotel encontrado en Booking, Momondo, KAYAK u otra página.</p><div class="trip-context">Se asociará a: <strong>${esc(searchSummary(activeQuery))}</strong></div><form id="manualHotelForm" class="manual-grid"><label>Hotel<input name="name" required placeholder="Nombre del hotel"></label><label>Proveedor<input name="provider" required placeholder="Booking, Momondo…"></label><label>Precio total (€)<input name="totalPrice" type="number" min="1" step="0.01" required placeholder="450"></label><label>Valoración opcional<input name="rating" type="number" min="0" max="10" step="0.1" placeholder="8,7"></label><label class="manual-wide">Enlace de la oferta<input name="url" type="url" required placeholder="https://..."></label><label class="manual-wide">Servicios opcionales<input name="features" placeholder="Desayuno, piscina, cancelación gratis"></label><button class="primary manual-wide" type="submit">Guardar oferta</button></form></details></section></div>`;
  root.querySelector('#closeModal').onclick=()=>root.innerHTML='';
  root.querySelector('.modal-backdrop').onclick=event=>{if(event.target===event.currentTarget)root.innerHTML=''};
  const compareButton=root.querySelector('#compareBtn'),compareStatus=root.querySelector('#compareStatus');
  const refreshCompare=()=>{compareStatus.textContent=`${selectedSaved.size} de 4 seleccionados`;compareButton.disabled=selectedSaved.size<2};
  root.querySelectorAll('[data-compare]').forEach(input=>input.onchange=()=>{
    if(input.checked&&selectedSaved.size>=4){input.checked=false;alert('Puedes comparar un máximo de 4 hoteles.');return}
    if(input.checked)selectedSaved.add(input.dataset.compare);else selectedSaved.delete(input.dataset.compare);
    refreshCompare();
  });
  root.querySelectorAll('[data-remove-saved]').forEach(button=>button.onclick=()=>{
    savedHotels=savedHotels.filter(hotel=>hotel.id!==button.dataset.removeSaved);selectedSaved.delete(button.dataset.removeSaved);persistSaved();openSaved(false);
  });
  compareButton.onclick=()=>openSaved(true);
  root.querySelector('#manualHotelForm').onsubmit=event=>{
    event.preventDefault();const data=new FormData(event.currentTarget),totalPrice=Number(data.get('totalPrice'));
    saveHotelOffer({name:data.get('name').trim(),location:activeQuery.destination,provider:data.get('provider').trim(),url:data.get('url').trim(),rating:data.get('rating'),features:String(data.get('features')||'').split(',').map(item=>item.trim()).filter(Boolean),totalPrice,nightlyPrice:totalPrice/activeQuery.nights,currency:'EUR'},activeQuery,{manual:true});
    openSaved(false);
  };
}

function saveProviders(){localStorage.setItem(storeKey,JSON.stringify(providers))}
function openProviders(){
  const root=document.querySelector('#modal'); root.innerHTML=`<div class="modal-backdrop"><section class="modal"><div style="display:flex;justify-content:space-between"><h2>Proveedores</h2><button class="ghost" id="closeModal">Cerrar</button></div><p class="note">Stay22 está monetizado con tu Partner ID <strong>hotelio</strong>. No necesita API token; SerpApi continúa disponible como proveedor adicional.</p><div class="public-apis">${publicSearchProviders.map(p=>{const setting=publicSetting(p);const credential=p.id==='stay22'?`<label>Partner ID (AID)<input type="text" data-api-aid="stay22" value="${esc(stay22Aid)}" readonly></label>`:`<label>API key<input type="password" data-api-token="${p.id}" value="${esc(setting.token||'')}" placeholder="Pega aquí tu clave"></label>`;return `<div class="api-card"><div><strong>✓ ${esc(p.name)}</strong><small>${esc(p.free)}</small></div><div class="api-links"><a href="${esc(p.signup)}" target="_blank" rel="noopener">${p.id==='stay22'?'Abrir panel':'Obtener clave'}</a><a href="${esc(p.docs)}" target="_blank" rel="noopener">Documentación</a></div>${credential}<label class="api-enable"><input type="checkbox" data-api-enable="${p.id}" ${setting.enabled?'checked':''}> Activar en las búsquedas</label></div>`}).join('')}<div class="api-card api-limited"><div><strong>Xotelo · API gratuita</strong><small>Sin token, pero solo consulta precios de un hotel ya identificado; no busca destinos gratis.</small></div><div class="api-links"><a href="https://xotelo.com/" target="_blank" rel="noopener">Ver API</a></div></div></div><button class="primary save-apis" type="button">Guardar configuración</button><details class="advanced"><summary>Conectores avanzados</summary><p class="note">Para APIs propias o proveedores con contrato.</p><div id="providerList">${providers.map(p=>`<div class="provider"><div><strong>${esc(p.name)}</strong><p>${esc(p.endpoint)}</p></div><div><input type="checkbox" data-toggle="${esc(p.id)}" ${p.enabled?'checked':''} aria-label="Activar ${esc(p.name)}"> <button data-remove="${esc(p.id)}">Eliminar</button></div></div>`).join('')}</div><div class="catalog"><strong>Buscar proveedor</strong><input id="providerSearch" type="search" placeholder="Booking, Expedia, Amadeus…" aria-label="Buscar proveedor por nombre"><div id="catalogResults"></div></div><form class="add-grid" id="addProvider"><strong>Configurar conector HTTP</strong><input name="name" required placeholder="Nombre del proveedor"><input name="endpoint" type="url" required placeholder="https://api.midominio.es/search"><input name="apiKey" type="password" placeholder="Token opcional"><button class="primary">Añadir conector</button></form></details><p class="note">El AID de Stay22 identifica las reservas de Hotelio y no es una contraseña. Las claves de otros proveedores se guardan únicamente en este navegador. Los resultados de Stay22 son de consulta en tiempo real y no se almacenan como favoritos permanentes.</p></section></div>`;
  root.querySelector('#closeModal').onclick=()=>root.innerHTML=''; root.querySelector('.modal-backdrop').onclick=e=>{if(e.target===e.currentTarget)root.innerHTML=''};
  root.querySelector('.save-apis').onclick=()=>{publicSearchProviders.forEach(p=>{publicApiSettings[p.id]=p.id==='stay22'?{aid:stay22Aid,enabled:root.querySelector(`[data-api-enable="${p.id}"]`).checked}:{token:root.querySelector(`[data-api-token="${p.id}"]`).value.trim(),enabled:root.querySelector(`[data-api-enable="${p.id}"]`).checked}});localStorage.setItem(apiKeyStore,JSON.stringify(publicApiSettings));const button=root.querySelector('.save-apis');button.textContent='✓ Guardado';setTimeout(()=>button.textContent='Guardar configuración',1400)};
  root.querySelectorAll('[data-toggle]').forEach(el=>el.onchange=()=>{providers.find(p=>p.id===el.dataset.toggle).enabled=el.checked;saveProviders()});
  root.querySelectorAll('[data-remove]').forEach(el=>el.onclick=()=>{providers=providers.filter(p=>p.id!==el.dataset.remove);saveProviders();openProviders()});
  const renderCatalog=()=>{const term=root.querySelector('#providerSearch').value.trim().toLowerCase();const matches=providerCatalog.filter(p=>(p.name+' '+p.kind).toLowerCase().includes(term)).slice(0,8);root.querySelector('#catalogResults').innerHTML=matches.map((p,i)=>`<div class="catalog-item"><span><strong>✓ ${esc(p.name)}</strong><small>${esc(p.hint)}</small></span><div class="catalog-actions">${p.docs?`<a href="${esc(p.docs)}" target="_blank" rel="noopener">Documentación</a>`:''}<button type="button" data-catalog="${i}">${esc(p.kind)} · Elegir</button></div></div>`).join('')||'<p class="note">No aparece. Usa “Proveedor personalizado” y escribe el nombre.</p>';root.querySelectorAll('[data-catalog]').forEach((el,i)=>el.onclick=()=>{const p=matches[i];root.querySelector('[name="name"]').value=p.name;root.querySelector('[name="endpoint"]').placeholder='URL de tu conector para '+p.name;root.querySelector('[name="endpoint"]').focus()})};
  root.querySelector('#providerSearch').addEventListener('input',renderCatalog); renderCatalog();
  root.querySelector('#addProvider').onsubmit=e=>{e.preventDefault();const data=new FormData(e.currentTarget);providers.push({id:crypto.randomUUID(),name:data.get('name'),endpoint:data.get('endpoint'),apiKey:data.get('apiKey'),type:'http',enabled:true});saveProviders();openProviders()};
}
document.querySelector('#savedBtn').onclick=()=>openSaved();
document.querySelector('#providersBtn').onclick=openProviders;
updateSavedButton();
if (!globalThis.Capacitor?.isNativePlatform?.()&&'serviceWorker' in navigator) window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js'));
