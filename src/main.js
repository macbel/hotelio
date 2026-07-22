import {loadProviderConfiguration, searchPublicProvider} from './providers.js?v=1.1.1';

const fallbackProviders=[{id:'stay22',name:'Stay22',enabled:true,capabilities:{price:true,accommodationType:false,board:false,images:true}}];
let providerConfigurationPromise=loadProviderConfiguration().catch(()=>fallbackProviders);
let results = [];
let errors = [];
let notices = [];
const savedStoreKey='hotelio-saved-hotels-v1';
let savedHotels=JSON.parse(localStorage.getItem(savedStoreKey)||'[]');
if(!Array.isArray(savedHotels))savedHotels=[];
const selectedSaved=new Set();
let currentQuery=null;

const today = new Date();
const iso = date => date.toISOString().slice(0, 10);
const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
const nextWeek = new Date(today); nextWeek.setDate(today.getDate() + 5);

document.querySelector('#app').innerHTML = `
  <main class="shell">
    <nav class="topbar"><div class="brand"><span class="brand-mark">H</span> Hotelio</div><div class="nav-actions"><button class="ghost saved-nav" id="savedBtn">♡ Guardados <span id="savedCount">0</span></button></div></nav>
    <section class="hero"><div><div class="eyebrow">Tu viaje, al precio justo</div><h1>Duerme bien.<br>Ahorra más.</h1><p>Compara en un solo lugar los alojamientos de tus proveedores favoritos y encuentra la opción que encaja contigo.</p></div><div class="hero-art" aria-hidden="true"><div class="sun"></div><div class="hotel"><div class="windows"><i></i><i></i><i></i><i></i></div></div></div></section>
    <form class="search-card" id="searchForm">
      <div class="fields">
        <div class="field"><label for="destination">Destino</label><input id="destination" required placeholder="¿Adónde quieres ir?" value="Valencia"></div>
        <div class="field"><label for="checkIn">Entrada</label><input id="checkIn" type="date" required min="${iso(today)}" value="${iso(tomorrow)}"></div>
        <div class="field"><label for="checkOut">Salida</label><input id="checkOut" type="date" required min="${iso(tomorrow)}" value="${iso(nextWeek)}"></div>
        <div class="field"><label for="adults">Adultos</label><select id="adults"><option value="1">1 adulto</option><option value="2" selected>2 adultos</option><option value="3">3 adultos</option><option value="4">4 adultos</option><option value="5">5 adultos</option><option value="6">6 adultos</option></select></div>
        <div class="field"><label for="children">Niños</label><select id="children"><option value="0" selected>Sin niños</option><option value="1">1 niño</option><option value="2">2 niños</option><option value="3">3 niños</option><option value="4">4 niños</option></select></div>
        <div class="field"><label>Precio/noche (opcional)</label><div class="range-row"><input id="minPrice" type="number" min="0" placeholder="Mín." aria-label="Precio mínimo"><span>—</span><input id="maxPrice" type="number" min="1" placeholder="Máx." aria-label="Precio máximo"></div></div>
        <div class="field"><label for="accommodationType">Tipo (opcional)</label><select id="accommodationType"><option value="any" selected>Cualquiera</option><option value="hotel">Hotel</option><option value="apartment">Apartamento / aparthotel</option><option value="hostel">Hostal / albergue</option><option value="resort">Resort</option><option value="bed_and_breakfast">Casa rural / B&amp;B</option></select></div>
        <div class="field"><label for="board">Régimen (opcional)</label><select id="board"><option value="any" selected>Cualquiera</option><option value="room_only">Solo alojamiento</option><option value="breakfast">AD · Alojamiento y desayuno</option><option value="half_board">MP · Media pensión</option><option value="full_board">PC · Pensión completa</option><option value="all_inclusive">Todo incluido</option></select></div>
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
const optionalNumber=id=>{const value=document.querySelector(id).value.trim();return value===''?null:Number(value)};
const accommodationLabels={any:'Cualquier alojamiento',hotel:'Hotel',apartment:'Apartamento / aparthotel',hostel:'Hostal / albergue',resort:'Resort',bed_and_breakfast:'Casa rural / B&B'};
const boardLabels={any:'Cualquier régimen',room_only:'Solo alojamiento',breakfast:'Alojamiento y desayuno',half_board:'Media pensión',full_board:'Pensión completa',all_inclusive:'Todo incluido'};
const withinPrice=(price,query)=>(query.minPrice===null||price>=query.minPrice)&&(query.maxPrice===null||price<=query.maxPrice);
const priceLabel=query=>query.minPrice===null&&query.maxPrice===null?'Sin límite de precio':query.minPrice===null?`Hasta ${query.maxPrice} €/noche`:query.maxPrice===null?`Desde ${query.minPrice} €/noche`:`${query.minPrice}–${query.maxPrice} €/noche`;

function readQueryFromForm(){
  const checkIn=document.querySelector('#checkIn').value,checkOut=document.querySelector('#checkOut').value;
  const adults=Number(document.querySelector('#adults').value),childrenAges=[...document.querySelectorAll('.child-age')].map(el=>Number(el.value));
  return {destination:document.querySelector('#destination').value.trim(),checkIn,checkOut,adults,children:childrenAges.length,childrenAges,guests:adults+childrenAges.length,rooms:1,minPrice:optionalNumber('#minPrice'),maxPrice:optionalNumber('#maxPrice'),accommodationType:document.querySelector('#accommodationType').value,board:document.querySelector('#board').value,currency:'EUR',nights:nightsBetween(checkIn,checkOut)};
}

function searchFingerprint(search={}){
  return [search.checkIn,search.checkOut,search.adults,(search.childrenAges||[]).join('-'),search.accommodationType||'any',search.board||'any'].join('|');
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
    saved={id:newId(),identity,name:hotel.name,location:hotel.location||query.destination,image:hotel.image||'',rating:hotel.rating||'',features:[...(hotel.features||[])],search:{destination:query.destination,checkIn:query.checkIn,checkOut:query.checkOut,adults:query.adults,childrenAges:[...(query.childrenAges||[])],accommodationType:query.accommodationType,board:query.board,nights:query.nights},offers:[]};
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
  const bookingPrice=query.minPrice===null&&query.maxPrice===null?'':`&nflt=${encodeURIComponent(`price=EUR-${query.minPrice??0}-${query.maxPrice??99999}-1`)}`;
  const expediaPrice=`${query.minPrice===null?'':`&price=${query.minPrice}`}${query.maxPrice===null?'':`&price=${query.maxPrice}`}`;
  const publicNote=`Fechas y ocupantes · ${priceLabel(query)}`;
  const destinationKey=query.destination.normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
  const portalDestinations={
    salou:{trivago:'https://www.trivago.es/es/odr/hoteles-salou-espa%C3%B1a?search=200-53957',hostelworld:{q:'Salou, Catalonia, Spain',country:'Catalonia, Spain',city:'Salou',id:'800'}},
    valencia:{trivago:'https://www.trivago.es/es/odr/hoteles-valencia-espa%C3%B1a?search=200-53826'}
  };
  const portalDestination=portalDestinations[destinationKey], hostelworld=portalDestination?.hostelworld;
  return [
    {name:'Booking.com', public:true, note:publicNote, url:`https://www.booking.com/searchresults.es.html?ss=${destination}&checkin=${query.checkIn}&checkout=${query.checkOut}&group_adults=${query.adults}&no_rooms=${query.rooms}&group_children=${query.children}${childAges.map(age=>`&age=${age}`).join('')}${bookingPrice}`},
    {name:'Expedia', public:true, note:publicNote, url:`https://www.expedia.es/Hotel-Search?destination=${destination}&startDate=${query.checkIn}&endDate=${query.checkOut}&rooms=1&adults=${query.adults}${childAges.length?`&children=${expediaChildren}`:''}${expediaPrice}`},
    {name:'Hotels.com', public:true, note:publicNote, url:`https://www.hotels.com/Hotel-Search?destination=${destination}&startDate=${query.checkIn}&endDate=${query.checkOut}&rooms=1&adults=${query.adults}${childAges.length?`&children=${expediaChildren}`:''}${expediaPrice}`},
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
  const preferences=`${accommodationLabels[query.accommodationType]} · ${boardLabels[query.board]} · ${priceLabel(query)}`;
  return `<section class="direct-search"><div class="results-head"><div><span class="eyebrow">Búsqueda real sin cuenta</span><h2>Consultar en otras webs</h2><p>${esc(query.destination)} · ${query.nights} noches · ${esc(people)}</p><p class="search-preferences">${esc(preferences)}</p></div></div><div class="portal-grid">${directSearches(query).map(p=>`<a class="portal ${p.manual?'portal-manual':''}" href="${esc(p.url)}" target="_blank" rel="noopener"><span class="portal-logo">${esc(p.name.slice(0,1))}</span><span><strong>${esc(p.name)} ${p.manual?'<i>Manual</i>':p.public?'<i class="public-link">Público</i>':''}</strong><small>${esc(p.note)}</small></span><b>↗</b></a>`).join('')}</div><p class="direct-note">Los enlaces públicos reciben automáticamente los filtros que admite cada web. El tipo y el régimen deben confirmarse en el portal cuando su URL pública no permite transmitirlos.</p></section>`;
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
  const providerNotices=notices.length?`<p class="provider-notice">${notices.map(esc).join(' · ')}</p>`:'';
  const connected=results.length ? `<div class="results-head"><div><h2>${results.length} alojamientos encontrados</h2><p>Ordenados por precio total · ${query.nights} noches</p></div></div>${providerNotices}${stay22Notice}<div class="result-list">${results.map((r,i)=>`
    <article class="result" style="animation-delay:${i*45}ms"><div class="result-img">${['⌂','◇','◒','△'][i%4]}${r.image?`<img src="${esc(r.image)}" alt="${esc(r.name)}" loading="lazy" referrerpolicy="no-referrer">`:''}</div><div><div class="result-title"><h3>${esc(r.name)}</h3><button class="save-hotel ${r.persistable===false?'is-restricted':findSavedHotel(r,query)?'is-saved':''}" type="button" ${r.persistable===false?'disabled title="Stay22 solo permite consultar los resultados en tiempo real"':`data-save-result="${i}"`} aria-label="${r.persistable===false?'Resultado de consulta no guardable':`Guardar ${esc(r.name)}`}">${r.persistable===false?'Solo consulta':findSavedHotel(r,query)?'♥ Guardado':'♡ Guardar'}</button></div><div class="meta">★ ${esc(r.rating || '—')} · ${esc(r.location || query.destination)} · ${esc(r.provider)}</div><div class="chips">${(r.features||[]).slice(0,3).map(f=>`<span class="chip">${esc(f)}</span>`).join('')}</div></div><div class="price"><strong>${money(r.totalPrice,r.currency)}</strong><small>${money(r.nightlyPrice,r.currency)} / noche</small><a href="${esc(r.url || '#')}" target="_blank" rel="noopener">Ver oferta →</a></div></article>`).join('')}</div>`
    : ((errors.length||notices.length) ? `<div class="provider-errors">${esc([...notices,...errors].join(' · '))}</div>` : '');
  root.innerHTML=renderDirectSearches(query)+connected;
  root.querySelectorAll('.result-img img').forEach(image=>image.addEventListener('error',()=>image.remove(),{once:true}));
}

document.querySelector('#searchForm').addEventListener('submit', async e => {
  e.preventDefault(); const btn=e.currentTarget.querySelector('button');
  const checkIn=document.querySelector('#checkIn').value, checkOut=document.querySelector('#checkOut').value;
  if (new Date(checkOut)<=new Date(checkIn)) { alert('La fecha de salida debe ser posterior a la entrada.'); return; }
  const query=readQueryFromForm(); currentQuery=query;
  if(query.minPrice!==null&&query.maxPrice!==null&&query.minPrice>query.maxPrice){alert('El precio mínimo no puede superar al máximo.');return}
  btn.disabled=true; btn.textContent='Comparando…'; document.querySelector('#results').innerHTML='<div class="loading"><i></i><i></i><i></i></div>';
  errors=[];notices=[];
  const configuredProviders=await providerConfigurationPromise;
  const jobs=configuredProviders.filter(provider=>provider.enabled).flatMap(provider=>{
    if(query.board!=='any'&&!provider.capabilities?.board){notices.push(`${provider.name} no se consulta porque no permite filtrar el régimen seleccionado.`);return []}
    if(query.accommodationType!=='any'&&!provider.capabilities?.accommodationType){notices.push(`${provider.name} no se consulta porque no permite filtrar el tipo de alojamiento con fiabilidad.`);return []}
    return [{name:provider.name,run:()=>searchPublicProvider(provider,query)}];
  });
  const settled=await Promise.allSettled(jobs.map(job=>job.run()));
  results=settled.flatMap((r,i)=>{if(r.status==='rejected'){errors.push(r.reason?.message||jobs[i]?.name);return []}if(r.value.notice)notices.push(r.value.notice);return r.value.results}).filter(r=>withinPrice(Number(r.nightlyPrice),query)).sort((a,b)=>a.totalPrice-b.totalPrice);
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
  const type=accommodationLabels[search.accommodationType||'any'],board=boardLabels[search.board||'any'];
  return `${search.destination} · ${search.checkIn} → ${search.checkOut} · ${search.adults} adultos${children} · ${type} · ${board}`;
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

document.querySelector('#savedBtn').onclick=()=>openSaved();
updateSavedButton();
if (!globalThis.Capacitor?.isNativePlatform?.()&&'serviceWorker' in navigator) window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js?v=6'));
