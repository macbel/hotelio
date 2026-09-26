import {cp, mkdir, readFile, readdir, rm, writeFile} from 'node:fs/promises';

await rm('dist',{recursive:true,force:true});
await mkdir('dist/src',{recursive:true});
await cp('public','dist',{recursive:true});
for(const file of await readdir('dist/downloads').catch(()=>[])){
  if(file.toLowerCase().endsWith('.apk'))await rm(`dist/downloads/${file}`);
}
await cp('src','dist/src',{recursive:true});
let html=await readFile('index.html','utf8');
await writeFile('dist/index.html',html);
console.log('Producción generada en dist/');
