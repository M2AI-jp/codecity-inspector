import {test} from 'node:test';
import assert from 'node:assert/strict';
import {FACILITY_VOICE} from '../web/dialogue/facility-voices.js';
import {facilityVoiceCases} from './fixtures/facility-voice-cases.mjs';

import {recoveryFacts} from './fixtures/recovery-voice-cases.mjs';

test('解析器が作る全種類の復旧根拠を、語尾を重ねず根拠を保って話す',()=>{
 const facts=recoveryFacts();
 for(const [kind,hits] of Object.entries(facts))for(const hit of hits){
  const lines=FACILITY_VOICE.repair.facts({[kind]:[hit]});
  assert.ok(lines[0].includes(hit.path));
  assert.ok(lines[0].includes(hit.detail));
  assert.doesNotMatch(lines[0],/あるがある|あるの手順|。。|undefined/);
  assert.ok(lines.at(-1).includes('本当に戻せるかは、ここでは確かめていない'));
 }
 assert.equal(FACILITY_VOICE.repair.facts({runbook:[{path:'docs/recovery.md',detail:'ファイル名に「recovery」がある'}]})[0],
  '復旧の手順書は「docs/recovery.md」だ。ファイル名に「recovery」がある。');
});

test('全施設の挨拶・説明・結びと、分岐の見本で二重の語尾や未定義値を話さない',()=>{
 assert.deepEqual([...new Set(facilityVoiceCases.map(c=>c.archetype))].sort(),Object.keys(FACILITY_VOICE).sort());
 for(const c of facilityVoiceCases){
  const v=FACILITY_VOICE[c.archetype];
  const lines=[...v.greet,...v.what,...v.facts(c.facts,c.town),...v.close];
  for(const line of lines)assert.doesNotMatch(line,/あるがある|あるの手順|ですです|ますます。|。。|undefined|NaN/,`${c.name}: ${line}`);
 }
});
