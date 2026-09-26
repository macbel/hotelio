const esc=value=>String(value??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const tokenKey='vuelotel-session-v1';
// Capacitor sirve la aplicación con https://localhost. El protocolo por sí
// solo no permite distinguirla de la web publicada, por eso usamos su API
// oficial y dejamos los protocolos antiguos como compatibilidad.
const native=()=>Boolean(globalThis.Capacitor?.isNativePlatform?.())||location.protocol==='capacitor:'||location.protocol==='file:';
const api=file=>native()?`https://www.alufi.es/vuelotel/api/${file}`:new URL(`./api/${file}`,document.baseURI).href;
let token=localStorage.getItem(tokenKey)||'',session=null,lastSearch=null;

async function request(file,{method='GET',body}={}){
  const response=await fetch(api(file),{method,credentials:'include',headers:{Accept:'application/json',...(body?{'Content-Type':'application/json'}:{}),...(token?{Authorization:`Bearer ${token}`}:{})},body:body?JSON.stringify(body):undefined});
  const data=await response.json().catch(()=>({}));if(!response.ok){const error=new Error(data.error||`Error ${response.status}`);error.status=response.status;throw error}return data;
}

function authMarkup(mode='login'){
  const reset=new URLSearchParams(location.search).get('reset');
  if(reset)return `<div class="account-card"><button class="account-close" type="button">×</button><span class="eyebrow">Recuperación segura</span><h2>Nueva contraseña</h2><form data-auth="reset"><input type="hidden" name="token" value="${esc(reset)}"><label>Nueva contraseña<input type="password" name="password" minlength="10" required autocomplete="new-password"></label><button class="primary">Guardar contraseña</button></form><p class="account-message"></p></div>`;
  if(mode==='register')return `<div class="account-card"><button class="account-close" type="button">×</button><span class="eyebrow">Tu cuenta Rumbiva</span><h2>Crear cuenta</h2><form data-auth="register"><label>Nombre (opcional)<input name="displayName" autocomplete="name"></label><label>Correo<input type="email" name="email" required autocomplete="email"></label><label>Contraseña<input type="password" name="password" minlength="10" required autocomplete="new-password"></label><button class="primary">Crear mi cuenta</button></form><button class="account-link" data-auth-mode="login">Ya tengo cuenta</button><p class="account-message"></p></div>`;
  if(mode==='recover')return `<div class="account-card"><button class="account-close" type="button">×</button><span class="eyebrow">Recuperar acceso</span><h2>¿Has olvidado tu contraseña?</h2><p>Te enviaremos un enlace válido durante una hora.</p><form data-auth="request_reset"><label>Correo<input type="email" name="email" required autocomplete="email"></label><button class="primary">Enviar enlace</button></form><button class="account-link" data-auth-mode="login">Volver al acceso</button><p class="account-message"></p></div>`;
  return `<div class="account-card"><button class="account-close" type="button">×</button><span class="eyebrow">Bienvenido a Rumbiva</span><h2>Accede a tus viajes</h2><form data-auth="login"><label>Correo<input type="email" name="email" required autocomplete="email"></label><label>Contraseña<input type="password" name="password" required autocomplete="current-password"></label><button class="primary">Entrar</button></form><button class="account-link" data-auth-mode="recover">He olvidado mi contraseña</button><button class="account-link" data-auth-mode="register">Crear una cuenta</button><p class="account-message"></p></div>`;
}

function showAuth(mode='login'){
  const host=document.querySelector('#accountOverlay');host.hidden=false;host.innerHTML=authMarkup(mode);
  host.querySelector('.account-close')?.addEventListener('click',()=>{host.hidden=true;host.replaceChildren()});
  host.querySelectorAll('[data-auth-mode]').forEach(button=>button.addEventListener('click',()=>showAuth(button.dataset.authMode)));
  host.querySelector('form')?.addEventListener('submit',handleAuth);
}

async function handleAuth(event){
  event.preventDefault();const form=event.currentTarget,button=form.querySelector('button'),message=form.parentElement.querySelector('.account-message'),values=Object.fromEntries(new FormData(form));button.disabled=true;message.textContent='';
  try{const data=await request('auth.php',{method:'POST',body:{action:form.dataset.auth,...values}});if(data.token){token=data.token;localStorage.setItem(tokenKey,token);session=data.user;document.querySelector('#accountOverlay').hidden=true;syncHeader();await showAccount()}else{message.textContent=data.message||'Contraseña actualizada. Ya puedes iniciar sesión.';if(form.dataset.auth==='reset')history.replaceState(null,'',location.pathname+location.hash)}}catch(error){message.textContent=error.message}finally{button.disabled=false}
}

function syncHeader(){
  const button=document.querySelector('#accountBtn');if(!button)return;button.textContent=session?`● ${session.displayName||session.email.split('@')[0]}`:'◉ Acceder';
  document.querySelector('#adminBtn')?.toggleAttribute('hidden',session?.role!=='admin');
}

const date=value=>value?new Intl.DateTimeFormat('es-ES',{dateStyle:'medium'}).format(new Date(Number(value)*1000)):'—';
const dateTime=value=>value?new Intl.DateTimeFormat('es-ES',{dateStyle:'short',timeStyle:'short'}).format(new Date(Number(value)*1000)):'—';
function itemCard(item,kind){
  const icons={hotel:'⌂',flight:'✈',combined:'✈+',destination:'◎'},type=item.type||'hotel';
  const open=kind==='search'?`<button class="ghost" type="button" data-open-search="${item.id}">Consultar →</button>`:'';
  const labels={hotel:'Hotel',flight:'Vuelo',combined:'Hotel + vuelo',destination:'Seguimiento de destino'};
  const alertStatus=kind==='alert'?`<small class="alert-status ${item.last_status==='error'||item.last_status==='mail_failed'?'alert-status-error':''}">${item.active==0?'Caducada · ':''}${item.last_status==='sent'?'Correo aceptado por el servidor · ':item.last_status==='mail_failed'?'Correo pendiente de reintento · ':item.last_status==='error'?'Última consulta fallida · ':item.last_checked_at?'Precio comprobado · ':'Aún sin comprobar · '}última revisión ${dateTime(item.last_checked_at)} · próxima ${dateTime(item.next_check_at)}</small>${item.last_error?`<small class="alert-status-error">${esc(item.last_error)}</small>`:''}`:'';
  return `<article class="account-item"><span class="account-item-icon">${icons[type]||'♡'}</span><div><strong>${esc(item.label)}</strong><small>${esc(labels[type]||'Búsqueda')} · ${kind==='alert'?`cada ${item.frequency_hours} h · caduca ${date(item.expires_at)}`:`guardada ${date(item.created_at)}`}</small>${alertStatus}</div><div class="account-item-actions">${open}<button class="danger" type="button" data-delete-kind="${kind}" data-delete-id="${item.id}">Eliminar</button></div></article>`;
}

async function showAccount(){
  if(!session){showAuth();return}const panel=document.querySelector('#accountPanel');panel.hidden=false;panel.innerHTML='<div class="account-loading">Cargando tu espacio…</div>';
  try{const data=await request('account.php');panel.innerHTML=`<div class="account-panel-head"><div><span class="eyebrow">Espacio personal</span><h2>${esc(session.displayName||session.email)}</h2><p>${esc(session.email)}</p></div><button class="account-close" data-close-panel>×</button></div><div class="account-tabs"><button class="is-active" data-account-tab="searches">Búsquedas</button><button data-account-tab="favorites">Favoritos</button><button data-account-tab="alerts">Alertas</button></div><section data-account-section="searches">${data.searches.length?data.searches.map(x=>itemCard(x,'search')).join(''):'<p class="account-empty">Aún no has guardado búsquedas.</p>'}</section><section data-account-section="favorites" hidden>${data.favorites.length?data.favorites.map(x=>itemCard(x,'favorite')).join(''):'<p class="account-empty">Aún no tienes favoritos.</p>'}</section><section data-account-section="alerts" hidden>${data.alerts.length?data.alerts.map(x=>itemCard(x,'alert')).join(''):'<p class="account-empty">No tienes alertas activas.</p>'}</section><div class="account-panel-actions"><button class="ghost" data-logout>Cerrar sesión</button></div>`;wirePanel(panel,data)}catch(error){panel.innerHTML=`<p class="flight-error">${esc(error.message)}</p>`}
}

function wirePanel(panel,data){
  panel.querySelector('[data-close-panel]').onclick=()=>panel.hidden=true;
  panel.querySelectorAll('[data-account-tab]').forEach(button=>button.onclick=()=>{panel.querySelectorAll('[data-account-tab]').forEach(x=>x.classList.toggle('is-active',x===button));panel.querySelectorAll('[data-account-section]').forEach(x=>x.hidden=x.dataset.accountSection!==button.dataset.accountTab)});
  panel.querySelector('[data-logout]').onclick=async()=>{await request('auth.php',{method:'POST',body:{action:'logout'}}).catch(()=>{});token='';session=null;localStorage.removeItem(tokenKey);panel.hidden=true;syncHeader()};
  panel.querySelectorAll('[data-open-search]').forEach(button=>button.onclick=()=>{const search=data.searches.find(item=>String(item.id)===String(button.dataset.openSearch));if(!search)return;panel.hidden=true;window.dispatchEvent(new CustomEvent('vuelotel:open-saved-search',{detail:search}))});
  panel.querySelectorAll('[data-delete-kind]').forEach(button=>button.onclick=async()=>{await request('account.php',{method:'POST',body:{action:'delete',kind:button.dataset.deleteKind,id:Number(button.dataset.deleteId)}});await showAccount()});
}

async function saveLast(kind,frequencyHours){
  if(!session){showAuth();return}if(!lastSearch)return;
  const label=lastSearch.label||'Mi búsqueda';const base={type:lastSearch.type,label,price:lastSearch.price,currency:lastSearch.currency||'EUR'};
  if(kind==='search')await request('account.php',{method:'POST',body:{action:'save_search',filters:lastSearch.query,...base}});
  else {
    const bar=document.querySelector('#searchActions'),mode=lastSearch.type==='destination'?(bar?.querySelector('[data-alert-mode]')?.value||'lower'):undefined,threshold=mode==='threshold'?Number(bar?.querySelector('[data-alert-threshold]')?.value):undefined;
    await request('account.php',{method:'POST',body:{action:'create_alert',query:lastSearch.query,frequencyHours,alertMode:mode,threshold,...base}});
  }
  await showAccount();
}

async function saveFavorite(detail){
  if(!session){showAuth();return}
  try{await request('account.php',{method:'POST',body:{action:'save_favorite',...detail}})}catch(error){alert(error.message)}
}

function showSaveBar(detail){
  lastSearch=detail;
  let bar=document.querySelector('#searchActions');
  if(!bar){bar=document.createElement('aside');bar.id='searchActions';bar.className='search-actions';document.body.append(bar)}
  const destination=detail.type==='destination';
  const hint=destination&&detail.price===null?'La alerta establecerá su precio de referencia al completar la comparación de fechas.':'Guárdala o vigila cualquier cambio de precio durante 7 días.';
  bar.innerHTML=`<span><strong>${esc(detail.label||'Búsqueda lista')}</strong><small>${esc(hint)}</small></span><button data-save-search>Guardar búsqueda</button><label>Alerta <select data-alert-frequency><option value="12">cada 12 h</option><option value="24" selected>diaria</option><option value="72">cada 3 días</option><option value="168">semanal</option></select></label>${destination?'<label>Cuando <select data-alert-mode><option value="lower" selected>haya un nuevo mínimo</option><option value="threshold">baje de un precio</option></select></label><label data-threshold-wrap hidden>€ <input data-alert-threshold type="number" min="1" step="1" placeholder="Precio máximo"></label>':''}<button data-create-alert>Crear alerta</button><button class="account-close" data-close-actions>×</button>`;
  bar.querySelector('[data-save-search]').onclick=()=>saveLast('search');
  bar.querySelector('[data-create-alert]').onclick=()=>{if(destination&&bar.querySelector('[data-alert-mode]')?.value==='threshold'&&!(Number(bar.querySelector('[data-alert-threshold]')?.value)>0)){alert('Indica el precio límite de la alerta.');return}saveLast('alert',Number(bar.querySelector('[data-alert-frequency]').value)).catch(error=>alert(error.message))};
  bar.querySelector('[data-alert-mode]')?.addEventListener('change',event=>{const wrap=bar.querySelector('[data-threshold-wrap]');if(wrap)wrap.hidden=event.target.value!=='threshold'});
  bar.querySelector('[data-close-actions]').onclick=()=>bar.remove();
}

async function showAdmin(){if(session?.role!=='admin')return;const data=await request('admin-users.php');const panel=document.querySelector('#accountPanel');panel.hidden=false;panel.innerHTML=`<div class="account-panel-head"><div><span class="eyebrow">Administración</span><h2>Usuarios</h2><p>${data.users.length} cuentas</p></div><button class="account-close" data-close-panel>×</button></div><label class="admin-setting"><input type="checkbox" data-registration ${data.settings.publicRegistration?'checked':''}> Permitir registro público</label><form class="admin-create"><input type="email" name="email" placeholder="Correo" required><input name="displayName" placeholder="Nombre"><input type="password" name="password" minlength="10" placeholder="Contraseña inicial" required><button class="primary">Crear usuario</button></form><div>${data.users.map(user=>`<article class="account-item"><span class="account-item-icon">${user.role==='admin'?'◆':'●'}</span><div><strong>${esc(user.display_name||user.email)}</strong><small>${esc(user.email)} · ${esc(user.status)} · ${user.active_alerts} alertas</small></div>${Number(user.id)!==Number(session.id)?`<button class="danger" data-admin-delete="${user.id}">Eliminar</button>`:''}</article>`).join('')}</div>`;panel.querySelector('[data-close-panel]').onclick=()=>panel.hidden=true;panel.querySelector('[data-registration]').onchange=e=>request('admin-users.php',{method:'POST',body:{action:'settings',publicRegistration:e.target.checked}});panel.querySelector('.admin-create').onsubmit=async e=>{e.preventDefault();await request('admin-users.php',{method:'POST',body:{action:'create',...Object.fromEntries(new FormData(e.currentTarget))}});await showAdmin()};panel.querySelectorAll('[data-admin-delete]').forEach(b=>b.onclick=async()=>{if(confirm('¿Eliminar este usuario y todos sus datos?')){await request('admin-users.php',{method:'POST',body:{action:'delete',id:Number(b.dataset.adminDelete)}});await showAdmin()}})}

async function showAdminV2(){
  if(session?.role!=='admin')return;
  const data=await request('admin-users.php'),panel=document.querySelector('#accountPanel');panel.hidden=false;
  panel.innerHTML=`<div class="account-panel-head"><div><span class="eyebrow">Administración</span><h2>Usuarios</h2><p>${data.users.length} cuentas · máximo ${data.settings.maxAlerts} alertas por usuario</p></div><button class="account-close" data-close-panel>×</button></div><label class="admin-setting"><input type="checkbox" data-registration ${data.settings.publicRegistration?'checked':''}> Permitir registro público</label><form class="admin-create"><input type="email" name="email" placeholder="Correo" required><input name="displayName" placeholder="Nombre"><input type="password" name="password" minlength="10" placeholder="Contraseña inicial" required><button class="primary">Crear usuario</button></form><div>${data.users.map(user=>`<article class="account-item admin-user" data-user-id="${user.id}"><span class="account-item-icon">${user.role==='admin'?'◆':'●'}</span><div><strong>${esc(user.display_name||user.email)}</strong><small>${esc(user.email)} · ${user.active_alerts} alertas</small><span><select data-user-role ${Number(user.id)===Number(session.id)?'disabled':''}><option value="user" ${user.role==='user'?'selected':''}>Usuario</option><option value="admin" ${user.role==='admin'?'selected':''}>Administrador</option></select><select data-user-status ${Number(user.id)===Number(session.id)?'disabled':''}><option value="active" ${user.status==='active'?'selected':''}>Activo</option><option value="blocked" ${user.status==='blocked'?'selected':''}>Bloqueado</option></select></span></div>${Number(user.id)!==Number(session.id)?'<div><button class="ghost" data-admin-save>Guardar</button><button class="danger" data-admin-delete>Eliminar</button></div>':''}</article>`).join('')}</div>`;
  const health=data.alertsHealth||{};
  panel.querySelector('.account-panel-head').insertAdjacentHTML('afterend',`<div class="admin-metrics"><span><strong>${data.usage.flightCalls}/${data.usage.flightLimit}</strong>consultas de vuelo</span><span><strong>${data.usage.activeAlerts}</strong>alertas activas</span><span><strong>${data.usage.emailsSent}/${data.usage.emailsAttempted}</strong>correos aceptados por el servidor</span></div><p class="admin-alert-health">Alertas: ${health.enabled?'activas':'pausadas'} · acceso del programador ${health.cronConfigured?'configurado':'sin configurar'} · última ejecución ${dateTime(health.lastRunAt)}.</p><a class="admin-provider-link" href="./admin/">Configurar proveedores y límites →</a>`);
  panel.querySelector('[data-close-panel]').onclick=()=>panel.hidden=true;
  panel.querySelector('[data-registration]').onchange=e=>request('admin-users.php',{method:'POST',body:{action:'settings',publicRegistration:e.target.checked}});
  panel.querySelector('.admin-create').onsubmit=async e=>{e.preventDefault();await request('admin-users.php',{method:'POST',body:{action:'create',...Object.fromEntries(new FormData(e.currentTarget))}});await showAdminV2()};
  panel.querySelectorAll('[data-admin-save]').forEach(button=>button.onclick=async()=>{const card=button.closest('[data-user-id]');await request('admin-users.php',{method:'POST',body:{action:'update',id:Number(card.dataset.userId),displayName:card.querySelector('strong').textContent,role:card.querySelector('[data-user-role]').value,status:card.querySelector('[data-user-status]').value}});await showAdminV2()});
  panel.querySelectorAll('[data-admin-delete]').forEach(button=>button.onclick=async()=>{const card=button.closest('[data-user-id]');if(confirm('¿Eliminar este usuario y todos sus datos?')){await request('admin-users.php',{method:'POST',body:{action:'delete',id:Number(card.dataset.userId)}});await showAdminV2()}});
}

export async function mountAccount(){
  document.body.insertAdjacentHTML('beforeend','<div id="accountOverlay" class="account-overlay" hidden></div><aside id="accountPanel" class="account-panel" hidden></aside>');
  document.querySelector('#accountBtn')?.addEventListener('click',()=>session?showAccount():showAuth());document.querySelector('#adminBtn')?.addEventListener('click',showAdminV2);window.addEventListener('vuelotel:search-complete',event=>showSaveBar(event.detail));window.addEventListener('vuelotel:favorite',event=>saveFavorite(event.detail));
  try{const data=await request('auth.php');session=data.user||null}catch(error){
    // Un fallo de red/offline no invalida una sesión que puede seguir siendo
    // válida. Solo una respuesta explícita del backend elimina el token.
    if(error?.status===401||error?.status===403){token='';session=null;localStorage.removeItem(tokenKey)}
  }syncHeader();if(new URLSearchParams(location.search).has('reset'))showAuth();
}
