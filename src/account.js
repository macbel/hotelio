import {alertConditions,conditionFields,wireConditions,readConditions,conditionsLabel,historyMarkup} from './alert-controls.js?v=2.6.0';
import {nativeAlertsAvailable,nativeAlertsStatus,enableNativeAlerts,syncNativeAlerts,disableNativeAlerts,watchNativeAlertOpens} from './native-alerts.js?v=2.6.0';
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
  try{const data=await request('auth.php',{method:'POST',body:{action:form.dataset.auth,...values}});if(data.token){token=data.token;localStorage.setItem(tokenKey,token);session=data.user;await syncNativeAlerts(token,session.id).catch(()=>{});document.querySelector('#accountOverlay').hidden=true;syncHeader();await showAccount()}else{message.textContent=data.message||'Contraseña actualizada. Ya puedes iniciar sesión.';if(form.dataset.auth==='reset')history.replaceState(null,'',location.pathname+location.hash)}}catch(error){message.textContent=error.message}finally{button.disabled=false}
}

function syncHeader(){
  const button=document.querySelector('#accountBtn');if(!button)return;button.textContent=session?`● ${session.displayName||session.email.split('@')[0]}`:'◉ Acceder';
  document.querySelector('#adminBtn')?.toggleAttribute('hidden',session?.role!=='admin');
}

const date=value=>value?new Intl.DateTimeFormat('es-ES',{dateStyle:'medium'}).format(new Date(Number(value)*1000)):'—';
const dateTime=value=>value?new Intl.DateTimeFormat('es-ES',{dateStyle:'short',timeStyle:'short'}).format(new Date(Number(value)*1000)):'—';
const isoDate=value=>new Date(Number(value)*1000).toISOString().slice(0,10);
const defaultExpiry=()=>new Date(Date.now()+7*86400000).toISOString().slice(0,10);
const frequencyOptions=selected=>[12,24,72,168].map(hours=>`<option value="${hours}" ${Number(selected)===hours?'selected':''}>${hours===24?'diaria':hours===72?'cada 3 días':hours===168?'semanal':'cada 12 h'}</option>`).join('');
function itemCard(item,kind){
  const icons={hotel:'⌂',flight:'✈',combined:'✈+',destination:'◎'},type=item.type||'hotel';
  const open=kind==='search'?`<button class="ghost" type="button" data-open-search="${item.id}">Consultar →</button>`:kind==='alert'?`<button class="ghost" type="button" data-open-alert="${item.id}">Ver búsqueda →</button>`:'';
  const labels={hotel:'Hotel',flight:'Vuelo',combined:'Hotel + vuelo',destination:item.query?._alertScope==='plan'?'Plan de viaje':'Seguimiento de destino'};
  const alertStatus=kind==='alert'?`<small class="alert-status ${['error','mail_failed','mail_unknown','needs_reconfiguration'].includes(item.last_status)?'alert-status-error':''}">${item.active==0?'Caducada · ':''}${item.last_status==='sent'?'Correo aceptado por el servidor · ':item.last_status==='mail_failed'?'Correo pendiente de reintento · ':item.last_status==='mail_unknown'?'Resultado del envío sin confirmar · ':item.last_status==='mail_pending'?'Envío en curso · ':item.last_status==='notify_pending'?'Aviso aplazado por frecuencia · ':item.last_status==='needs_reconfiguration'?'Actualizar esta alerta · ':item.last_status==='error'?'Última consulta fallida · ':item.last_checked_at?'Precio comprobado · ':(Number(item.active)===1&&Number(item.expires_at)*1000>Date.now()&&Number(item.next_check_at)*1000<=Date.now()?'Revisión pendiente · ':'Aún sin comprobar · ')}última revisión ${dateTime(item.last_checked_at)} · próxima ${dateTime(item.next_check_at)}</small>${item.last_error?`<small class="alert-status-error">${esc(item.last_error)}</small>`:''}`:'';
  const expired=kind==='alert'&&(Number(item.active)!==1||Number(item.expires_at)*1000<=Date.now());
  const edit=kind==='alert'?`<button class="ghost" type="button" data-alert-history="${item.id}" aria-expanded="false">Historial</button><button class="ghost" type="button" data-edit-alert="${item.id}" aria-expanded="false">Editar alerta</button>`:'';
  const editor=kind==='alert'?`<form class="alert-edit-form" data-alert-form="${item.id}" hidden><label>Comprobar cada <select name="frequencyHours">${frequencyOptions(item.frequency_hours)}</select></label><label>Caduca el <input type="date" name="expiresDate" value="${esc(isoDate(item.expires_at))}" min="${new Date().toISOString().slice(0,10)}" required></label>${expired?'<label><input type="checkbox" name="reactivate" required> Reactivar esta alerta</label>':''}${conditionFields({...alertConditions(item),currency:item.currency})}<button class="primary" type="submit">Guardar cambios</button><span class="alert-edit-message" role="status"></span></form>`:'';
  return `<article class="account-item"><span class="account-item-icon">${icons[type]||'♡'}</span><div><strong>${esc(item.label)}</strong><small>${esc(labels[type]||'Búsqueda')} · ${kind==='alert'?`cada ${item.frequency_hours} h · caduca ${date(item.expires_at)}`:`guardada ${date(item.created_at)}`}</small>${alertStatus}${kind==='alert'?`<small>${esc(conditionsLabel(item))}</small><section class="alert-history" data-history="${item.id}" hidden></section>`:''}${editor}</div><div class="account-item-actions">${open}${edit}<button class="danger" type="button" data-delete-kind="${kind}" data-delete-id="${item.id}">Eliminar</button></div></article>`;
}

async function showAccount(tab='searches'){
  if(!session){showAuth();return}const panel=document.querySelector('#accountPanel');panel.hidden=false;panel.innerHTML='<div class="account-loading">Cargando tu espacio…</div>';
  try{const data=await request('account.php');panel.innerHTML=`<div class="account-panel-head"><div><span class="eyebrow">Espacio personal</span><h2>${esc(session.displayName||session.email)}</h2><p>${esc(session.email)}</p></div><button class="account-close" data-close-panel>×</button></div><div class="account-tabs"><button class="is-active" data-account-tab="searches">Búsquedas</button><button data-account-tab="favorites">Favoritos</button><button data-account-tab="alerts">Alertas</button></div><section data-account-section="searches">${data.searches.length?data.searches.map(x=>itemCard(x,'search')).join(''):'<p class="account-empty">Aún no has guardado búsquedas.</p>'}</section><section data-account-section="favorites" hidden>${data.favorites.length?data.favorites.map(x=>itemCard(x,'favorite')).join(''):'<p class="account-empty">Aún no tienes favoritos.</p>'}</section><section data-account-section="alerts" hidden>${data.alerts.length?data.alerts.map(x=>itemCard(x,'alert')).join(''):'<p class="account-empty">No tienes alertas.</p>'}</section><div class="account-panel-actions"><button class="ghost" data-logout>Cerrar sesión</button></div>`;wirePanel(panel,data,tab)}catch(error){panel.innerHTML=`<p class="flight-error">${esc(error.message)}</p>`}
}

function wirePanel(panel,data,tab='searches'){
  panel.querySelector('[data-close-panel]').onclick=()=>panel.hidden=true;
  const selectTab=selected=>{panel.querySelectorAll('[data-account-tab]').forEach(x=>x.classList.toggle('is-active',x.dataset.accountTab===selected));panel.querySelectorAll('[data-account-section]').forEach(x=>x.hidden=x.dataset.accountSection!==selected)};
  selectTab(tab);
  panel.querySelectorAll('[data-account-tab]').forEach(button=>button.onclick=()=>selectTab(button.dataset.accountTab));
  panel.querySelector('[data-logout]').onclick=async()=>{await disableNativeAlerts().catch(()=>{});await request('auth.php',{method:'POST',body:{action:'logout'}}).catch(()=>{});token='';session=null;localStorage.removeItem(tokenKey);panel.hidden=true;syncHeader()};
  mountNativeSettings(panel);
  panel.querySelectorAll('[data-open-search]').forEach(button=>button.onclick=()=>{const search=data.searches.find(item=>String(item.id)===String(button.dataset.openSearch));if(!search)return;panel.hidden=true;window.dispatchEvent(new CustomEvent('vuelotel:open-saved-search',{detail:search}))});
  panel.querySelectorAll('[data-open-alert]').forEach(button=>button.onclick=()=>{const alert=data.alerts.find(item=>String(item.id)===String(button.dataset.openAlert));if(!alert)return;panel.hidden=true;window.dispatchEvent(new CustomEvent('vuelotel:open-saved-search',{detail:{type:alert.type,filters:alert.query||{}}}))});
  panel.querySelectorAll('[data-edit-alert]').forEach(button=>button.onclick=()=>{const editor=panel.querySelector(`[data-alert-form="${button.dataset.editAlert}"]`);editor.hidden=!editor.hidden;button.setAttribute('aria-expanded',String(!editor.hidden));if(!editor.hidden)editor.querySelector('select')?.focus()});
  panel.querySelectorAll('[data-alert-form]').forEach(form=>wireConditions(form));
  panel.querySelectorAll('[data-alert-history]').forEach(button=>button.onclick=async()=>{const host=panel.querySelector(`[data-history="${button.dataset.alertHistory}"]`);host.hidden=!host.hidden;button.setAttribute('aria-expanded',String(!host.hidden));if(host.hidden)return;host.innerHTML='<p role="status">Cargando historial…</p>';try{const history=await request(`account.php?action=alert_history&id=${Number(button.dataset.alertHistory)}`);host.innerHTML=historyMarkup(history.checks);if(history.nextBeforeId){const more=document.createElement('button');more.className='ghost';more.textContent='Ver comprobaciones anteriores';let cursor=history.nextBeforeId;more.onclick=async()=>{more.disabled=true;try{const older=await request(`account.php?action=alert_history&id=${Number(button.dataset.alertHistory)}&beforeId=${cursor}`);more.insertAdjacentHTML('beforebegin',historyMarkup(older.checks));cursor=older.nextBeforeId;if(!cursor)more.remove()}catch(error){more.textContent=error.message}finally{more.disabled=false}};host.append(more)}}catch(error){host.textContent=error.message}});
  panel.querySelectorAll('[data-alert-form]').forEach(form=>form.onsubmit=async event=>{event.preventDefault();const button=form.querySelector('[type="submit"]'),message=form.querySelector('.alert-edit-message');if(!form.reportValidity())return;button.disabled=true;message.textContent='';try{await request('account.php',{method:'POST',body:{action:'update_alert',id:Number(form.dataset.alertForm),frequencyHours:Number(form.elements.frequencyHours.value),expiresDate:form.elements.expiresDate.value,reactivate:form.elements.reactivate?.checked===true,conditions:readConditions(form)}});await showAccount('alerts')}catch(error){message.textContent=error.message}finally{button.disabled=false}});
  panel.querySelectorAll('[data-delete-kind]').forEach(button=>button.onclick=async()=>{await request('account.php',{method:'POST',body:{action:'delete',kind:button.dataset.deleteKind,id:Number(button.dataset.deleteId)}});await showAccount()});
}

async function mountNativeSettings(panel){
  if(!nativeAlertsAvailable())return;
  const host=document.createElement('section');host.className='native-alert-settings';panel.querySelector('[data-account-section=alerts]').prepend(host);
  try{const state=await nativeAlertsStatus();if(!host.isConnected)return;const enabled=Boolean(state.enabled)&&Boolean(state.permissionGranted??state.granted??(state.permission===true||state.permission==='granted'));host.innerHTML=`<strong>Avisos en este móvil</strong><p>${enabled?'Activados.':'Puedes recibir las bajadas también en Android.'} Se comprueban periódicamente con conexión; Android puede aplazarlos para ahorrar batería.</p><button class="ghost" type="button">${enabled?'Desactivar avisos':'Activar avisos'}</button><p role="status"></p>`;host.querySelector('button').onclick=async event=>{event.currentTarget.disabled=true;const message=host.querySelector('[role=status]');try{if(enabled)await disableNativeAlerts();else await enableNativeAlerts(token,session.id);await showAccount('alerts')}catch(error){message.textContent=error.message||'No se pudieron activar los avisos.';event.currentTarget.disabled=false}}}catch(error){host.textContent='No se pudo consultar el permiso de avisos del móvil.'}
}

async function saveLast(kind,frequencyHours){
  if(!session){showAuth();return}if(!lastSearch)return;
  const label=lastSearch.label||'Mi búsqueda';const base={type:lastSearch.type,label,price:lastSearch.price,currency:lastSearch.currency||'EUR'};
  if(kind==='search')await request('account.php',{method:'POST',body:{action:'save_search',filters:lastSearch.query,...base}});
  else {
    const bar=document.querySelector('#searchActions'),mode=lastSearch.type==='destination'?(bar?.querySelector('[name=alertMode]')?.value==='threshold'?'threshold':'lower'):undefined,threshold=mode==='threshold'?Number(bar?.querySelector('[name=targetPrice]')?.value):undefined;
    const scope=lastSearch.type==='destination'?(bar?.querySelector('[data-alert-scope]')?.value||'flight'):undefined;
    const plan=lastSearch.query?.plans?.[0];
    if(scope==='plan'&&plan)base.label=`${label} · ${plan.hotel?.name||'hotel'}`;
    const expiresDate=bar?.querySelector('[data-alert-expiry]')?.value;
    await request('account.php',{method:'POST',body:{action:'create_alert',query:lastSearch.query,frequencyHours,expiresDate,alertMode:mode,alertScope:scope,threshold,conditions:readConditions(bar),...base,price:scope==='plan'&&plan?plan.total:base.price}});
  }
  await showAccount(kind==='alert'?'alerts':'searches');
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
  const hasPlan=destination&&Array.isArray(detail.query?.plans)&&detail.query.plans.length>0;
  const hint=destination?(hasPlan?'Puedes seguir el subtotal del plan seleccionado o solo el vuelo. Se volverán a comprobar antes de avisarte.':'La alerta de vuelo necesita completar todas las fechas para establecer una referencia comparable.'):'Guarda la búsqueda o elige cuándo quieres recibir un aviso de precio.';
  bar.innerHTML=`<button type="button" class="search-actions-toggle" data-toggle-actions aria-expanded="false">Guardar plan o crear alerta ↑</button><span><strong>${esc(detail.label||'Búsqueda lista')}</strong><small>${esc(hint)}</small></span><button data-save-search>Guardar búsqueda</button>${hasPlan?'<label>Seguir <select data-alert-scope><option value="plan" selected>vuelo + este hotel</option><option value="flight">solo vuelo</option></select></label>':''}<label>Comprobar cada <select data-alert-frequency>${frequencyOptions(24)}</select></label><label>Caduca el <input data-alert-expiry type="date" min="${new Date().toISOString().slice(0,10)}" value="${defaultExpiry()}" required></label>${conditionFields({mode:'lower',currency:detail.currency})}<button data-create-alert>Crear alerta</button><button class="account-close" data-close-actions>×</button>`;
  bar.classList.remove('is-expanded');
  wireConditions(bar);
  bar.querySelector('[data-toggle-actions]').onclick=()=>{const expanded=bar.classList.toggle('is-expanded');bar.querySelector('[data-toggle-actions]').setAttribute('aria-expanded',String(expanded))};
  bar.querySelector('[data-save-search]').onclick=()=>saveLast('search');
  bar.querySelector('[data-create-alert]').onclick=()=>{if(!bar.querySelector('[data-alert-expiry]').reportValidity())return;if([...bar.querySelectorAll('input')].some(input=>!input.reportValidity()))return;saveLast('alert',Number(bar.querySelector('[data-alert-frequency]').value)).catch(error=>alert(error.message))};
  bar.querySelector('[data-alert-mode]')?.addEventListener('change',event=>{const wrap=bar.querySelector('[data-threshold-wrap]');if(wrap)wrap.hidden=event.target.value!=='threshold'});
  bar.querySelector('[data-close-actions]').onclick=()=>bar.remove();
}

async function showAdmin(){if(session?.role!=='admin')return;const data=await request('admin-users.php');const panel=document.querySelector('#accountPanel');panel.hidden=false;panel.innerHTML=`<div class="account-panel-head"><div><span class="eyebrow">Administración</span><h2>Usuarios</h2><p>${data.users.length} cuentas</p></div><button class="account-close" data-close-panel>×</button></div><label class="admin-setting"><input type="checkbox" data-registration ${data.settings.publicRegistration?'checked':''}> Permitir registro público</label><form class="admin-create"><input type="email" name="email" placeholder="Correo" required><input name="displayName" placeholder="Nombre"><input type="password" name="password" minlength="10" placeholder="Contraseña inicial" required><button class="primary">Crear usuario</button></form><div>${data.users.map(user=>`<article class="account-item"><span class="account-item-icon">${user.role==='admin'?'◆':'●'}</span><div><strong>${esc(user.display_name||user.email)}</strong><small>${esc(user.email)} · ${esc(user.status)} · ${user.active_alerts} alertas</small></div>${Number(user.id)!==Number(session.id)?`<button class="danger" data-admin-delete="${user.id}">Eliminar</button>`:''}</article>`).join('')}</div>`;panel.querySelector('[data-close-panel]').onclick=()=>panel.hidden=true;panel.querySelector('[data-registration]').onchange=e=>request('admin-users.php',{method:'POST',body:{action:'settings',publicRegistration:e.target.checked}});panel.querySelector('.admin-create').onsubmit=async e=>{e.preventDefault();await request('admin-users.php',{method:'POST',body:{action:'create',...Object.fromEntries(new FormData(e.currentTarget))}});await showAdmin()};panel.querySelectorAll('[data-admin-delete]').forEach(b=>b.onclick=async()=>{if(confirm('¿Eliminar este usuario y todos sus datos?')){await request('admin-users.php',{method:'POST',body:{action:'delete',id:Number(b.dataset.adminDelete)}});await showAdmin()}})}

async function showAdminV2(){
  if(session?.role!=='admin')return;
  const data=await request('admin-users.php'),panel=document.querySelector('#accountPanel');panel.hidden=false;
  panel.innerHTML=`<div class="account-panel-head"><div><span class="eyebrow">Administración</span><h2>Usuarios</h2><p>${data.users.length} cuentas · máximo ${data.settings.maxAlerts} alertas por usuario</p></div><button class="account-close" data-close-panel>×</button></div><label class="admin-setting"><input type="checkbox" data-registration ${data.settings.publicRegistration?'checked':''}> Permitir registro público</label><form class="admin-create"><input type="email" name="email" placeholder="Correo" required><input name="displayName" placeholder="Nombre"><input type="password" name="password" minlength="10" placeholder="Contraseña inicial" required><button class="primary">Crear usuario</button></form><div>${data.users.map(user=>`<article class="account-item admin-user" data-user-id="${user.id}"><span class="account-item-icon">${user.role==='admin'?'◆':'●'}</span><div><strong>${esc(user.display_name||user.email)}</strong><small>${esc(user.email)} · ${user.active_alerts} alertas</small><span><select data-user-role ${Number(user.id)===Number(session.id)?'disabled':''}><option value="user" ${user.role==='user'?'selected':''}>Usuario</option><option value="admin" ${user.role==='admin'?'selected':''}>Administrador</option></select><select data-user-status ${Number(user.id)===Number(session.id)?'disabled':''}><option value="active" ${user.status==='active'?'selected':''}>Activo</option><option value="blocked" ${user.status==='blocked'?'selected':''}>Bloqueado</option></select></span></div>${Number(user.id)!==Number(session.id)?'<div><button class="ghost" data-admin-save>Guardar</button><button class="danger" data-admin-delete>Eliminar</button></div>':''}</article>`).join('')}</div>`;
  const health=data.alertsHealth||{};
  const cronAge=health.lastRunAt?(Date.now()/1000-Number(health.lastRunAt)):Infinity;
  const cronStatus=!health.enabled?'alertas pausadas':!Number.isFinite(cronAge)?'sin ejecución registrada':cronAge>7200?'sin ejecución reciente':'ejecución reciente registrada';
  panel.querySelector('.account-panel-head').insertAdjacentHTML('afterend',`<div class="admin-metrics"><span><strong>${data.usage.flightCalls}/${data.usage.flightLimit}</strong>consultas de vuelo</span><span><strong>${data.usage.activeAlerts}</strong>alertas activas</span><span><strong>${data.usage.emailsSent}/${data.usage.emailsAttempted}</strong>correos aceptados por el servidor</span></div><p class="admin-alert-health">Alertas: ${esc(cronStatus)} · última ejecución ${dateTime(health.lastRunAt)} · ${Number(health.overdueAlerts)||0} revisiones pendientes vencidas.${health.cronConfigured?'':' La ejecución web no está configurada; el cron puede ejecutarse mediante PHP CLI.'} Los correos aceptados pueden no haber llegado al buzón.</p><a class="admin-provider-link" href="./admin/">Configurar proveedores y límites →</a>`);
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
  }syncHeader();
  if(session)await syncNativeAlerts(token,session.id).catch(()=>{});
  else if(!token)await disableNativeAlerts().catch(()=>{});
  await watchNativeAlertOpens(async detail=>{
    if(!session||Number(detail.userId)!==Number(session.id))return;
    try{const data=await request('account.php');const own=data.alerts.find(item=>Number(item.id)===Number(detail.alertId));if(!own)return;await showAccount('alerts');const button=document.querySelector(`[data-alert-history="${Number(own.id)}"]`);button?.click();button?.closest('article')?.scrollIntoView({block:'center',behavior:'smooth'})}catch(error){await showAccount('alerts')}
  }).catch(()=>{});
  if(new URLSearchParams(location.search).has('reset'))showAuth();
}
