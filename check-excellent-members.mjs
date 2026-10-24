import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {client} from './dist/server/boards-client.js';

const source=client.toString();
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

function actual(name){
  let start=source.indexOf('function '+name+'(');assert.notEqual(start,-1,'missing actual client function: '+name);if(source.slice(start-6,start)==='async ')start-=6;
  const brace=source.indexOf('{',start);let depth=0,quote='',escaped=false;
  for(let i=brace;i<source.length;i++){
    const ch=source[i];
    if(quote){if(escaped)escaped=false;else if(ch==='\\')escaped=true;else if(ch===quote)quote='';continue;}
    if(ch==='"'||ch==="'"||ch==='`'){quote=ch;continue;}
    if(ch==='{')depth++;else if(ch==='}'&&!--depth)return source.slice(start,i+1);
  }
  throw Error('unterminated '+name);
}
function compile(name,scope,prefix=''){return new Function(...Object.keys(scope),prefix+actual(name)+'\nreturn '+name+';')(...Object.values(scope));}

function element(attrs={}){return {attrs,value:'',textContent:'',hidden:false,listeners:[],setAttribute(key,value){this.attrs[key]=String(value);},addEventListener(type,listener){this.listeners.push([type,listener]);}};}
function appHarness(){
  let markup='';const byId=new Map();const app={querySelector(selector){return byId.get(selector.slice(1))||null;}};
  Object.defineProperty(app,'innerHTML',{get:()=>markup,set:value=>{markup=String(value);byId.clear();for(const match of markup.matchAll(/<([a-z][\w-]*)\b([^>]*)>/gi)){const attrs={};for(const attr of match[2].matchAll(/([\w-]+)(?:="([^"]*)")?/g))attrs[attr[1]]=attr[2]??'';if(attrs.id){const node=element(attrs);byId.set(attrs.id,node);}}}});
  return app;
}
const ranking=(name='가나다',operator=false)=>({member_id:'member-1',name,rank:1,rank_movement:0,seed:'A',points:100,attendance:3,wins:2,losses:1,is_operator:operator});
const guest=(id,name)=>({id,name,type:'guest',points:65,seed:'B',attendance:1,wins:1,losses:0});
function seedsHarness({lists=[[],[]],rankings=[ranking()],guests=[],failLists=false,request=async(path)=>{
  if(path==='/api/rankings')return {items:rankings,updatedDate:'2026-10-25'};
  if(path==='/api/ledger-lists/prepaid'){if(failLists)throw Error('list unavailable');return {data:{entries:lists[0]}};}
  if(path==='/api/ledger-lists/sponsors'){if(failLists)throw Error('list unavailable');return {data:{entries:lists[1]}};}
  throw Error('unexpected API request '+path);
}}={}){
  const app=appHarness(),calls=[];let people=guests;
  const api=(path,options)=>{calls.push({path,method:options?.method||'GET'});return request(path,options);};
  const build=new Function('app','api','loadPeople','esc','nameHTML','crown','seedHTML','crumb','syncOperators','message','alert','confirm','OPERATORS','EDITOR','ADMIN',`
    let routeToken=1,people=[];
    const $=id=>app.querySelector('#'+id);
    async function getPeople(){people=await loadPeople();}
    ${actual('excellentMemberNames')}
    ${actual('excellentMemberBadge')}
    ${actual('seeds')}
    return {seeds,navigate(){routeToken++;},routeToken(){return routeToken;}};
  `)(app,api,async()=>people,esc,value=>esc(value),name=>new Set(['가나다']).has(name)?'<span class="crown" title="운영진">👑</span>':'',value=>esc(value||'미정'),()=>'',()=>{},()=>{},()=>{},()=>true,new Set(['가나다']),'',false);
  return {app,calls,view:build,setPeople(value){people=value;}};
}

export async function runExcellentMemberChecks(){
  const names=compile('excellentMemberNames',{}),badge=compile('excellentMemberBadge',{});
  {
    const listNames=names([{data:{entries:[{name:'  Cafe\u0301  '},{name:'Café'},{name:'가나다'},{name:'가나다'}]}},{data:{entries:[{name:'게스트이름'}]}}]);
    assert.deepEqual([...listNames].sort(),['Café','가나다','게스트이름'].sort(),'prepaid and sponsor lists union trimmed NFC names and deduplicate exact matches');
    assert.match(badge('  Cafe\u0301 ',listNames),/excellent-member-badge/,'trimmed canonically equivalent names receive a badge');
    assert.equal(badge('가나다2',listNames),'','matching is exact and does not use fuzzy prefixes');
  }
  {
    const member=ranking('가나다',true),snapshot=JSON.stringify(member);
    const calls=[];const h=seedsHarness({lists:[[{name:'가나다'}],[]],rankings:[member],guests:[guest('guest-1','찬조게스트')],request:async path=>{
      calls.push(path);if(path==='/api/rankings')return {items:[member],updatedDate:'2026-10-25'};
      if(path==='/api/ledger-lists/prepaid')return {data:{entries:[{name:' 가나다 '}]}};
      if(path==='/api/ledger-lists/sponsors')return {data:{entries:[{name:'찬조게스트'}]}};
    }});
    await h.view.seeds(h.view.routeToken());
    assert.match(h.app.querySelector('#seedList').innerHTML,/class="crown"[^>]*>👑<\/span><span class="excellent-member-badge"/,'operator crown and excellent-member badge render together');
    assert.equal((h.app.querySelector('#seedList').innerHTML.match(/excellent-member-badge/g)||[]).length,1,'the member row receives one badge');
    assert.ok(calls.includes('/api/ledger-lists/prepaid')&&calls.includes('/api/ledger-lists/sponsors'));
    assert.ok(h.calls.every(call=>call.method==='GET'),'badge loading and display never mutate scores or send writes');
    assert.equal(JSON.stringify(member),snapshot,'ranking score fields are not changed');
    await h.app.querySelector('#seedGuests').onclick();
    assert.match(h.app.querySelector('#seedList').innerHTML,/찬조게스트[\s\S]*?<span class="excellent-member-badge"/,'guest rows also receive the badge');
  }
  {
    let present=true;const h=seedsHarness({request:async path=>{
      if(path==='/api/rankings')return {items:[ranking()],updatedDate:'2026-10-25'};
      if(path==='/api/ledger-lists/prepaid')return {data:{entries:present?[{name:'가나다'}]:[]}};
      if(path==='/api/ledger-lists/sponsors')return {data:{entries:[]}};
    }});
    await h.view.seeds(h.view.routeToken());assert.match(h.app.querySelector('#seedList').innerHTML,/excellent-member-badge/);
    present=false;await h.view.seeds(h.view.routeToken());assert.doesNotMatch(h.app.querySelector('#seedList').innerHTML,/excellent-member-badge/,'removing a list entry clears the badge on the next seed load');
  }
  {
    const h=seedsHarness({failLists:true,rankings:[ranking()]});await h.view.seeds(h.view.routeToken());
    assert.match(h.app.innerHTML,/우수회원 표시를 불러오지 못했습니다/,'ordinary list API failures clear badge state and show a status message');
    assert.doesNotMatch(h.app.innerHTML,/excellent-member-badge/,'failed list reads do not keep stale badges');
  }
  {
    const rankings=deferred(),prepaid=deferred(),sponsors=deferred();
    const h=seedsHarness({request:path=>path==='/api/rankings'?rankings.promise:path.endsWith('/prepaid')?prepaid.promise:sponsors.promise});
    const pending=h.view.seeds(h.view.routeToken());h.view.navigate();
    rankings.resolve({items:[ranking()],updatedDate:'2026-10-25'});prepaid.resolve({data:{entries:[{name:'가나다'}]}});sponsors.resolve({data:{entries:[]}});
    await pending;assert.doesNotMatch(h.app.innerHTML,/우수회원 표시|excellent-member-badge/,'late results after navigation do not render stale badges or status');
  }
  return true;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  runExcellentMemberChecks().then(()=>console.log('check-excellent-members PASS')).catch(error=>{console.error(error);process.exitCode=1;});
}
