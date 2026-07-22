function apiEndpoint(file, localPath) {
  const native=Boolean(globalThis.Capacitor?.isNativePlatform?.());
  const local=!native&&['localhost','127.0.0.1'].includes(location.hostname);
  if(native)return `https://www.alufi.es/hotelio/api/${file}`;
  if(local)return localPath;
  return new URL(`./api/${file}`,location.href).href;
}

export async function loadProviderConfiguration() {
  const response=await fetch(apiEndpoint('providers.php','/api/providers'),{headers:{Accept:'application/json'},cache:'no-store'});
  const body=await response.json().catch(()=>({}));
  if(!response.ok||!Array.isArray(body.providers))throw new Error('No se pudo cargar la configuración de proveedores');
  return body.providers;
}

export async function searchPublicProvider(provider, query) {
  const providerId=encodeURIComponent(provider.id);
  const endpoint=apiEndpoint(`search.php?provider=${providerId}`,`/api/search/${providerId}`);
  const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query})});
  const body=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(`${provider.name}: ${body.error||`HTTP ${response.status}`}`);
  return {results:(body.results||[]).map(item=>({...item,provider:item.provider||provider.name})),notice:body.notice||''};
}
