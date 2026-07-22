import {createServer} from 'node:http';
import {readFile, stat} from 'node:fs/promises';
import {extname, join, resolve, sep} from 'node:path';
import {monetizeStay22Url, STAY22_AID} from './stay22.mjs';

const root = resolve(process.argv[2] || '.');
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.webmanifest':'application/manifest+json','.svg':'image/svg+xml'};

const readJsonBody=request=>new Promise((resolveBody,reject)=>{let raw='';request.on('data',chunk=>{raw+=chunk;if(raw.length>100000)reject(new Error('Petición demasiado grande'))});request.on('end',()=>{try{resolveBody(JSON.parse(raw||'{}'))}catch{reject(new Error('JSON no válido'))}});request.on('error',reject)});
const sendJson=(res,status,body)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(body))};

async function searchPublicProvider(provider,credentials,query){
  if(provider==='stay22'){
    const endpoint=new URL('https://api.stay22.com/v2/accommodations');
    const params={address:query.destination,checkin:query.checkIn,checkout:query.checkOut,adults:String(query.adults),children:String(query.children||0),rooms:String(query.rooms||1),currency:'EUR',pageSize:'50'};
    Object.entries(params).forEach(([key,value])=>endpoint.searchParams.set(key,value));
    const response=await fetch(endpoint,{headers:{Accept:'application/json'}});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.message||data.error||`HTTP ${response.status}`);
    const supplierNames={booking:'Booking.com',expedia:'Expedia',hotelscom:'Hotels.com',vrbo:'Vrbo'};
    const nights=Number(data.meta?.nights)||query.nights;
    return (data.results||[]).flatMap((hotel,index)=>{
      const offers=Object.entries(hotel.suppliers||{}).map(([supplier,offer])=>({supplier,offer,total:Number(offer?.price?.total)})).filter(item=>item.total>0).sort((a,b)=>a.total-b.total);
      if(!offers.length)return [];
      const best=offers[0],features=[];
      if(hotel.type)features.push(hotel.type);
      if(hotel.policies?.freeCancellation)features.push('Cancelación gratis');
      if(hotel.rating?.hotelStars)features.push(`${hotel.rating.hotelStars} estrellas`);
      return [{id:`stay22-${hotel.id||index}`,name:hotel.name||'Alojamiento',location:hotel.location?.address||query.destination,nightlyPrice:best.total/nights,totalPrice:best.total,currency:data.meta?.currency||'EUR',rating:hotel.rating?.value,features,url:monetizeStay22Url(best.offer?.link||hotel.url||'',{aid:STAY22_AID}),provider:`Stay22 · ${supplierNames[best.supplier]||best.supplier}`,persistable:false}];
    });
  }
  const common={engine:'google_hotels',q:`hoteles en ${query.destination}`,check_in_date:query.checkIn,check_out_date:query.checkOut,adults:String(query.adults),currency:'EUR',hl:'es',gl:'es'};
  const ages=(query.childrenAges||[]).map(age=>Math.max(1,Number(age))).join(',');
  let endpoint;
  if(provider==='serpapi') endpoint=new URL('https://serpapi.com/search.json');
  else throw new Error('Proveedor no compatible');
  Object.entries(common).forEach(([key,value])=>endpoint.searchParams.set(key,value));
  endpoint.searchParams.set('api_key',credentials.token);
  if(provider==='serpapi'){
    endpoint.searchParams.set('children',String(query.children||0));
    endpoint.searchParams.set('min_price',String(query.minPrice||0));
    endpoint.searchParams.set('max_price',String(query.maxPrice||10000));
    endpoint.searchParams.set('sort_by','3');
  }
  if(ages) endpoint.searchParams.set('children_ages',ages);
  const response=await fetch(endpoint,{headers:{Accept:'application/json'}});
  const data=await response.json().catch(()=>({}));
  if(!response.ok||data.error) throw new Error(data.error?.message||data.error||`HTTP ${response.status}`);
  const properties=data.properties||[];
  return properties.map((hotel,index)=>{
    const nightly=Number(hotel.rate_per_night?.extracted_lowest??hotel.price_per_night?.extracted_price??hotel.extracted_price??0);
    const total=Number(hotel.total_rate?.extracted_lowest??hotel.total_price?.extracted_price??nightly*query.nights);
    return {id:hotel.property_token||`${provider}-${index}`,name:hotel.name||'Alojamiento',location:hotel.city||query.destination,nightlyPrice:nightly,totalPrice:total,currency:'EUR',rating:hotel.overall_rating??hotel.rating,features:(hotel.amenities||[]).slice(0,3),url:hotel.link||`https://www.google.com/travel/hotels?q=${encodeURIComponent(hotel.name||query.destination)}`};
  }).filter(hotel=>hotel.nightlyPrice>0);
}

createServer(async (req,res)=>{
  try {
    const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    if(req.method==='POST'&&pathname.startsWith('/api/search/')){
      const provider=pathname.split('/').pop(), body=await readJsonBody(req);
      if(!body.query||(!body.token&&provider!=='stay22')) return sendJson(res,400,{error:'Falta la API key o la búsqueda'});
      const results=await searchPublicProvider(provider,{token:body.token||'',aid:body.aid||''},body.query);
      return sendJson(res,200,{results});
    }
    let file=resolve(join(root,pathname==='/'?'index.html':pathname.slice(1)));
    if(!file.startsWith(root+sep)&&file!==root) throw new Error('Forbidden');
    if((await stat(file)).isDirectory()) file=join(file,'index.html');
    res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream','Cache-Control':'no-cache'});
    res.end(await readFile(file));
  } catch(error) { if(req.url.startsWith('/api/')) return sendJson(res,502,{error:error.message||'Error del proveedor'});res.writeHead(404);res.end('No encontrado'); }
}).listen(4173,'0.0.0.0',()=>console.log('Hotelio disponible en http://localhost:4173'));
