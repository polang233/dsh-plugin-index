import test from 'node:test';
import assert from 'node:assert/strict';
import {recommendIndex, orderByDefault, rotateRecommendations, recommendationDay, recommendationRound, checkRecommendationSnapshot} from '../scripts/recommendations.mjs';

const now = Date.parse('2026-10-18T12:00:00Z');
const plugin = (name, developer, category = 'tools') => ({name, repository:{url:`https://github.com/${developer}/${name}`}, metadata:{category}, versions:[{version:'1.0.0',publishTimestamp:(now-86400000)/1000,source:{type:'npm'}}]});

test('default recommendations spread exposure across developers and retain every entry',()=>{
  const plugins=[...Array.from({length:8},(_,i)=>plugin('popular-'+i,'one')),plugin('new-memory','two','memory'),plugin('new-skill','three','skills')];
  const github={repositories:Object.fromEntries(plugins.map(p=>[p.repository.url.replace('https://github.com/',''),{status:'ok',stars:p.name.startsWith('popular')?100000:0,pushedAt:new Date(now-86400000).toISOString()}]))};
  const result=recommendIndex({plugins},{github,now});
  assert.equal(new Set(result.plugins.slice(0,3).map(p=>p.repository.url.split('/')[3])).size,3);
  assert.deepEqual(result.plugins.map(p=>p.name).sort(),plugins.map(p=>p.name).sort());
  assert.equal(result.plugins[0].metadata.sortKeys.recommended,10);
  assert.equal(result.metadata.sortKeys.recommended.order,'desc');
});
test('recommendations are reproducible within a day and independent of input order',()=>{
  const plugins=['one','two','three'].map(name=>plugin(name,name));
  const names=value=>value.plugins.map(p=>p.name);
  assert.deepEqual(names(recommendIndex({plugins},{now})),names(recommendIndex({plugins:[...plugins].reverse()},{now})));
  assert.deepEqual(names(recommendIndex({plugins},{now})),names(recommendIndex({plugins},{now:now+60000})));
});
test('recently maintained projects can precede an archived high-star repository',()=>{
  const fresh=plugin('fresh','new'),old=plugin('old','big');
  const github={repositories:{'big/old':{status:'ok',stars:1000000,archived:true,pushedAt:new Date(now).toISOString()}}};
  assert.equal(recommendIndex({plugins:[old,fresh]},{github,now}).plugins[0].name,'fresh');
});

test('random resources change by Taipei date, stay stable on retries, and ignore quality signals',()=>{
  const plugins=Array.from({length:30},(_,i)=>plugin('random-'+i,'author-'+i));
  const ranks=result=>Object.fromEntries(result.plugins.map(p=>[p.name,p.metadata.sortKeys['random-resources']]));
  const first=recommendIndex({plugins},{now});
  const same=recommendIndex({plugins:[...plugins].reverse()},{now:now+60000, signals:{'random-1':{downloads:500000}}});
  assert.deepEqual(ranks(first),ranks(same));
  assert.notDeepEqual(ranks(first),ranks(recommendIndex({plugins},{now:now+86400000})));
  assert.deepEqual(Object.values(ranks(first)).sort((a,b)=>a-b),Array.from({length:30},(_,i)=>i+1));
});
test('growing, frequently released projects outrank a quiet high-star one',()=>{
  const quiet=plugin('quiet','big'),rising=plugin('rising','small');
  const github={repositories:{'big/quiet':{status:'ok',stars:50000,pushedAt:new Date(now-200*86400000).toISOString()},'small/rising':{status:'ok',stars:3,pushedAt:new Date(now-86400000).toISOString()}}};
  quiet.versions[0].publishTimestamp=(now-200*86400000)/1000;
  const signals={rising:{growth:4,releases30:20,ageDays:10}};
  assert.equal(recommendIndex({plugins:[quiet,rising]},{github,signals,now}).plugins[0].name,'rising');
});
test('verification, reach and star growth lift an otherwise equal plugin',()=>{
  const a=plugin('plain','one'),b=plugin('trusted','two');
  const signals={trusted:{verifiedBy:['awesome-dsh'],downloads:20000,starsWeek:30}};
  assert.equal(recommendIndex({plugins:[a,b]},{signals,now}).plugins[0].name,'trusted');
});
test('default order favors downloads, stars and a logo, and keeps every entry',()=>{
  const bare=plugin('bare','one'),popular=plugin('popular','two'),logo={...plugin('logo','three'),icon:'icons/a.svg'};
  const github={repositories:{'two/popular':{status:'ok',stars:3000,pushedAt:new Date(now).toISOString()}}};
  const signals={popular:{downloads:50000},logo:{downloads:200}};
  const result=orderByDefault({plugins:[bare,logo,popular]},{github,signals,now});
  assert.deepEqual(result.plugins.map(p=>p.name),['popular','logo','bare']);
});
test('the declared sort titles keep smart picks first in the order DSH collates them',()=>{
  const titles=recommendIndex({plugins:[plugin('a','a')]},{now}).metadata.sortKeys;
  assert.equal(titles.recommended.title.zh,'⊙ 智能推荐');
  assert.equal(titles['random-resources'].title.zh,'⚄ 随机资源');
  for (const lang of ['zh','en']) {
    const declared=[titles['random-resources'].title[lang],lang==='zh'?'★ 星数最多':'★ Most stars',lang==='zh'?'▲ 近期增长':'▲ Recent growth',titles.recommended.title[lang]];
    assert.deepEqual([...declared].sort(new Intl.Collator(lang).compare),[...declared].reverse());
  }
});

const catalog = (length=160) => {
  const plugins=Array.from({length},(_,i)=>plugin('choice-'+i,'author-'+i,i%2?'tools':'skills'));
  return {index:{plugins},signals:Object.fromEntries(plugins.map(p=>[p.name,{downloads:1000}]))};
};
const ROUND=6*3600000, ROUNDS_PER_WEEK=28, POOL=280;
test('each six-hour round shows ten new plugins, a week covers the pool, and retries change nothing',()=>{
  const {index,signals}=catalog(320);
  const monday=Date.parse('2026-10-19T00:00:00+08:00');
  let previous;
  const seen={default:new Set(),recommended:new Set()}, priorFront={};
  for(let round=0;round<ROUNDS_PER_WEEK*2;round++) {
    const options={signals,previous,now:monday+round*ROUND};
    const result=rotateRecommendations(index,options),state=result.recommendations;
    checkRecommendationSnapshot(result.index,state);
    assert.equal(new Set(result.index.plugins.map(p=>p.name)).size,320);
    const today=state.history.at(-1);
    for(const mode of ['default','recommended']) {
      if(round===ROUNDS_PER_WEEK) {assert.equal(seen[mode].size,POOL);seen[mode].clear();}
      assert.equal(today[mode].length,10);
      assert.equal(today[mode].some(name=>seen[mode].has(name)),false);
      assert.equal(today[mode].some(name=>priorFront[mode]?.includes(name)),false);
      today[mode].forEach(name=>seen[mode].add(name));
      priorFront[mode]=today[mode];
    }
    if(round%7===0) assert.deepEqual(rotateRecommendations({...index,plugins:[...index.plugins].reverse()},{...options,previous:state,now:options.now+1000}).recommendations,state);
    previous=state;
  }
  for(const mode of ['default','recommended']) assert.equal(seen[mode].size,POOL);
});
test('at least two fifths of a new weekly pool were not in the last one, and quality still counts',()=>{
  const {index,signals}=catalog(900);
  const scored={...signals,...Object.fromEntries(index.plugins.slice(0,60).map(p=>[p.name,{downloads:100000,verifiedBy:['x']}]))};
  const monday=Date.parse('2026-10-19T00:00:00+08:00');
  const first=rotateRecommendations(index,{signals:scored,now:monday}).recommendations;
  const next=rotateRecommendations(index,{signals:scored,previous:first,now:monday+7*86400000}).recommendations;
  for(const mode of ['default','recommended']) {
    const last=new Set(first.pools[mode]);
    assert.equal(next.pools[mode].length,POOL);
    assert.ok(next.pools[mode].filter(name=>!last.has(name)).length>=POOL*0.4,mode);
  }
  const strong=first.pools.default.filter(name=>Number(name.split('-')[1])<60).length;
  assert.ok(strong>60*POOL/900*1.5,`${strong} strong plugins in the default pool`);
});
test('a day-based state from the previous schema starts clean instead of failing the build',()=>{
  const {index,signals}=catalog();
  const old={schema:1,timeZone:'Asia/Taipei',day:'2026-10-18',cycle:'2026-10-12',pools:{default:[],recommended:[]},history:[]};
  const result=rotateRecommendations(index,{signals,previous:old,now});
  assert.equal(result.recommendations.schema,2);
  checkRecommendationSnapshot(result.index,result.recommendations);
});
test('Taipei midnight changes the recommendation date',()=>{
  assert.equal(recommendationDay(Date.parse('2026-10-20T15:59:59Z')),'2026-10-20');
  assert.equal(recommendationDay(Date.parse('2026-10-20T16:00:00Z')),'2026-10-21');
  assert.equal(recommendationRound(Date.parse('2026-10-20T16:00:00Z')),'2026-10-21T00');
  assert.equal(recommendationRound(Date.parse('2026-10-20T15:59:59Z')),'2026-10-20T18');
});
test('removed and archived plugins leave the pool without promoting an unknown low-reach entry',()=>{
  const {index,signals}=catalog();
  const initial=rotateRecommendations(index,{signals,now});
  const removed=initial.recommendations.pools.default[0];
  const archived=initial.recommendations.pools.recommended[0];
  const github={repositories:{['author-'+archived.split('-').at(-1)+'/'+archived]:{status:'ok',archived:true,stars:5000}}};
  const plugins=[...index.plugins.filter(p=>p.name!==removed),plugin('unknown','unknown')];
  const result=rotateRecommendations({plugins},{signals,github,previous:initial.recommendations,now:now+86400000});
  for(const mode of ['default','recommended']) {
    assert.equal(result.recommendations.pools[mode].includes(removed),false);
    assert.equal(result.recommendations.pools[mode].includes(archived),false);
    assert.equal(result.recommendations.pools[mode].includes('unknown'),false);
  }
  checkRecommendationSnapshot(result.index,result.recommendations);
});
const listed=(names,day)=>Object.fromEntries(names.map(name=>[name,day]));
const newcomerCatalog=()=>{
  const {index,signals}=catalog();
  const fresh=Array.from({length:30},(_,i)=>plugin('fresh-'+i,'fresh-author-'+i));
  const added={schema:1,packages:{...listed(index.plugins.map(p=>p.name),'2026-09-01'),...listed(fresh.map(p=>p.name),'2026-10-17')}};
  return {index:{plugins:[...index.plugins,...fresh]},signals,added};
};
test('smart picks seat three recent listings without touching the default front page',()=>{
  const {index,signals,added}=newcomerCatalog();
  const result=rotateRecommendations(index,{signals,added,now});
  const today=result.recommendations.history.at(-1);
  assert.deepEqual([1,4,7].map(place=>today.recommended[place].startsWith('fresh-')),[true,true,true]);
  assert.equal(today.recommended.filter(name=>name.startsWith('fresh-')).length,3);
  assert.equal(today.default.some(name=>name.startsWith('fresh-')),false);
  assert.equal(result.recommendations.pools.recommended.some(name=>name.startsWith('fresh-')),false);
  assert.equal(new Set(today.recommended).size,10);
  checkRecommendationSnapshot(result.index,result.recommendations);
});
test('newcomers rotate within the week, stay put on retries, and age out of their places',()=>{
  const {index,signals,added}=newcomerCatalog();
  const monday=Date.parse('2026-10-19T00:00:00+08:00');
  let previous;
  const seen=[];
  for(let day=0;day<3;day++){
    const first=rotateRecommendations(index,{signals,added,previous,now:monday+day*86400000});
    const retry=rotateRecommendations(index,{signals,added,previous:first.recommendations,now:monday+day*86400000+3600000});
    assert.deepEqual(retry.recommendations.history.at(-1).recommended,first.recommendations.history.at(-1).recommended);
    seen.push(...first.recommendations.history.at(-1).recommended.filter(name=>name.startsWith('fresh-')));
    previous=first.recommendations;
  }
  assert.equal(seen.length,9);
  assert.equal(new Set(seen).size,9);
  const later=rotateRecommendations(index,{signals,added,now:Date.parse('2026-10-28T12:00:00Z')}).recommendations.history.at(-1);
  assert.equal(later.recommended.some(name=>name.startsWith('fresh-')),false);
});
test('a listing that arrives after the day is set still gets its place and drops nobody',()=>{
  const {index,signals,added}=newcomerCatalog();
  const settled=rotateRecommendations(index,{signals,now});
  const result=rotateRecommendations(index,{signals,added,previous:settled.recommendations,now:now+3600000});
  assert.equal(result.recommendations.history.at(-1).recommended.filter(name=>name.startsWith('fresh-')).length,3);
  assert.equal(new Set(result.index.plugins.map(p=>p.metadata.sortKeys.recommended)).size,index.plugins.length);
  checkRecommendationSnapshot(result.index,result.recommendations);
});
test('archived listings never take a newcomer place',()=>{
  const {index,signals,added}=newcomerCatalog();
  const github={repositories:Object.fromEntries(index.plugins.filter(p=>p.name.startsWith('fresh-')).map(p=>[p.repository.url.replace('https://github.com/',''),{status:'ok',archived:true,stars:0}]))};
  const today=rotateRecommendations(index,{signals,added,github,now}).recommendations.history.at(-1);
  assert.equal(today.recommended.some(name=>name.startsWith('fresh-')),false);
});
test('small pools preserve complete ranks and record actual front pages',()=>{
  const index={plugins:[plugin('only','one'),plugin('other','two')]};
  const result=rotateRecommendations(index,{now});
  assert.equal(result.index.plugins.length,2);
  checkRecommendationSnapshot(result.index,result.recommendations);
});
