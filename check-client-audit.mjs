import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { runProgressUIChecks } from './check-progress-ui.mjs';
import { runLiveUIChecks } from './check-live-ui.mjs';

const source=await readFile(new URL('./dist/server/boards-client.js',import.meta.url),'utf8');
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

function actual(name){
  let start=source.indexOf('function '+name+'(');
  assert.notEqual(start,-1,'missing '+name);
  if(source.slice(start-6,start)==='async ')start-=6;
  const brace=source.indexOf('{',start);
  let depth=0,quote='',escaped=false;
  for(let index=brace;index<source.length;index++){
    const char=source[index];
    if(quote){if(escaped)escaped=false;else if(char==='\\')escaped=true;else if(char===quote)quote='';continue;}
    if(char==='"'||char==="'"||char==='`'){quote=char;continue;}
    if(char==='{')depth++;
    if(char==='}'&&!--depth)return source.slice(start,index+1);
  }
  throw Error('unterminated '+name);
}
function compile(name,scope){return new Function(...Object.keys(scope),actual(name)+'\nreturn '+name+';')(...Object.values(scope));}
function compilePicker(scope){return new Function(...Object.keys(scope),'let routeToken=1;'+actual('openPicker')+'\nreturn {openPicker,navigate(){routeToken++;}};')(...Object.values(scope));}

function dialogHarness(){
  let children=[];
  const byId=new Map();
  const listeners=new Map();
  const emit=(type,event={preventDefault(){}})=>{for(const listener of [...(listeners.get(type)||[])])listener(event);};
  const element=attrs=>({attrs,value:attrs.value??'',textContent:'',disabled:Object.hasOwn(attrs,'disabled'),focus(){},select(){},addEventListener(){},setAttribute(name,value){this.attrs[name]=String(value);}});
  const dialog={open:false,onclose:null,oncancel:null,removed:false,
    showModal(){this.open=true;},close(){const wasOpen=this.open;this.open=false;if(wasOpen){emit('close');this.onclose?.();}},remove(){this.removed=true;},
    querySelector(selector){return selector.startsWith('#')?byId.get(selector.slice(1))||null:null;},
    addEventListener(type,listener){if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(listener);},
    removeEventListener(type,listener){listeners.get(type)?.delete(listener);},dispatch(type){emit(type);},
  };
  Object.defineProperty(dialog,'innerHTML',{get(){return this.html||'';},set(value){
    this.html=String(value);children=[];byId.clear();
    for(const tag of this.html.matchAll(/<(button|input|textarea|select|form|p|div)\b([^>]*)>/g)){
      const attrs={};for(const attr of tag[2].matchAll(/([\w-]+)(?:="([^"]*)")?/g))attrs[attr[1]]=attr[2]??'';
      const node=element(attrs);children.push(node);if(attrs.id)byId.set(attrs.id,node);
    }
  }});
  return {dialog,$:id=>byId.get(id)||null};
}

async function checkLoginCancellation(){
  const h=dialogHarness(),request=deferred(),redirects=[];
  const openLoginDialog=compile('openLoginDialog',{$:h.$,dialog:h.dialog,api:()=>request.promise,esc,location:{assign:url=>redirects.push(url)}});
  openLoginDialog('운영진권한','비밀번호','/api/operator-login',/^\/operate-[\w-]+$/,'이동');
  h.$('loginPw').value='not-a-secret';
  const pending=h.$('loginForm').onsubmit({preventDefault(){}});
  h.$('cancelLogin').onclick();
  request.resolve({redirect:'/operate-safe'});
  await pending;
  assert.deepEqual(redirects,[],'a canceled login must ignore its late success response');

  const failed=deferred();
  const retry=compile('openLoginDialog',{$:h.$,dialog:h.dialog,api:()=>failed.promise,esc,location:{assign:url=>redirects.push(url)}});
  retry('운영진권한','비밀번호','/api/operator-login',/^\/operate-[\w-]+$/,'이동');
  const retryPending=h.$('loginForm').onsubmit({preventDefault(){}});
  h.$('closeLogin').onclick();
  failed.reject(Error('연결 실패'));
  await retryPending;
  assert.deepEqual(redirects,[],'a canceled login must also ignore a late failure');
}

async function checkEncodedNoticeNavigation(){
  let detailedId='';
  const route=compile('route',{location:{hash:'#post/%EA%B3%B5%EC%A7%80%20A'},routeToken:undefined,lastHash:undefined,draft:undefined,viewRound:undefined,
    stopPoll(){},app:{innerHTML:''},board:async()=>{},seeds:async()=>{},liveView:null,detail:async id=>{detailedId=id;},home(){},crumb:()=>'',esc,$:()=>({}),});
  // route's own closure owns the counters; the injected undefined names are harmless globals for this focused path.
  await route();
  assert.equal(detailedId,'공지 A','a post link must decode the ID before the API layer encodes it');
}

async function checkPickerCancelIsolation(){
  const h=dialogHarness(),people=[{id:'m1',name:'회원',type:'member',seed:'A',points:100}];
  const openPicker=compile('openPicker',{
    EDITOR:'operator',getPeople:async()=>{},message(){},people,dialog:h.dialog,$:h.$,esc,nameHTML:esc,seedHTML:esc,
    crypto:{randomUUID:()=> 'adhoc-id'},scheduleTools:{generate(){return [];},},OPERATORS:new Set(),confirm:()=>true,alert(){},window:{scrollTo(){}},stamp:()=>'',editSchedule(){},dirty:false,routeToken:1,
  });
  await openPicker(null);
  h.$('newGuestName').value='취소한 게스트';
  h.$('addGuest').onclick();
  h.$('closePicker').onclick();
  assert.equal(people.length,1,'an ad-hoc guest must not leak into the shared picker cache after canceling');
}

async function checkPickerLocalNamesAndNavigation(){
  {
    const h=dialogHarness(),load=deferred();
    const picker=compilePicker({
      EDITOR:'operator',getPeople:()=>load.promise,message(){},people:[],dialog:h.dialog,$:h.$,esc,nameHTML:esc,seedHTML:esc,
      crypto:{randomUUID:()=> 'adhoc-id'},scheduleTools:{generate(){return [];},},OPERATORS:new Set(),confirm:()=>true,alert(){},window:{scrollTo(){}},stamp:()=>'',editSchedule(){},dirty:false,
    });
    const pending=picker.openPicker(null);picker.navigate();load.resolve();await pending;
    assert.equal(h.dialog.open,false,'a picker whose people load finishes after navigation must not open on the new page');
  }
  {
    const h=dialogHarness(),roster=[];
    const people=[
      {id:'m',name:'중복',type:'member',seed:'A',points:100},{id:'g',name:'중복',type:'guest',seed:'B',points:80},
      {id:'a',name:'A',type:'member',seed:'C',points:60},{id:'b',name:'B',type:'member',seed:'D',points:40},{id:'c',name:'C',type:'member',seed:'E',points:20},
    ];
    const openPicker=compile('openPicker',{
      EDITOR:'operator',getPeople:async()=>{},message(){},people,dialog:h.dialog,$:h.$,esc,nameHTML:esc,seedHTML:esc,nameOf:()=> 'GLOBAL-NAME',
      crypto:{randomUUID:()=> 'new'},scheduleTools:{generate(value){roster.push(...value);return [];},},OPERATORS:new Set(),confirm:()=>true,alert(){},window:{scrollTo(){}},stamp:()=>'',editSchedule(){},dirty:false,routeToken:1,
    });
    await openPicker({id:'draft',participantIds:people.map(p=>p.id),names:['중복 (회원)','중복 (게스트)','A','B','C'],courts:1,rounds:1,absent:[]});
    h.$('generate').onclick();
    assert.deepEqual(roster.map(person=>person.name),['중복 (회원)','중복 (게스트)','A','B','C'],'the generated roster must use the picker-local duplicate-name labels');
  }
}

async function checkSettlementVersions(){
  const draft={id:'settle-me',version:7};
  {
    const calls=[],messages=[],refreshes=[];
    const endMatch=compile('endMatch',{saving:false,ending:false,currentDetail:()=>true,confirmDialog:async()=>true,message:(text,error)=>messages.push({text,error}),api:async(path,options)=>{calls.push({path,body:JSON.parse(options.body)});return {data:{version:8}};},EDITOR:'operator',crypto:{randomUUID:()=> 'operation'},routeToken:1,detail(){},window:{scrollTo(){}},refreshDetail:async(...args)=>refreshes.push(args)});
    await endMatch(draft,1);
    assert.deepEqual(calls,[{path:'/api/posts/settle-me/settle',body:{version:7,operation:'operation'}}],'settle must submit the version displayed to the operator, without a fresh GET');
    assert.equal(refreshes.length,0);
  }
  {
    const refreshes=[];
    const endMatch=compile('endMatch',{saving:false,ending:false,currentDetail:()=>true,confirmDialog:async()=>true,message(){},api:async()=>{throw Error('최신 대진표를 다시 불러온 뒤 점수를 반영해주세요.');},EDITOR:'operator',crypto:{randomUUID:()=> 'operation'},routeToken:1,detail(){},window:{scrollTo(){}},refreshDetail:async(...args)=>refreshes.push(args)});
    await endMatch(draft,1);
    assert.equal(refreshes.length,1,'a stale displayed settlement must refresh and require a new confirmation');
  }
  {
    const confirmation=deferred(),request=deferred(),calls=[];
    const unsettlePost=compile('unsettlePost',{saving:false,unsettling:false,currentDetail:()=>true,confirmDialog:()=>confirmation.promise,message(){},api:(path,options)=>{calls.push({path,body:JSON.parse(options.body)});return request.promise;},EDITOR:'operator',routeToken:1,detail(){},window:{scrollTo(){}},refreshDetail:async()=>{}});
    const first=unsettlePost(draft,1),second=unsettlePost(draft,1);
    confirmation.resolve(true);await Promise.resolve();
    assert.equal(calls.length,1,'double-clicking unsettle must keep one confirmation/request in flight');
    assert.deepEqual(calls[0],{path:'/api/posts/settle-me/unsettle',body:{version:7}});
    request.resolve({data:{version:8}});await first;await second;
  }
}

async function checkConfirmationLifecycle(){
  const h=dialogHarness(),confirmDialog=compile('confirmDialog',{$:h.$,dialog:h.dialog,esc});
  const navigated=confirmDialog('확인');h.dialog.close();assert.equal(await navigated,false,'route-driven dialog.close must resolve a pending confirmation as No');
  const no=confirmDialog('확인');h.$('confirmNo').onclick();assert.equal(await no,false,'No must resolve false');
  const yes=confirmDialog('확인');h.$('confirmYes').onclick();assert.equal(await yes,true,'Yes must resolve true before its close event');
  const escaped=confirmDialog('확인');h.dialog.dispatch('cancel');assert.equal(await escaped,false,'Escape must resolve false and close safely');

  const calls=[];
  const unsettlePost=compile('unsettlePost',{saving:false,unsettling:false,currentDetail:()=>true,confirmDialog,message(){},api:async(path,options)=>{calls.push({path,body:JSON.parse(options.body)});return {data:{version:8}};},EDITOR:'operator',routeToken:1,detail(){},window:{scrollTo(){}},refreshDetail:async()=>{}});
  const first=unsettlePost({id:'settle-me',version:7},1);h.dialog.close();await first;
  const retry=unsettlePost({id:'settle-me',version:7},1);h.$('confirmYes').onclick();await retry;
  assert.equal(calls.length,1,'closing a confirmation during navigation must release unsettle so a later visit can retry');
}

async function checkHistoryAndPeopleWrites(){
  {
    const h=dialogHarness(),request=deferred();
    const showHistory=compile('showHistory',{$:h.$,dialog:h.dialog,api:()=>request.promise,esc,date:()=>'',EDITOR:'operator'});
    const pending=showHistory({type:'member',id:'p1',name:'회원'});
    h.$('closePersonHistory').onclick();
    h.dialog.innerHTML='<form id="personEditForm"><button id="personEditSubmit"></button></form>';
    h.dialog.showModal();
    request.resolve({items:[]});
    await pending;
    assert.ok(h.$('personEditSubmit'),'a late history response must not overwrite a replacement dialog');
  }
  {
    const h=dialogHarness(),request=deferred(),calls=[];
    const addPerson=compile('addPerson',{$:h.$,dialog:h.dialog,api:(...args)=>{calls.push(args);return request.promise;},EDITOR:'operator',alert(){},message(){},refresh:async()=>{},type:'member'});
    addPerson();h.$('addName').value='새 회원';h.$('addPoints').value='80';
    const first=h.$('addConfirm').onclick();
    const second=h.$('addConfirm').onclick();
    assert.equal(calls.length,1,'double-clicking add may send only one request');
    request.resolve({});await first;await second;
  }
  {
    const h=dialogHarness(),request=deferred(),messages=[];
    const editPerson=compile('editPerson',{$:h.$,dialog:h.dialog,api:()=>request.promise,EDITOR:'operator',message:text=>messages.push(text),refresh:async()=>{messages.push('refresh');},esc});
    editPerson({type:'member',id:'p1',edit_version:1,name:'회원',points:80});
    h.$('personEditReason').value='정정';
    const pending=h.$('personEditForm').onsubmit({preventDefault(){}});
    h.dialog.close();h.dialog.innerHTML='<div id="replacement"></div>';h.dialog.showModal();
    request.resolve({});await pending;
    assert.ok(h.$('replacement'),'a navigated-away edit must not close a newer dialog');
    assert.deepEqual(messages,[],'a navigated-away edit must not repaint the former ranking page');
  }
}

export async function runClientAuditChecks(){
  await checkLoginCancellation();
  await checkEncodedNoticeNavigation();
  await checkPickerCancelIsolation();
  await checkPickerLocalNamesAndNavigation();
  await checkSettlementVersions();
  await checkConfirmationLifecycle();
  await checkHistoryAndPeopleWrites();
  console.log('PASS: actual client factories cover notice navigation, confirmation lifecycle, canceled login, local picker state, settlement versions, and people dialogs.');
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){await runClientAuditChecks();await runProgressUIChecks();await runLiveUIChecks();}
