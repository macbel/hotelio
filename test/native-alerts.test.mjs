import test from 'node:test';
import assert from 'node:assert/strict';
import {enableNativeAlerts,syncNativeAlerts,disableNativeAlerts,watchNativeAlertOpens,watchNativeSearchLinks,nativeAlertsAvailable} from '../src/native-alerts.js';

test('denied permission explains failure and never persists a token',async()=>{
  let configured=0;
  globalThis.Capacitor={isNativePlatform:()=>true,Plugins:{RumbivaAlerts:{requestNotificationPermission:async()=>({permission:false}),configure:async()=>configured++}}};
  await assert.rejects(enableNativeAlerts('private-token',1),/Android no ha permitido/);
  assert.equal(configured,0);
  delete globalThis.Capacitor;
});
test('refresh preserves opt-in only for the same account; switch and logout disable it',async()=>{
  const configured=[];let disabled=0;
  globalThis.Capacitor={isNativePlatform:()=>true,Plugins:{RumbivaAlerts:{status:async()=>({enabled:true,permission:true,userId:1}),configure:async value=>configured.push(value),disable:async()=>disabled++}}};
  await syncNativeAlerts('renewed-token',1);
  assert.deepEqual(configured,[{token:'renewed-token',userId:1}]);
  await syncNativeAlerts('other-user-token',2);
  assert.equal(configured.length,1);assert.equal(disabled,1);
  await disableNativeAlerts();assert.equal(disabled,2);
  delete globalThis.Capacitor;
});
test('notification opens are consumed once for both cold start and warm events',async()=>{
  const delivered=[];let callback,removed=0;
  let pending={alertId:11,userId:1};
  globalThis.Capacitor={isNativePlatform:()=>true,Plugins:{RumbivaAlerts:{addListener:async(event,handler)=>{assert.equal(event,'alertOpened');callback=handler;return {remove:()=>removed++};},consumeOpen:async()=>{const value=pending;pending={};return value;}}}};
  const dispose=await watchNativeAlertOpens(value=>delivered.push(value));
  assert.deepEqual(delivered,[{alertId:11,userId:1}]);
  await callback();assert.equal(delivered.length,1);
  pending={alertId:12,userId:1};await callback();assert.equal(delivered.length,2);
  pending={alertId:-1,userId:1};await callback();assert.equal(delivered.length,2);
  dispose();assert.equal(removed,1);
  delete globalThis.Capacitor;
});
test('ordinary web usage never exposes the native notification opt-in',()=>{
  delete globalThis.Capacitor;assert.equal(nativeAlertsAvailable(),false);
});

test('search app links consume cold and warm IDs without requiring notification opt-in',async()=>{
  const delivered=[];let handler,removed=0,pending={alertId:7};
  globalThis.Capacitor={isNativePlatform:()=>true,Plugins:{RumbivaLinks:{addListener:async(event,callback)=>{assert.equal(event,'linkOpened');handler=callback;return {remove:()=>removed++};},consumeLink:async()=>{const value=pending;pending={};return value;}}}};
  const dispose=await watchNativeSearchLinks(detail=>delivered.push(detail));
  assert.deepEqual(delivered,[{alertId:7}]);
  await handler();assert.equal(delivered.length,1);
  pending={alertId:8};await handler();assert.deepEqual(delivered.at(-1),{alertId:8});
  pending={alertId:9007199254740992};await handler();assert.equal(delivered.length,2);
  dispose();assert.equal(removed,1);delete globalThis.Capacitor;
});
