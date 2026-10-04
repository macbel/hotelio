import test from 'node:test';
import assert from 'node:assert/strict';
import {alertConditions,conditionFields,conditionsLabel,historyMarkup} from '../src/alert-controls.js';

test('existing alerts retain their legacy condition',()=>{
  assert.equal(alertConditions({type:'hotel'}).mode,'change');
  assert.equal(alertConditions({type:'destination',query:{_alertMode:'threshold',_threshold:250}}).targetPrice,250);
  assert.match(conditionsLabel({currency:'EUR',conditions:{mode:'percent',minDropPercent:10,notifyCooldownHours:24}}),/10 %.*24 h/);
});
test('condition editor exposes target and percentage as separate validated inputs',()=>{
  const target=conditionFields({mode:'threshold',targetPrice:120});
  assert.match(target,/data-condition-target >Precio objetivo/);
  assert.match(target,/data-condition-percent hidden/);
  assert.match(target,/name="targetPrice" type="number" min="0.01" step="0.01" value="120"/);
});
test('history distinguishes missing prices, mail acceptance, and escaped errors',()=>{
  const html=historyMarkup([{checkedAt:1791139735,price:null,status:'error',error:'<img onerror=alert(1)>'},{checkedAt:1791139736,price:100,currency:'EUR',status:'sent',mailStatus:'accepted',direction:'down'}]);
  assert.match(html,/Sin precio comparable/);
  assert.match(html,/recepción sin confirmar/);
  assert.match(html,/Ha bajado/);
  assert.doesNotMatch(html,/<img/);
});
