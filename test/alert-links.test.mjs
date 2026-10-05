import test from 'node:test';
import assert from 'node:assert/strict';
import {validAlertId,alertIdFromUrl,rememberAlert,pendingAlert,forgetAlert} from '../src/alert-links.js';
test('alert links accept only one positive integer ID',()=>{
  assert.equal(alertIdFromUrl('https://www.alufi.es/vuelotel/?alertId=123'),123);
  for(const value of ['0','-1','1.5','1e2','01','9007199254740992'])assert.equal(validAlertId(value),null);
  assert.equal(alertIdFromUrl('https://www.alufi.es/vuelotel/?alertId=1&alertId=2'),null);
  assert.equal(alertIdFromUrl('https://www.alufi.es/vuelotel/?alert=1&alertId=2'),null);
});
test('pending link survives login and is cleared explicitly',()=>{
  const data=new Map(),storage={getItem:key=>data.get(key),setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)};
  rememberAlert(5,storage);assert.equal(pendingAlert(storage),5);rememberAlert('invalid',storage);assert.equal(pendingAlert(storage),5);forgetAlert(storage);assert.equal(pendingAlert(storage),null);
});
