import {spawn} from 'node:child_process';
import {appendFile, mkdtemp, readFile, rm, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

const ENDPOINT='https://www.alufi.es/vuelotel/api/alerts-run.php';
const WAITS=[5000,15000];

export function curlRequest(secret,output,environment=process.env){
  if(typeof secret!=='string'||!secret.trim()||/[\x00-\x1f\x7f]/.test(secret))throw new Error('invalid-secret');
  const env={...environment};
  delete env.ALERTS_CRON_SECRET;
  return {args:['--disable','--config','-','--ipv4','--silent','--show-error','--fail',
    '--connect-timeout','20','--max-time','300','--output',output,
    '--write-out','%{http_code}\n%{time_connect}',ENDPOINT],
    input:`header = ${JSON.stringify(`X-Vuelotel-Cron: ${secret}`)}\n`,env};
}

export async function curlTransport(secret){
  const directory=await mkdtemp(join(tmpdir(),'rumbiva-alerts-'));
  try{
    const output=join(directory,'response.json');
    const request=curlRequest(secret,output);
    const result=await new Promise(resolve=>{
      const child=spawn(process.platform==='win32'?'curl.exe':'curl',request.args,{env:request.env,stdio:['pipe','pipe','pipe']});
      let metrics='';
      child.stdout.on('data',chunk=>{if(metrics.length<2048)metrics+=chunk.toString();});
      // Never print curl stderr: an external response may contain sensitive text.
      child.stderr.resume();
      child.stdin.on('error',()=>{});
      child.on('error',()=>resolve({exitCode:-1,httpCode:'',timeConnect:NaN}));
      child.on('close',code=>{
        const [httpCode,time]=metrics.trim().split(/\r?\n/);
        resolve({exitCode:code,httpCode,timeConnect:Number(time)});
      });
      child.stdin.end(request.input);
    });
    let body='';
    if(result.exitCode===0){
      const size=await stat(output).then(info=>info.size).catch(()=>Infinity);
      if(size<=1048576)body=await readFile(output,'utf8');
    }
    return {...result,body};
  }finally{await rm(directory,{recursive:true,force:true});}
}

export function retryable(result){
  return [6,7,28].includes(result.exitCode)&&result.httpCode==='000'&&result.timeConnect===0;
}

export function workflowSucceeded(primaryStatus,primaryOutcome,fallbackStatus,fallbackOutcome){
  return primaryStatus==='success'&&((primaryOutcome==='ok'&&fallbackStatus==='skipped')
    ||(primaryOutcome==='preconnect_failed'&&fallbackStatus==='success'&&fallbackOutcome==='ok'));
}

export async function runAlerts({secret,transport=curlTransport,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),log=console.log,
    report=async()=>{},diagnosticFailover=false}={}){
  const finish=async(code,outcome)=>{await report(outcome);return code;};
  if(diagnosticFailover){log('::warning::Diagnóstico de failover: se omite la petición primaria, sin procesar alertas.');return finish(1,'preconnect_failed');}
  try{curlRequest(secret,'validation-only');}catch{
    log('::error::Falta un secreto de alertas válido.');return finish(1,'failed');
  }
  for(let attempt=0;attempt<3;attempt++){
    let result;
    try{result=await transport(secret);}catch{log('::error::Fallo del transporte de alertas.');return finish(1,'failed');}
    if(result.exitCode!==0){
      const safeCategory=retryable(result)?'conexión no establecida':result.exitCode===22?'respuesta HTTP fallida':'fallo de transporte sin reintento';
      if(retryable(result)&&attempt<2){
        log(`::warning::Alertas: ${safeCategory}; reintento ${attempt+2}/3.`);
        await sleep(WAITS[attempt]);continue;
      }
      const code=Number.isInteger(result.exitCode)?result.exitCode:-1;
      const http=/^\d{3}$/.test(result.httpCode)?result.httpCode:'desconocido';
      log(`::error::Alertas: ${safeCategory}; curl ${code}, HTTP ${http}.`);return finish(1,retryable(result)?'preconnect_failed':'failed');
    }
    if(!/^2\d\d$/.test(result.httpCode)){log('::error::Respuesta HTTP inesperada.');return finish(1,'failed');}
    let data;
    try{data=JSON.parse(result.body);}catch{log('::error::Respuesta JSON no válida.');return finish(1,'failed');}
    if(!data||Array.isArray(data)||!Number.isInteger(data.processed)||data.processed<0
        ||(Object.hasOwn(data,'errors')?!Array.isArray(data.errors):!(data.processed===0&&typeof data.message==='string'))
        ||(data.changes!==undefined&&(!Number.isInteger(data.changes)||data.changes<0))){
      log('::error::Respuesta del procesador no válida.');return finish(1,'failed');
    }
    const errors=data.errors??[];
    log(JSON.stringify({processed:data.processed,changes:data.changes??0,errorCount:errors.length}));
    if(errors.length){log('::error::Una o varias alertas fallaron; consulta su estado en Rumbiva.');return finish(1,'failed');}
    return finish(0,'ok');
  }
  return finish(1,'failed');
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  if(process.argv.includes('--verify-workflow')){
    const ok=workflowSucceeded(process.env.PRIMARY_STATUS,process.env.PRIMARY_OUTCOME,process.env.FALLBACK_STATUS,process.env.FALLBACK_OUTCOME);
    console.log(ok?'Revisión de alertas completada.':'::error::La revisión de alertas no terminó correctamente.');process.exitCode=ok?0:1;
  }else{
    try{
      process.exitCode=await runAlerts({secret:process.env.ALERTS_CRON_SECRET,diagnosticFailover:process.env.DIAGNOSTIC_FAILOVER==='true',
        report:async outcome=>{if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,`result=${outcome}\n`);}});
    }catch{console.log('::error::No se pudo registrar el resultado de alertas.');process.exitCode=1;}
  }
}
