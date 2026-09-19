import assert from 'node:assert/strict';
import { client } from './dist/server/boards-client.js';

// Run the shipped detail/dialog functions with a deliberately small DOM boundary.
const source=client.toString();
function actual(name){
  const declarations=[...source.matchAll(/^  (?:async )?function (\w+)\(/gm)],index=declarations.findIndex(match=>match[1]===name);
  assert.ok(index>=0,'Missing client function: '+name);
  return source.slice(declarations[index].index,declarations[index+1]?.index??source.length-1);
}
const functions=['detail','openEmergencySubstitute','refreshDetail'].map(actual).join('\n');
const clone=value=>structuredClone(value);
function post(settledAt=null){return {id:'emergency-ui',kind:'schedule',version:7,title:'저장된 대진',names:['기존','동료','상대1','상대2'],courts:1,rounds:2,schedule:[{round:1,method:'same',g:[['기존','동료','상대1','상대2']],rest:[]},{round:2,method:'same',g:[['기존','동료','상대1','상대2']],rest:[]}],results:{'0-0':'a'},matchProgress:{'0-0':'finished'},settledAt,createdAt:'2026-09-19T00:00:00.000Z',updatedAt:'2026-09-19T00:00:00.000Z'};}
function node(id=''){
  return {id,value:'',textContent:'',disabled:false,dataset:{},onclick:null,onsubmit:null,focus(){},addEventListener(){},setAttribute(){},closest(){return null;}};
}
function harness({editor='operator',settledAt=null}={}){
  let server=post(settledAt),routeToken=1,draft=null,detailRead=0,viewRound=2;
  const elements=new Map(),app=node('app'),dialog=node('picker'),calls=[],messages=[];
  const parse=(host,html)=>{host.html=String(html);for(const match of host.html.matchAll(/<(form|button|input|p)\b[^>]*\bid="([^"]+)"[^>]*>/g)){const el=node(match[2]);const tag=match[1],attrs=match[0];if(tag==='input'){const value=/\bvalue="([^"]*)"/.exec(attrs);el.value=value?value[1]:'';}elements.set(el.id,el);}host.querySelector=selector=>{if(selector[0]==='#')return elements.get(selector.slice(1))||null;return null;};host.querySelectorAll=()=>[];};
  Object.defineProperty(app,'innerHTML',{get(){return app.html||'';},set(value){parse(app,value);}});
  Object.defineProperty(dialog,'innerHTML',{get(){return dialog.html||'';},set(value){parse(dialog,value);}});
  dialog.open=false;dialog.showModal=()=>{dialog.open=true;};dialog.close=()=>{dialog.open=false;dialog.onclose?.();};
  const $=id=>elements.get(id)||null;
  elements.set('app',app);elements.set('picker',dialog);
  const people=[{name:'기존',type:'member'},{name:'동료',type:'member'},{name:'상대1',type:'guest'},{name:'상대2',type:'guest'},{name:'교체',type:'member'},{name:'즉석',type:'guest',adhoc:true},{name:'숨김',type:'member',hidden:true}];
  let conflict=false;
  const api=async(path,options)=>{
    calls.push({path,options});
    if(path==='/api/people')return {people:clone(people)};
    if(options?.method==='POST'){
      if(conflict)throw Object.assign(Error('다른 기기에서 변경했습니다.'),{status:409});
      server={...server,version:server.version+1};return {data:clone(server)};
    }
    return {data:clone(server)};
  };
  const currentDetail=(id,token)=>token===routeToken&&!draft&&location.hash==='#post/'+encodeURIComponent(id);
  const location={hash:'#post/emergency-ui'};
  const getPeople=async()=>clone(people),scheduleHTML=()=>'<span data-view-round="'+viewRound+'"></span>',crumb=()=>'',esc=value=>String(value??''),date=value=>String(value),message=(text,error=false)=>messages.push({text,error}),startDetailPoll=()=>{},stopPoll=()=>{};
  const applyMatchState=()=>{},applyWin=()=>{},bindProgressControls=()=>{},recordResult=()=>{},recordProgress=()=>{},endMatch=()=>{},unsettlePost=()=>{},editSchedule=()=>{},editNotice=()=>{};
  const scope=new Function('context',`with(context){${functions};return {detail,openEmergencySubstitute,refreshDetail};}`)({EDITOR:editor,routeToken,detailRead,draft,viewRound,emergencySubstituteOpening:false,app,dialog,$,api,getPeople,scheduleHTML,crumb,esc,date,message,startDetailPoll,stopPoll,currentDetail,applyMatchState,applyWin,bindProgressControls,recordResult,recordProgress,endMatch,unsettlePost,editSchedule,editNotice,location});
  // Functions close over the context fields; expose the values detail needs to mutate.
  const context=scope;
  return {async detail(){await context.detail(server.id,1);},html:()=>app.innerHTML,button:id=>$(id),dialog,field:id=>$(id),calls,messages,setConflict(value){conflict=value;},server:()=>server};
}

export async function runEmergencyUIChecks(){
  const publicView=harness({editor:''});await publicView.detail();assert.equal((publicView.html().match(/id="emergencySubstitute"/g)||[]).length,0,'public schedule detail has no emergency substitute button');
  const settledView=harness({settledAt:'2026-09-19T01:00:00.000Z'});await settledView.detail();assert.equal((settledView.html().match(/id="emergencySubstitute"/g)||[]).length,0,'settled schedule detail has no emergency substitute button');
  const h=harness();await h.detail();assert.equal((h.html().match(/id="emergencySubstitute"/g)||[]).length,1,'operator unsettled saved schedule has exactly one emergency substitute button');
  await h.button('emergencySubstitute').onclick();assert.equal(h.dialog.open,true);assert.ok(h.dialog.innerHTML.includes('<label>기존 멤버<'), 'dialog keeps the requested existing-member manual label');assert.ok(h.dialog.innerHTML.includes('<label>교체 멤버<'), 'dialog keeps the requested replacement-member manual label');
  h.field('substituteRound').value='1';h.field('substituteCourt').value='1';h.field('substituteOldName').value='기존';h.field('substituteNewName').value='즉석';await h.field('emergencySubstituteForm').onsubmit({preventDefault(){}});assert.equal(h.calls.filter(call=>call.options?.method==='POST').length,0,'an ad-hoc replacement never reaches the substitute endpoint');
  h.field('substituteNewName').value='교체';await h.field('emergencySubstituteForm').onsubmit({preventDefault(){}});
  const writes=h.calls.filter(call=>call.options?.method==='POST');assert.equal(writes.length,1,'one confirmation makes one substitute request');assert.equal(writes[0].path,'/api/posts/emergency-ui/substitute');assert.deepEqual(JSON.parse(writes[0].options.body),{version:7,round:1,court:1,oldName:'기존',newName:'교체'},'the request snapshots the shown version and selected one-slot target');assert.ok(h.calls.filter(call=>!call.options).length>=2,'successful substitute refetches the schedule detail');assert.ok(h.html().includes('data-view-round="2"'),'detail refresh preserves the selected round');
  const conflictView=harness();await conflictView.detail();await conflictView.button('emergencySubstitute').onclick();conflictView.field('substituteOldName').value='기존';conflictView.field('substituteNewName').value='교체';conflictView.setConflict(true);await conflictView.field('emergencySubstituteForm').onsubmit({preventDefault(){}});assert.equal(conflictView.calls.filter(call=>call.options?.method==='POST').length,1,'a conflict never auto-retries the substitute request');assert.equal(conflictView.dialog.open,false,'a conflict closes the stale confirmation dialog');assert.ok(conflictView.calls.filter(call=>!call.options).length>=2,'a conflict refreshes the schedule before another confirmation');
  console.log('PASS: actual emergency substitute UI gates public/settled views, validates active seed people, snapshots one target, refetches, and never retries conflicts.');
}
