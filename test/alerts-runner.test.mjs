import {test} from 'node:test';
import assert from 'node:assert/strict';
import {curlRequest,retryable,runAlerts,workflowSucceeded} from '../scripts/run-alerts.mjs';

const secret='test-private-secret';
const success={exitCode:0,httpCode:'200',timeConnect:.1,body:JSON.stringify({processed:2,changes:1,errors:[]})};
const noConnection=code=>({exitCode:code,httpCode:'000',timeConnect:0,body:''});
async function simulate(responses){
  let calls=0;const waits=[],logs=[];
  const status=await runAlerts({secret,transport:async()=>responses[calls++],sleep:async ms=>waits.push(ms),log:line=>logs.push(line)});
  return {status,calls,waits,logs};
}

test('retries only connection failures before any HTTP processing, then succeeds',async()=>{
  const result=await simulate([noConnection(28),noConnection(7),success]);
  assert.equal(result.status,0);assert.equal(result.calls,3);assert.deepEqual(result.waits,[5000,15000]);
  assert.match(result.logs.at(-1),/"processed":2/);
  assert.equal(retryable(noConnection(6)),true);
});
test('three connection failures remain visible and fail the workflow',async()=>{
  const result=await simulate([noConnection(28),noConnection(28),noConnection(28)]);
  assert.equal(result.status,1);assert.equal(result.calls,3);assert.match(result.logs.at(-1),/^::error::/);
});
test('never retries a timeout after TCP connected or after HTTP response',async()=>{
  for(const failure of [{...noConnection(28),timeConnect:.01},{...noConnection(28),httpCode:'200'},
      {...noConnection(28),timeConnect:NaN},{...noConnection(28),timeConnect:undefined},
      {...noConnection(28),httpCode:''},noConnection(35)]){
    const result=await simulate([failure,success]);
    assert.equal(result.status,1);assert.equal(result.calls,1);assert.deepEqual(result.waits,[]);
  }
});
test('HTTP failures and processor errors never retry side effects',async()=>{
  for(const httpCode of ['401','403','429','500','503']){
    const result=await simulate([{exitCode:22,httpCode,timeConnect:.1},success]);
    assert.equal(result.status,1);assert.equal(result.calls,1);
  }
  const result=await simulate([{...success,body:JSON.stringify({processed:1,errors:[{error:secret,label:'Private trip'}]})},success]);
  assert.equal(result.status,1);assert.equal(result.calls,1);
  assert.match(result.logs.join('\n'),/"errorCount":1/);
  assert.ok(!result.logs.join('\n').includes(secret));assert.ok(!result.logs.join('\n').includes('Private trip'));
});
test('invalid JSON and invalid response counters fail without retry',async()=>{
  for(const body of ['<html>'+secret,JSON.stringify({processed:-1,errors:[]}),JSON.stringify({processed:1.5,errors:[]}),
      JSON.stringify({processed:1,errors:secret}),JSON.stringify({processed:0,errors:null}),JSON.stringify({processed:0}),JSON.stringify({processed:0,changes:-1,errors:[]})]){
    const result=await simulate([{...success,body},success]);
    assert.equal(result.status,1);assert.equal(result.calls,1);assert.ok(!result.logs.join('\n').includes(secret));
  }
});
test('outcomes distinguish preconnect failures from later server failures in the same run',async()=>{
  for(const [responses,expected] of [
    [[noConnection(28),noConnection(7),noConnection(6)],'preconnect_failed'],
    [[noConnection(28),{exitCode:22,httpCode:'503',timeConnect:.1}],'failed'],
    [[noConnection(28),{...success,body:JSON.stringify({processed:0,errors:[{error:secret}]})}],'failed'],
    [[success],'ok']]){
    let calls=0;const outcomes=[];
    await runAlerts({secret,transport:async()=>responses[calls++],sleep:async()=>{},log:()=>{},report:async value=>outcomes.push(value)});
    assert.deepEqual(outcomes,[expected]);assert.equal(calls,responses.length);
  }
});
test('diagnostic failover never opens the primary connection',async()=>{
  let calls=0;const outcomes=[],logs=[];
  assert.equal(await runAlerts({secret,diagnosticFailover:true,transport:async()=>{calls++;return success;},
    report:async value=>outcomes.push(value),log:line=>logs.push(line)}),1);
  assert.equal(calls,0);assert.deepEqual(outcomes,['preconnect_failed']);assert.match(logs[0],/Diagnóstico/);
});
test('final workflow aggregation fails closed for all status and output combinations',()=>{
  const statuses=['success','failure','cancelled','skipped',''];
  const outcomes=['ok','preconnect_failed','failed',''];
  const accepted=new Set([
    'success|ok|skipped|ok','success|ok|skipped|preconnect_failed',
    'success|ok|skipped|failed','success|ok|skipped|',
    'success|preconnect_failed|success|ok',
  ]);
  for(const primaryStatus of statuses)for(const primaryOutcome of outcomes)
    for(const fallbackStatus of statuses)for(const fallbackOutcome of outcomes){
      const expected=accepted.has([primaryStatus,primaryOutcome,fallbackStatus,fallbackOutcome].join('|'));
      assert.equal(workflowSucceeded(primaryStatus,primaryOutcome,fallbackStatus,fallbackOutcome),expected,
        JSON.stringify({primaryStatus,primaryOutcome,fallbackStatus,fallbackOutcome}));
    }
});
test('lock already running and paused processor responses do not trigger extra calls',async()=>{
  const result=await simulate([{...success,body:JSON.stringify({processed:0,message:'Otra ejecución activa'})}]);
  assert.equal(result.status,0);assert.equal(result.calls,1);
});
test('missing or header-injecting secret fails before opening a connection',async()=>{
  for(const value of ['',undefined,'injected\r\nX-Other: bad']){
    let calls=0;const logs=[];
    assert.equal(await runAlerts({secret:value,transport:async()=>{calls++;return success;},log:line=>logs.push(line)}),1);
    assert.equal(calls,0);assert.ok(!logs.join('\n').includes('injected'));
  }
});
test('curl config keeps secret out of argv and child environment while using fixed IPv4 endpoint',()=>{
  const request=curlRequest(secret,'temp-response',{ALERTS_CRON_SECRET:secret,PATH:'system-path'});
  assert.ok(!request.args.join(' ').includes(secret));assert.equal(request.env.ALERTS_CRON_SECRET,undefined);
  assert.ok(request.args.includes('--ipv4'));assert.ok(request.args.includes('20'));assert.ok(request.args.includes('300'));
  assert.equal(request.args.at(-1),'https://www.alufi.es/vuelotel/api/alerts-run.php');
  assert.match(request.input,/X-Vuelotel-Cron: test-private-secret/);
  assert.equal(request.env.PATH,'system-path');
});
