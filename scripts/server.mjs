import {createServer} from 'node:http';
import {readFile, stat} from 'node:fs/promises';
import {extname, join, resolve, sep} from 'node:path';
import {monetizeStay22Url, STAY22_AID} from './stay22.mjs';

const root = resolve(process.argv[2] || '.');
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.webmanifest':'application/manifest+json','.svg':'image/svg+xml'};
const configuredProviders=()=>[
  {id:'stay22',name:'Stay22',enabled:true,capabilities:{price:true,accommodationType:false,board:false,images:true}},
  {id:'serpapi',name:'SerpApi · Google Hotels',enabled:Boolean(process.env.HOTELIO_SERPAPI_KEY),capabilities:{price:true,accommodationType:true,board:true,images:true}}
];

const readJsonBody=request=>new Promise((resolveBody,reject)=>{let raw='';request.on('data',chunk=>{raw+=chunk;if(raw.length>100000)reject(new Error('Petición demasiado grande'))});request.on('end',()=>{try{resolveBody(JSON.parse(raw||'{}'))}catch{reject(new Error('JSON no válido'))}});request.on('error',reject)});
const sendJson=(res,status,body)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(body))};
const withinPrice=(price,query)=>(query.minPrice==null||price>=Number(query.minPrice))&&(query.maxPrice==null||price<=Number(query.maxPrice));
const accommodationMatches=(hotel,wanted)=>{
  if(!wanted||wanted==='any')return true;
  const text=`${hotel.type||''} ${hotel.name||''}`.toLowerCase();
  const patterns={hotel:/hotel/,apartment:/apartment|apartamento|aparthotel|vacation rental/,hostel:/hostel|hostal|albergue/,resort:/resort/,bed_and_breakfast:/bed.{0,5}breakfast|b&b|guesthouse|casa rural|inn/};
  return patterns[wanted]?.test(text)??true;
};
const boardQuery=(destination,board)=>({room_only:`hoteles solo alojamiento en ${destination}`,breakfast:`hoteles con desayuno incluido en ${destination}`,half_board:`hoteles con media pensión en ${destination}`,full_board:`hoteles con pensión completa en ${destination}`,all_inclusive:`hoteles todo incluido en ${destination}`}[board]||`hoteles en ${destination}`);

async function searchPublicProvider(provider,query){
  if(provider==='stay22'){
    if(query.board&&query.board!=='any')return {results:[],notice:'Stay22 no permite filtrar el régimen con fiabilidad.'};
    const endpoint=new URL('https://api.stay22.com/v2/accommodations');
    const params={address:query.destination,checkin:query.checkIn,checkout:query.checkOut,adults:String(query.adults),children:String(query.children||0),rooms:String(query.rooms||1),currency:'EUR',pageSize:'50'};
    Object.entries(params).forEach(([key,value])=>endpoint.searchParams.set(key,value));
    const response=await fetch(endpoint,{headers:{Accept:'application/json'}});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.message||data.error||`HTTP ${response.status}`);
    const supplierNames={booking:'Booking.com',expedia:'Expedia',hotelscom:'Hotels.com',vrbo:'Vrbo'};
    const nights=Number(data.meta?.nights)||query.nights;
    const results=(data.results||[]).flatMap((hotel,index)=>{
      if(!accommodationMatches(hotel,query.accommodationType))return [];
      const offers=Object.entries(hotel.suppliers||{}).map(([supplier,offer])=>({supplier,offer,total:Number(offer?.price?.total)})).filter(item=>item.total>0).sort((a,b)=>a.total-b.total);
      if(!offers.length)return [];
      const best=offers[0],nightlyPrice=best.total/nights;
      if(!withinPrice(nightlyPrice,query))return [];
      const features=[];
      if(hotel.type)features.push(hotel.type);
      if(hotel.policies?.freeCancellation)features.push('Cancelación gratis');
      if(hotel.rating?.hotelStars)features.push(`${hotel.rating.hotelStars} estrellas`);
      return [{id:`stay22-${hotel.id||index}`,name:hotel.name||'Alojamiento',location:hotel.location?.address||query.destination,nightlyPrice,totalPrice:best.total,currency:data.meta?.currency||'EUR',rating:hotel.rating?.value,features,image:hotel.media?.thumbnail||null,accommodationType:hotel.type||null,url:monetizeStay22Url(best.offer?.link||hotel.url||'',{aid:STAY22_AID}),provider:`Stay22 · ${supplierNames[best.supplier]||best.supplier}`,persistable:false}];
    });
    return {results};
  }
  if(provider!=='serpapi')throw new Error('Proveedor no compatible');
  const token=process.env.HOTELIO_SERPAPI_KEY||'';
  if(!token)throw new Error('SerpApi no está configurado en el servidor local');
  const endpoint=new URL('https://serpapi.com/search.json');
  const common={engine:'google_hotels',q:boardQuery(query.destination,query.board),check_in_date:query.checkIn,check_out_date:query.checkOut,adults:String(query.adults),children:String(query.children||0),currency:'EUR',hl:'es',gl:'es',sort_by:'3',api_key:token};
  Object.entries(common).forEach(([key,value])=>endpoint.searchParams.set(key,value));
  if(query.minPrice!=null)endpoint.searchParams.set('min_price',String(query.minPrice));
  if(query.maxPrice!=null)endpoint.searchParams.set('max_price',String(query.maxPrice));
  const propertyTypes={apartment:'1,21',hostel:'14',resort:'17',bed_and_breakfast:'19'};
  if(query.accommodationType==='apartment')endpoint.searchParams.set('vacation_rentals','true');
  if(propertyTypes[query.accommodationType])endpoint.searchParams.set('property_types',propertyTypes[query.accommodationType]);
  const ages=(query.childrenAges||[]).map(age=>Math.max(1,Number(age))).join(',');
  if(ages)endpoint.searchParams.set('children_ages',ages);
  const response=await fetch(endpoint,{headers:{Accept:'application/json'}});
  const data=await response.json().catch(()=>({}));
  if(!response.ok||data.error)throw new Error(data.error?.message||data.error||`HTTP ${response.status}`);
  const results=(data.properties||[]).flatMap((hotel,index)=>{
    if(query.accommodationType==='hotel'&&!accommodationMatches(hotel,'hotel'))return [];
    const nightlyPrice=Number(hotel.rate_per_night?.extracted_lowest??hotel.price_per_night?.extracted_price??hotel.extracted_price??0);
    if(!nightlyPrice||!withinPrice(nightlyPrice,query))return [];
    const totalPrice=Number(hotel.total_rate?.extracted_lowest??hotel.total_price?.extracted_price??nightlyPrice*query.nights);
    return [{id:hotel.property_token||`${provider}-${index}`,name:hotel.name||'Alojamiento',location:hotel.address||hotel.city||query.destination,nightlyPrice,totalPrice,currency:'EUR',rating:hotel.overall_rating??hotel.rating,features:(hotel.amenities||[]).slice(0,3),image:hotel.images?.[0]?.thumbnail||hotel.thumbnail||null,accommodationType:hotel.type||null,url:hotel.link||`https://www.google.com/travel/hotels?q=${encodeURIComponent(hotel.name||query.destination)}`,provider:'SerpApi · Google Hotels'}];
  });
  return {results};
}

createServer(async (req,res)=>{
  try {
    const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    if(req.method==='GET'&&(pathname==='/api/providers'||pathname==='/api/providers.php'))return sendJson(res,200,{providers:configuredProviders()});
    if(req.method==='POST'&&pathname.startsWith('/api/search/')){
      const provider=pathname.split('/').pop(), body=await readJsonBody(req);
      if(!body.query)return sendJson(res,400,{error:'Falta la búsqueda'});
      const configuration=configuredProviders().find(item=>item.id===provider);
      if(!configuration?.enabled)return sendJson(res,503,{error:'Proveedor no disponible'});
      return sendJson(res,200,await searchPublicProvider(provider,body.query));
    }
    let file=resolve(join(root,pathname==='/'?'index.html':pathname.slice(1)));
    if(!file.startsWith(root+sep)&&file!==root)throw new Error('Forbidden');
    if((await stat(file)).isDirectory())file=join(file,'index.html');
    if(extname(file)==='.php')throw new Error('PHP no se sirve como archivo estático');
    res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream','Cache-Control':'no-cache'});
    res.end(await readFile(file));
  }catch(error){if(req.url.startsWith('/api/'))return sendJson(res,502,{error:error.message||'Error del proveedor'});res.writeHead(404);res.end('No encontrado')}
}).listen(4173,'0.0.0.0',()=>console.log('Hotelio disponible en http://localhost:4173'));
