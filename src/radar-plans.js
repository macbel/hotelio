const round=value=>Math.round(value*100)/100;

export function rankRadarPlans(plans){
  const valid=plans.filter(plan=>Number.isFinite(Number(plan.total))&&Number(plan.total)>0);
  if(!valid.length)return [];
  const prices=valid.map(plan=>Number(plan.total)),min=Math.min(...prices),max=Math.max(...prices);
  const scored=valid.map(plan=>{
    const price=max===min?1:1-(Number(plan.total)-min)/(max-min);
    const stops=Math.max(Number(plan.stops)||0,Number(plan.returnStops)||0);
    const route=stops===0?1:stops===1?.65:0;
    const rating=Number(plan.hotel?.rating);
    const hotel=rating>0?Math.min(rating/5,1):.5;
    const departureTimes=[plan.outboundDepartureTime,plan.returnDepartureTime];
    const hours=departureTimes.map(value=>String(value||'').match(/(?:^|\s)(\d{2}):\d{2}/)?.[1]);
    const timing=hours.some(hour=>hour===undefined)?.5:hours.every(hour=>Number(hour)>=8)?1:0;
    const score=round(.55*price+.20*route+.15*hotel+.10*timing);
    return {...plan,score,scoreParts:{price:round(price),route:round(route),hotel:round(hotel),timing:round(timing)}};
  });
  const cheapest=[...scored].sort((a,b)=>a.total-b.total||String(a.departureDate).localeCompare(String(b.departureDate)))[0];
  const remaining=scored.filter(plan=>plan!==cheapest);
  const balanced=[...remaining].sort((a,b)=>b.score-a.score||a.total-b.total)[0];
  const remainingAlternative=remaining.filter(plan=>plan!==balanced);
  const alternative=[...remainingAlternative].sort((a,b)=>{
    const aDifferent=Number(a.destinationCode!==cheapest.destinationCode||a.departureDate!==cheapest.departureDate);
    const bDifferent=Number(b.destinationCode!==cheapest.destinationCode||b.departureDate!==cheapest.departureDate);
    return bDifferent-aDifferent||a.total-b.total;
  })[0];
  return [cheapest&&{...cheapest,rankLabel:'Más barato',rankReason:'Menor subtotal entre los planes con vuelo de ida y vuelta y hotel obtenidos.'},balanced&&{...balanced,rankLabel:'Mejor equilibrio',rankReason:'Puntuación: 55 % precio, 20 % escalas, 15 % valoración del hotel y 10 % horario. Se elige entre planes distintos del más barato.'},alternative&&{...alternative,rankLabel:'Alternativa',rankReason:'Otra fecha o destino para comparar; se prioriza el menor subtotal de las opciones restantes.'}].filter(Boolean);
}

export function radarShareUrl(plan,baseUrl){
  const url=new URL(baseUrl);
  if(url.protocol!=='https:'&&url.hostname!=='localhost')throw new TypeError('Solo se comparten enlaces HTTPS.');
  const payload={v:1,d:String(plan.destinationText||plan.destinationCode||'').slice(0,80),c:String(plan.destinationCode||'').slice(0,3),from:String(plan.departureDate||''),to:String(plan.returnDate||''),flight:Number(plan.flightPrice),hotel:String(plan.hotel?.name||'').slice(0,120),hotelPrice:Number(plan.hotel?.totalPrice),total:Number(plan.total),checkedAt:String(plan.checkedAt||''),hotelCheckedAt:String(plan.hotelCheckedAt||'')};
  if(!/^[A-Z]{3}$/.test(payload.c)||!/^\d{4}-\d{2}-\d{2}$/.test(payload.from)||!/^\d{4}-\d{2}-\d{2}$/.test(payload.to)||![payload.flight,payload.hotelPrice,payload.total].every(value=>Number.isFinite(value)&&value>0))throw new TypeError('El plan no contiene datos suficientes para compartir.');
  url.hash=`plan=${encodeURIComponent(JSON.stringify(payload))}`;
  return url.href;
}

export function readRadarShare(hash){
  if(!String(hash).startsWith('#plan='))return null;
  try{
    const raw=decodeURIComponent(String(hash).slice(6));
    if(raw.length>1800)return null;
    const data=JSON.parse(raw);
    if(data.v!==1||!/^[A-Z]{3}$/.test(data.c)||!/^\d{4}-\d{2}-\d{2}$/.test(data.from)||!/^\d{4}-\d{2}-\d{2}$/.test(data.to)||!['flight','hotelPrice','total'].every(key=>Number.isFinite(data[key])&&data[key]>0))return null;
    return {destination:String(data.d||data.c).slice(0,80),destinationCode:data.c,departureDate:data.from,returnDate:data.to,flightPrice:data.flight,hotelName:String(data.hotel||'').slice(0,120),hotelPrice:data.hotelPrice,total:data.total,checkedAt:String(data.checkedAt||'').slice(0,40),hotelCheckedAt:String(data.hotelCheckedAt||'').slice(0,40)};
  }catch{return null}
}
