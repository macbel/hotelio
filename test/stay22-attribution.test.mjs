import test from 'node:test';
import assert from 'node:assert/strict';
import {monetizeStay22Url} from '../scripts/stay22.mjs';

test('adds Hotelio attribution to a Stay22 offer',()=>{
  const url=new URL(monetizeStay22Url('https://www.stay22.com/allez/booking/123?aid=stay22&checkin=2026-08-10'));
  assert.equal(url.searchParams.get('aid'),'hotelio');
  assert.equal(url.searchParams.get('campaign'),'hotelio_search');
  assert.equal(url.searchParams.get('checkin'),'2026-08-10');
});

test('does not modify non-Stay22 URLs',()=>{
  const original='https://example.com/hotel?aid=other';
  assert.equal(monetizeStay22Url(original),original);
});
