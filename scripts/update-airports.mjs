import {mkdir,writeFile} from 'node:fs/promises';

const SOURCE='https://davidmegginson.github.io/ourairports-data/airports.csv';

function parseCsv(text){
  const rows=[];let row=[],field='',quoted=false;
  for(let index=0;index<text.length;index++){
    const character=text[index];
    if(quoted){
      if(character==='"'&&text[index+1]==='"'){field+='"';index++}
      else if(character==='"')quoted=false;
      else field+=character;
    }else if(character==='"')quoted=true;
    else if(character===','){row.push(field);field=''}
    else if(character==='\n'){row.push(field.replace(/\r$/,''));rows.push(row);row=[];field=''}
    else field+=character;
  }
  if(field||row.length){row.push(field);rows.push(row)}
  return rows;
}

const response=await fetch(SOURCE);
if(!response.ok)throw new Error(`OurAirports respondió HTTP ${response.status}`);
const rows=parseCsv(await response.text()),headers=rows.shift();
const index=Object.fromEntries(headers.map((header,position)=>[header,position]));
const priority={large_airport:0,medium_airport:1,small_airport:2};
const candidates=rows.flatMap(row=>{
  const iata=(row[index.iata_code]||'').trim().toUpperCase(),type=row[index.type]||'';
  if(!/^[A-Z]{3}$/.test(iata)||row[index.scheduled_service]!=='yes'||!(type in priority))return [];
  return [{iata,name:row[index.name]||iata,city:row[index.municipality]||'',country:row[index.iso_country]||'',type,priority:priority[type]}];
}).sort((a,b)=>a.priority-b.priority||a.iata.localeCompare(b.iata));
const unique=new Map();
for(const airport of candidates)if(!unique.has(airport.iata))unique.set(airport.iata,airport);
const airports=[...unique.values()].map(({priority:ignored,...airport})=>airport).sort((a,b)=>(a.city||a.name).localeCompare(b.city||b.name,'es'));
const payload={source:SOURCE,license:'Public Domain',updatedAt:new Date().toISOString(),airports};
await mkdir('public/data',{recursive:true});
await writeFile('public/data/airports.json',JSON.stringify(payload));
console.log(`Aeropuertos generados: ${airports.length}`);
