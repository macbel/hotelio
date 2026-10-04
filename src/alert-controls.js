const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function alertConditions(item={}){
  const query=item.query||{};
  return item.conditions||{mode:query._alertMode||(item.type==='destination'?'lower':'change'),targetPrice:query._threshold||null,minDropPercent:0,notifyCooldownHours:0};
}
export function conditionFields(conditions={}){
  const mode=conditions.mode||'lower';
  return `<label>Avisarme cuando<select name="alertMode">${[['lower','Baje el precio'],['threshold','Llegue al precio objetivo'],['percent','Baje un porcentaje mínimo'],['change','Cambie el precio']].map(([value,label])=>`<option value="${value}" ${mode===value?'selected':''}>${label}</option>`).join('')}</select></label><label data-condition-target ${mode==='threshold'?'':'hidden'}>Precio objetivo (${esc(conditions.currency||'EUR')})<input name="targetPrice" type="number" min="0.01" step="0.01" value="${esc(conditions.targetPrice||'')}"></label><label data-condition-percent ${mode==='percent'?'':'hidden'}>Bajada mínima (%)<input name="minDropPercent" type="number" min="0.01" max="100" step="0.01" value="${esc(conditions.minDropPercent||'')}"></label><label>Límite entre avisos<select name="notifyCooldownHours">${[[0,'Sin límite adicional'],[12,'Al menos 12 horas'],[24,'Al menos un día'],[72,'Al menos 3 días'],[168,'Al menos una semana']].map(([value,label])=>`<option value="${value}" ${Number(conditions.notifyCooldownHours||0)===value?'selected':''}>${label}</option>`).join('')}</select></label>`;
}
export function wireConditions(root){
  const select=root.querySelector('[name=alertMode]');
  const sync=()=>{for(const [mode,selector,name] of [['threshold','[data-condition-target]','targetPrice'],['percent','[data-condition-percent]','minDropPercent']]){const label=root.querySelector(selector),input=root.querySelector(`[name=${name}]`);if(label)label.hidden=select.value!==mode;if(input){input.required=select.value===mode;input.disabled=select.value!==mode}}};
  select?.addEventListener('change',sync);if(select)sync();
}
export function readConditions(root){
  const mode=root.querySelector('[name=alertMode]').value;
  return {mode,targetPrice:mode==='threshold'?Number(root.querySelector('[name=targetPrice]').value):null,minDropPercent:mode==='percent'?Number(root.querySelector('[name=minDropPercent]').value):null,notifyCooldownHours:Number(root.querySelector('[name=notifyCooldownHours]').value)};
}
export function conditionsLabel(item){
  const c=alertConditions(item),money=new Intl.NumberFormat('es-ES',{style:'currency',currency:item.currency||'EUR'});
  const label=c.mode==='threshold'?`Objetivo: ${money.format(c.targetPrice)}`:c.mode==='percent'?`Bajada mínima: ${c.minDropPercent} % desde la referencia de aviso`:c.mode==='change'?'Avisar de cualquier cambio':'Avisar cuando baje';
  return `${label}${Number(c.notifyCooldownHours)>0?` · avisos separados al menos ${c.notifyCooldownHours} h`:''}`;
}
export function historyMarkup(entries=[]){
  if(!entries.length)return '<p class="account-empty">El historial se registrará a partir de las próximas comprobaciones.</p>';
  const labels={initial:'Referencia inicial',checked:'Precio comprobado',unchanged:'Sin cambio de precio',condition_not_met:'No se cumple la condición',sent:'Correo aceptado por el servidor',mail_failed:'Correo pendiente de reintento',mail_pending:'Envío de correo en curso',mail_unknown:'Resultado del envío sin confirmar',error:'Consulta fallida',needs_reconfiguration:'Requiere configurar la alerta',notify_pending:'Aviso aplazado por el límite de frecuencia',cooldown:'Aviso aplazado por el límite de frecuencia',notified:'Aviso registrado'};
  const money=(amount,currency='EUR')=>new Intl.NumberFormat('es-ES',{style:'currency',currency}).format(amount);
  return `<ol class="alert-history-list">${entries.map(entry=>{const price=entry.price==null?'Sin precio comparable':new Intl.NumberFormat('es-ES',{style:'currency',currency:entry.currency||'EUR'}).format(entry.price);return `<li><time>${esc(new Intl.DateTimeFormat('es-ES',{dateStyle:'short',timeStyle:'short'}).format(new Date(Number(entry.checked_at??entry.checkedAt)*1000)))}</time><strong>${esc(price)}</strong><span>${esc(labels[entry.status]||'Comprobación registrada')}</span>${entry.price!=null&&Number(entry.oldPrice)>0?`<small>Antes ${esc(money(entry.oldPrice,entry.currency))} · variación ${esc(money(Number(entry.price)-Number(entry.oldPrice),entry.currency))} (${((Number(entry.price)-Number(entry.oldPrice))*100/Number(entry.oldPrice)).toFixed(1).replace('.',',')} %)</small>`:''}${entry.referencePrice!=null&&Number(entry.referencePrice)!==Number(entry.oldPrice)?`<small>Referencia de aviso: ${esc(money(entry.referencePrice,entry.currency))}</small>`:''}${entry.direction&&entry.direction!=='initial'?`<small>${esc({up:'Ha subido',down:'Ha bajado',same:'Sin cambio'}[entry.direction]||'')}</small>`:''}${entry.mailStatus==='accepted'?'<small>Correo aceptado por el servidor; recepción sin confirmar.</small>':''}${entry.reason||entry.error?`<small>${esc(entry.reason||entry.error)}</small>`:''}</li>`}).join('')}</ol>`;
}
