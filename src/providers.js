export const DEMO_ID = 'demo';

const hash = text => [...text].reduce((n, c) => (n * 31 + c.charCodeAt(0)) % 997, 17);

export async function searchDemo(query) {
  await new Promise(resolve => setTimeout(resolve, 900));
  const seed = hash(query.destination + query.checkIn);
  const names = ['Casa Lumen', 'Hotel Nómada', 'La Brisa Rooms', 'Patio Central', 'Mirador del Mar', 'The Green Stay'];
  return names.map((name, index) => {
    const nightlyPrice = 38 + ((seed + index * 19) % 95);
    return {
      id: `demo-${index}`,
      name,
      location: query.destination,
      nightlyPrice,
      totalPrice: nightlyPrice * query.nights,
      currency: 'EUR',
      rating: (7.3 + ((seed + index) % 20) / 10).toFixed(1),
      provider: 'Resultados demo',
      features: index % 2 ? ['Cancelación gratis', 'Buena ubicación'] : ['Desayuno opcional', 'Wifi'],
      url: `https://www.google.com/travel/hotels?q=${encodeURIComponent(name + ' ' + query.destination)}`
    };
  });
}

export async function searchHttpProvider(provider, query) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(provider.endpoint, {
      method: 'POST',
      headers: {'Content-Type': 'application/json', ...(provider.apiKey ? {'Authorization': `Bearer ${provider.apiKey}`} : {})},
      body: JSON.stringify(query),
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`${provider.name}: HTTP ${response.status}`);
    const body = await response.json();
    if (!Array.isArray(body.results)) throw new Error(`${provider.name}: respuesta no válida`);
    return body.results.map((item, i) => ({...item, id: item.id || `${provider.id}-${i}`, provider: provider.name}));
  } finally { clearTimeout(timeout); }
}

export async function searchPublicProvider(provider, credentials, query) {
  const native=Boolean(globalThis.Capacitor?.isNativePlatform?.());
  const local=!native&&['localhost','127.0.0.1'].includes(location.hostname);
  const providerId=encodeURIComponent(provider.id);
  const endpoint=native
    ? `https://www.alufi.es/hotelio/api/search.php?provider=${providerId}`
    : local?`/api/search/${providerId}`:new URL(`./api/search.php?provider=${providerId}`,location.href).href;
  const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:credentials?.token||'',aid:credentials?.aid||'',query})});
  const body=await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(`${provider.name}: ${body.error||`HTTP ${response.status}`}`);
  return (body.results||[]).map(item=>({...item,provider:item.provider||provider.name}));
}
