import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createScheduleInfo} from './dist/server/schedule-info-client.js';

const source=await readFile(new URL('./dist/server/boards-client.js',import.meta.url),'utf8');
function actual(name){
  let start=source.indexOf('function '+name+'(');assert.ok(start>=0);
  if(source.slice(start-6,start)==='async ')start-=6;
  let depth=0,quote='',escaped=false;
  for(let i=source.indexOf('{',start);i<source.length;i++){
    const c=source[i];if(quote){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c===quote)quote='';continue;}
    if(c==='"'||c==="'"||c==='`'){quote=c;continue;}if(c==='{')depth++;if(c==='}'&&!--depth)return source.slice(start,i+1);
  }throw Error('missing function end');
}
const today='2026-11-01',expiry=Date.now()+60000;
let session={allowed:true,today,expiresAt:expiry},post={id:'p',version:2,title:'기존 제목',scheduleDate:today,memberScheduleEditable:true,settledAt:null},member=true,calls=[];
const api=async(path,options)=>{calls.push({path,options});if(path==='/api/member-schedule-session')return session;if(path==='/api/posts/p'&&!options)return {data:post};return {data:post};};
const make=new Function('api','memberAccess',actual('memberScheduleSession')+'\n'+actual('validateMemberSchedule')+'\nreturn {memberScheduleSession,validateMemberSchedule};');
const checks=make(api,{member:()=>member});
await checks.validateMemberSchedule(post);
for(const replacement of [null,{allowed:false,today,expiresAt:expiry},{allowed:true,today,expiresAt:Date.now()-1},{allowed:true,today:'bad',expiresAt:expiry}]){session=replacement;await assert.rejects(checks.memberScheduleSession());}
session={allowed:true,today,expiresAt:expiry};member=false;await assert.rejects(checks.memberScheduleSession());member=true;
for(const bad of [{...post,memberScheduleEditable:false},{...post,settledAt:'closed'},{...post,scheduleDate:'2026-10-31'},{...post,version:3}]){const original=post;post=bad;await assert.rejects(checks.validateMemberSchedule(original));post=original;}
await assert.rejects(checks.validateMemberSchedule({...post,scheduleDate:'2026-10-31'}));
await checks.validateMemberSchedule({version:0,scheduleDate:today});
{
  const original={...post};post={...original,version:original.version+1};
  await assert.rejects(checks.validateMemberSchedule(original));
  await checks.validateMemberSchedule(original,true);
  for(const bad of [{...post,version:original.version+2},{...post,memberScheduleEditable:false},{...post,settledAt:'closed'},{...post,scheduleDate:'2026-10-31'}]){post=bad;await assert.rejects(checks.validateMemberSchedule(original,true));}
  session={allowed:false,today,expiresAt:0};await assert.rejects(checks.validateMemberSchedule(original,true));
  session={allowed:true,today,expiresAt:expiry};post=original;
}

// Execute persistDraft with a server stub that commits once, then loses the first response.
{
  let stored={...post},applied=0,first=true,lastPayload='';
  const replayApi=async(path,options)=>{
    if(path==='/api/member-schedule-session')return {allowed:true,today,expiresAt:expiry};
    if(!options)return {data:{...stored}};
    const input=JSON.parse(options.body),payload=JSON.stringify(input.data);
    if(stored.version===input.version){applied++;lastPayload=payload;stored={...stored,version:input.version+1};if(first){first=false;throw Error('response lost');}}
    else if(stored.version!==input.version+1||input.operation!=='same-operation'||payload!==lastPayload)throw Error('conflict');
    return {data:{...stored}};
  };
  const factory=new Function('api','memberAccess','initial',`let draft=initial,routeToken=1,dirty=true;const EDITOR='';${actual('memberScheduleSession')}\n${actual('validateMemberSchedule')}\n${actual('persistDraft')}\nreturn {persistDraft,getDraft:()=>draft};`);
  const editor=factory(replayApi,{member:()=>true},{...post,kind:'schedule',operation:'same-operation'});
  await assert.rejects(editor.persistDraft(),/response lost/);
  assert.equal(editor.getDraft().version,2);
  await editor.persistDraft();assert.equal(editor.getDraft().version,3);assert.equal(applied,1);
}

// Exercise the actual click handler, including pending requests and route/logout races.
function clickHarness(){
  return new Function('initial',`let routeToken=1,memberAuthEpoch=1,memberScheduleOpening=false,member=true,opened=0,logins=0,errors=0;
    const location={hash:'#schedule'},dialog={open:false},memberAccess={member:()=>member};
    let api=()=>initial;const openPicker=async()=>{opened++;},openMemberScheduleLogin=()=>{logins++;dialog.open=true;},message=()=>errors++;
    ${actual('openMemberScheduleCreate')}
    return {click:openMemberScheduleCreate,route(){routeToken++;location.hash='#home';},logout(){member=false;memberAuthEpoch++;},snapshot(){return {opened,logins,errors};}};`);
}
const harness=clickHarness();
let h=harness(Promise.resolve({allowed:true,today,expiresAt:expiry}));await h.click();assert.deepEqual(h.snapshot(),{opened:1,logins:0,errors:0});
h=harness(Promise.resolve({allowed:false,today,expiresAt:0}));await h.click();assert.deepEqual(h.snapshot(),{opened:0,logins:1,errors:0});
h=harness(Promise.reject(Error('offline')));await h.click();assert.deepEqual(h.snapshot(),{opened:0,logins:0,errors:1});
for(const action of ['route','logout']){let resolve;const pending=new Promise(r=>resolve=r);h=harness(pending);const first=h.click(),second=h.click();h[action]();resolve({allowed:false,today,expiresAt:0});await Promise.all([first,second]);assert.deepEqual(h.snapshot(),{opened:0,logins:0,errors:0});}
assert.match(actual('openMemberScheduleLogin'),/<h2 id="pickerTitle">/);

// A server-side capability change repaints even if the post version did not change.
let callback,refreshes=0;
const pollFactory=new Function('api','detail','setInterval','clearInterval',`let pollTimer=null,recordingResult=false,saving=false;const dialog={open:false},currentDetail=()=>true,stopPoll=()=>{};${actual('startDetailPoll')} return startDetailPoll;`);
const poll=pollFactory(async()=>({data:{version:2,settledAt:null,memberScheduleEditable:false}}),async()=>{refreshes++;},fn=>{callback=fn;return 1;},()=>{});
poll({id:'p',kind:'schedule',version:2,settledAt:null,memberScheduleEditable:true},1);await callback();assert.equal(refreshes,1);

const elements=new Map();
function element(id){if(!elements.has(id))elements.set(id,{value:'',textContent:'',disabled:false,hidden:false,dataset:{},setAttribute(){},focus(){},addEventListener(){}});return elements.get(id);}
const meetingOptions=['정모','소정모','벙개'].map((meetingType,index)=>{const option=element('scheduleTypeOption'+index);option.dataset.meetingType=meetingType;return option;});
const root={set innerHTML(value){this.html=value;},querySelector(selector){return element(selector.slice(1));},querySelectorAll(selector){return selector==='[data-meeting-type]'?meetingOptions:[];},addEventListener(){}};
const info=createScheduleInfo({root,esc:String,fixedDate:today});
assert.equal(element('scheduleDateButton').disabled,true);
meetingOptions[0].onclick();
element('scheduleVenue').value='체육관';element('scheduleHour').value='18';
assert.deepEqual(info.read(),{title:'11월 1일(일) 체육관 18시',scheduleDate:today,meetingType:'정모'});

// The member PUT relies on the shared API helper, which adds a header only for a real operator.
assert.match(actual('persistDraft'),/await validateMemberSchedule\(target,true\)/);
assert.doesNotMatch(actual('persistDraft'),/x-kokkiri-editor/);
assert.match(source,/if\(existing&&!EDITOR\)\$\('newTitle'\)\.readOnly=true/);
assert.match(source,/\$\('editTitle'\)\.readOnly=true/);
console.log('member schedule UI checks: PASS');
