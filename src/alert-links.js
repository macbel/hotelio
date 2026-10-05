const pendingKey='rumbiva-pending-alert';
export function validAlertId(value){return /^[1-9]\d*$/.test(String(value??''))&&Number.isSafeInteger(Number(value))?Number(value):null;}
export function alertIdFromUrl(value){
  try{const url=new URL(value);const ids=[...url.searchParams.getAll('alertId'),...url.searchParams.getAll('alert')];return ids.length===1?validAlertId(ids[0]):null;}catch{return null;}
}
export function rememberAlert(id,storage=sessionStorage){id=validAlertId(id);if(id)storage.setItem(pendingKey,String(id));return id;}
export function pendingAlert(storage=sessionStorage){return validAlertId(storage.getItem(pendingKey));}
export function forgetAlert(storage=sessionStorage){storage.removeItem(pendingKey);}
