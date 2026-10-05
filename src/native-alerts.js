const plugin=()=>globalThis.Capacitor?.Plugins?.RumbivaAlerts;
export const nativeAlertsAvailable=()=>Boolean(globalThis.Capacitor?.isNativePlatform?.()&&plugin());
export async function nativeAlertsStatus(){return nativeAlertsAvailable()?plugin().status():{enabled:false,permission:false};}
export async function enableNativeAlerts(token,userId){
  if(!nativeAlertsAvailable())return {enabled:false,permission:false};
  const granted=await plugin().requestNotificationPermission();
  if(!granted.permission)throw new Error('Android no ha permitido las notificaciones. Puedes activarlas en Ajustes de la aplicación.');
  return plugin().configure({token,userId:Number(userId)});
}
export async function syncNativeAlerts(token,userId){
  if(!nativeAlertsAvailable())return;
  const state=await plugin().status();
  if(!state.enabled)return;
  if(!token||!userId||!state.permission||Number(state.userId)!==Number(userId)){await plugin().disable();return;}
  return plugin().configure({token,userId:Number(userId)});
}
export async function disableNativeAlerts(){if(nativeAlertsAvailable())return plugin().disable();}
export async function watchNativeAlertOpens(callback){
  if(!nativeAlertsAvailable())return ()=>{};
  const seen=new Set();
  const deliver=async detail=>{
    const alertId=Number(detail?.alertId),userId=Number(detail?.userId);
    if(!Number.isSafeInteger(alertId)||alertId<1||!Number.isSafeInteger(userId)||userId<1)return;
    const key=`${userId}:${alertId}`;
    if(seen.has(key))return;
    seen.add(key);queueMicrotask(()=>seen.delete(key));
    callback({alertId,userId});
  };
  const listener=await plugin().addListener('alertOpened',async()=>deliver(await plugin().consumeOpen()));
  await deliver(await plugin().consumeOpen());
  return ()=>listener.remove();
}

export async function watchNativeSearchLinks(callback){
  const links=globalThis.Capacitor?.Plugins?.RumbivaLinks;
  if(!globalThis.Capacitor?.isNativePlatform?.()||!links)return ()=>{};
  const deliver=detail=>{
    const alertId=Number(detail?.alertId);
    if(Number.isSafeInteger(alertId)&&alertId>0)callback({alertId});
  };
  const listener=await links.addListener('linkOpened',async()=>deliver(await links.consumeLink()));
  await deliver(await links.consumeLink());
  return ()=>listener.remove();
}
