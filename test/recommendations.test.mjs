import test from 'node:test';
import assert from 'node:assert/strict';
import {recommendIndex, orderByDefault, rotateRecommendations, recommendationDay, checkRecommendationSnapshot} from '../scripts/recommendations.mjs';

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
test('smart picks title sorts ahead of the other declared keys',()=>{
  const titles=recommendIndex({plugins:[plugin('a','a')]},{now}).metadata.sortKeys;
  assert.equal(titles.recommended.title.zh,'✨ 智能推荐');
  for (const lang of ['zh','en']) assert.equal(['GitHub 星标数','随机资源','近 7 天新增 star',titles.recommended.title[lang]].sort(new Intl.Collator(lang).compare)[0],titles.recommended.title[lang]);
});

const catalog = () => {
  const plugins=Array.from({length:160},(_,i)=>plugin('choice-'+i,'author-'+i,i%2?'tools':'skills'));
  return {index:{plugins},signals:Object.fromEntries(plugins.map(p=>[p.name,{downloads:1000}]))};
};
test('daily front pages cover seventy plugins per week, mix again next week, and survive retries',()=>{
  const {index,signals}=catalog();
  const monday=Date.parse('2026-10-19T00:00:00+08:00');
  let previous;
  const seen={default:new Set(),recommended:new Set()}, priorFront={};
  for(let day=0;day<14;day++) {
    const options={signals,previous,now:monday+day*86400000};
    const result=rotateRecommendations(index,options),state=result.recommendations;
    checkRecommendationSnapshot(result.index,state);
    assert.equal(result.index.plugins.length,160);
    assert.equal(new Set(result.index.plugins.map(p=>p.name)).size,160);
    const today=state.history.at(-1);
    for(const mode of ['default','recommended']) {
      if(day===7) {assert.equal(seen[mode].size,70);seen[mode].clear();}
      assert.equal(today[mode].length,10);
      assert.equal(today[mode].some(name=>seen[mode].has(name)),false);
      assert.equal(today[mode].some(name=>priorFront[mode]?.includes(name)),false);
      today[mode].forEach(name=>seen[mode].add(name));
      priorFront[mode]=today[mode];
    }
    const retry=rotateRecommendations({...index,plugins:[...index.plugins].reverse()},{...options,previous:state,now:options.now+1000});
    assert.deepEqual(retry.recommendations,state);
    previous=state;
  }
  for(const mode of ['default','recommended']) assert.equal(seen[mode].size,70);
});
test('Taipei midnight changes the recommendation date',()=>{
  assert.equal(recommendationDay(Date.parse('2026-10-20T15:59:59Z')),'2026-10-20');
  assert.equal(recommendationDay(Date.parse('2026-10-20T16:00:00Z')),'2026-10-21');
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
test('small pools preserve complete ranks and record actual front pages',()=>{
  const index={plugins:[plugin('only','one'),plugin('other','two')]};
  const result=rotateRecommendations(index,{now});
  assert.equal(result.index.plugins.length,2);
  checkRecommendationSnapshot(result.index,result.recommendations);
});
