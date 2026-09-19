import assert from 'node:assert/strict';
import { createLiveView } from './dist/server/live-client.js';

const clone=value=>structuredClone(value);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const court=names=>({names,state:names.every(Boolean)?'playing':'waiting'});
const now=()=>new Date().toISOString();
const person=(name,seconds=0)=>({name,waitingSince:new Date(Date.now()-seconds*1000).toISOString()});
const fixture=()=>({version:1,isOpen:true,courts:[court(['A','B','C',''])],queue:[],participants:[person('A',30),person('B',25),person('C',20),person('D',15)],serverNow:now()});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};

// Minimal DOM boundary for the actual browser factory. innerHTML replaces children.
function element(tag='div',attrs={},onPaint=()=>{}){
  let html='',children=[];const listeners=new Map();
  const node={tag,attrs,dataset:{},value:'',textContent:'',disabled:Object.hasOwn(attrs,'disabled'),removed:false,open:false,options:[],focus(){},showModal(){this.open=true;},close(){this.open=false;},remove(){this.removed=true;},addEventListener(type,handler){listeners.set(type,handler);},dispatch(type){listeners.get(type)?.({preventDefault(){}});},querySelector(selector){return this.querySelectorAll(selector)[0]||null;},querySelectorAll(selector){return children.filter(child=>selector.startsWith('#')?child.attrs.id===selector.slice(1):selector.startsWith('.')?String(child.attrs.class||'').split(/\s+/).includes(selector.slice(1)):selector.startsWith('[')?Object.hasOwn(child.attrs,selector.slice(1,-1)):child.tag===selector);}};
  for(const [key,value] of Object.entries(attrs))if(key.startsWith('data-'))node.dataset[key.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=value;
  Object.defineProperty(node,'innerHTML',{get:()=>html,set(value){html=String(value);children=[];onPaint();if(tag==='select'){const options=[...html.matchAll(/<option value="([^"]*)"([^>]*)>/g)];node.options=options.map(match=>match[1]);node.value=options.find(match=>/\bselected\b/.test(match[2]))?.[1]||node.options[0]||'';return;}for(const match of html.matchAll(/<(button|input|select|form|p|time)\b([^>]*)>/g)){const attributes={};for(const attr of match[2].matchAll(/([\w-]+)(?:="([^"]*)")?/g))attributes[attr[1]]=attr[2]??'';const child=element(match[1],attributes),content=html.slice(match.index+match[0].length).split('</'+child.tag+'>')[0];child.textContent=content.replace(/<[^>]*>/g,'');if(child.tag==='select')child.innerHTML=content;children.push(child);}}});
  return node;
}
function harness(initial=fixture(),editor='',start=Date.now(),confirmAnswer=true){
  let server=clone(initial),paints=0,nextTimer=0,routeToken=1,clock=start;const timers=new Map(),calls=[],messages=[],dialogs=[],app=element('main',{},()=>paints++);let apiImpl=async()=>({data:clone(server)});
  const api=(path,options)=>{calls.push({path,method:options?.method||'GET',body:options?.body?JSON.parse(options.body):null,headers:options?.headers});return apiImpl(path,options);};
  const document={createElement:tag=>element(tag),body:{append(dialog){dialogs.push(dialog);}}};
  const view=new Function('options','document','setInterval','clearInterval','confirm','prompt','Date','return ('+createLiveView.toString()+')(options);')({app,api,esc,EDITOR:editor,message:(text,error)=>messages.push({text,error}),isCurrent:token=>token===routeToken},document,callback=>{const id=++nextTimer;timers.set(id,callback);return id;},id=>timers.delete(id),()=>confirmAnswer,()=>null,{now:()=>clock,parse:Date.parse});
  return {app,view,timers,calls,messages,dialogs,get paints(){return paints;},get server(){return clone(server);},get time(){return clock;},set server(value){server=clone(value);},setAPI(fn){apiImpl=fn;},async open(){await view.open(routeToken);},join(){const button=app.querySelector('#liveJoin');assert.ok(button&&!button.disabled);button.dispatch('click');return dialogs.at(-1);},register(){const button=app.querySelector('#liveRegister');assert.ok(button&&!button.disabled);button.dispatch('click');return dialogs.at(-1);},submit(dialog){return dialog.querySelector('form').onsubmit({preventDefault(){}});},async tick(seconds=1){for(let index=0;index<seconds;index++){clock+=1000;await [...timers.values()][0]();}},leavePage(){routeToken++;view.stop();app.innerHTML='Other page';}};
}

export async function runLiveUIChecks(){
  {
    const closed={version:0,isOpen:false,courts:[],queue:[],participants:[],serverNow:now()};const h=harness(closed);await h.open();
    assert.equal(h.app.querySelector('#liveRegister'),null);assert.equal(h.app.querySelector('#liveJoin'),null);assert.ok(h.app.innerHTML.includes('운영진이 실시간대진을 열면 입장할 수 있어요.'));h.view.stop();
  }
  {
    const h=harness();await h.open();assert.ok(h.app.querySelector('#liveRegister'),'open session exposes public registration even with no editor');
    const dialog=h.register(),fields=dialog.querySelectorAll('.live-register-name');assert.equal(fields.length,4,'registration accepts one to four free-text names');fields[0].value='새 회원';fields[1].value='둘째';
    const updated={...fixture(),version:2,participants:[...fixture().participants,person('새 회원',0),person('둘째',0)],serverNow:now()};h.setAPI(async()=>({data:updated}));await h.submit(dialog);
    assert.deepEqual(h.calls.find(call=>call.method==='POST').body,{version:1,action:'register',names:['새 회원','둘째']});assert.equal(h.calls.find(call=>call.method==='POST').headers['x-kokkiri-editor'],undefined);assert.equal(dialog.removed,true);assert.ok(h.app.innerHTML.includes('새 회원'));h.view.stop();
  }
  {
    const h=harness();await h.open();const dialog=h.register();dialog.querySelector('.live-register-name').value='A';h.setAPI(async(path,options)=>{if(options?.method==='POST')throw Error('이미 참가 명단에 등록된 이름입니다.');return {data:h.server};});await h.submit(dialog);
    assert.equal(dialog.removed,false);assert.equal(dialog.querySelector('#liveRegisterError').textContent,'이미 참가 명단에 등록된 이름입니다.');assert.equal(dialog.querySelector('#liveRegisterSave').disabled,false);h.view.stop();
  }
  {
    const state={version:1,isOpen:true,courts:[court(['A','B','C','D'])],queue:[],participants:['A','B','C','D','E','F','G','H','I'].map((name,index)=>person(name,60-index)),serverNow:now()};
    const h=harness(state);await h.open();assert.ok(h.app.innerHTML.includes('대기중인 회원'),'waiting section renders even when queue data exists');assert.ok(h.app.innerHTML.indexOf('A')<h.app.innerHTML.indexOf('E'),'longest waiting member is ordered first');
    const dialog=h.join();assert.equal(dialog.querySelectorAll('.live-selection-slot').length,4,'join always has four fixed selection slots');assert.equal(dialog.querySelectorAll('.live-join-select').length,0,'name dropdowns are removed');assert.equal(dialog.querySelectorAll('[data-live-member-index]').length,5,'only registered unassigned names are clickable');
    dialog.querySelectorAll('[data-live-member-index]')[0].onclick();dialog.querySelectorAll('[data-live-member-index]')[1].onclick();assert.ok(dialog.querySelectorAll('.live-selection-slot')[0].attrs.class.includes('is-filled'),'name buttons add people to the slots');dialog.querySelectorAll('[data-live-selection-slot]')[0].onclick();dialog.querySelectorAll('[data-live-member-index]')[0].onclick();dialog.querySelectorAll('[data-live-member-index]')[2].onclick();dialog.querySelectorAll('[data-live-member-index]')[3].onclick();dialog.querySelectorAll('[data-live-member-index]')[4].onclick();
    assert.equal(dialog.querySelector('#liveJoinError').textContent,'최대 4명까지 선택할 수 있습니다.','a fifth name is rejected without duplicate selection');const joined={...state,version:2,queue:[{names:['E','F','G','H']}],serverNow:now()};h.setAPI(async()=>({data:joined}));await h.submit(dialog);assert.deepEqual(h.calls.find(call=>call.method==='POST').body,{version:1,action:'join',court:'queue',names:['E','F','G','H']},'one to four selected names submit as one exact batch');h.view.stop();
  }
  {
    const state={version:1,isOpen:true,courts:[court(['A','B','C','D']),court(['E','','',''])],queue:[],participants:[person('A',100),person('B',90),person('C',80),person('D',70),person('E',60),person('F',50)],serverNow:now()};const h=harness(state);await h.open();
    assert.ok(!h.app.innerHTML.includes('live-waiting-name">A'),'playing names are hidden from the waiting list');assert.ok(h.app.innerHTML.includes('live-waiting-name">E'),'partial-court names remain waiting');assert.equal(h.app.querySelector('[data-live-add-court]'),null,'court cards no longer have an inline add button');assert.equal(h.app.querySelector('[data-live-add-queue]'),null,'queue cards no longer have an inline add button');const dialog=h.join();dialog.querySelector('#liveJoinCourt').value='1';dialog.querySelector('#liveJoinCourt').onchange();dialog.querySelector('[data-live-member-index]').onclick();h.setAPI(async()=>({data:{...state,version:2,courts:[court(['A','B','C','D']),court(['E','F','',''])],serverNow:now()}}));await h.submit(dialog);assert.deepEqual(h.calls.find(call=>call.method==='POST').body,{version:1,action:'join',court:1,names:['F']},'the main join flow fills a partial court without a slot field');h.view.stop();
  }
  {
    const start=1700000000000,stamp=offset=>new Date(start+offset).toISOString(),state={version:1,isOpen:true,courts:[court(['A','B','C','D'])],queue:[],participants:['A','B','C','D'].map(name=>({name,waitingSince:stamp(-100000)})).concat({name:'E',waitingSince:stamp(-65000)}),serverNow:stamp(0)};const h=harness(state,'',start);await h.open();const paints=h.paints,timer=h.app.querySelector('[data-live-wait-since]');assert.equal(timer.textContent,'01:05','server clock offset gives an exact elapsed value independent of the machine clock');await h.tick(4);assert.equal(timer.textContent,'01:09','the one-second timer progresses elapsed text exactly');assert.equal(h.paints,paints,'one-second clock changes text nodes without rerendering');assert.equal(h.timers.size,1,'clock and polling share one timer');
    await h.tick();assert.equal(timer.textContent,'01:10','a reload with the same waitingSince never resets elapsed time');const end=h.app.querySelector('[data-live-end]');h.setAPI(async()=>({data:{version:2,isOpen:true,courts:[court(['E','F','G','H'])],queue:[],participants:[person('A',0),person('B',0),person('C',0),person('D',0),person('E',60),person('F',60),person('G',60),person('H',60)],serverNow:now()}}));await end.onclick();assert.deepEqual(h.calls.find(call=>call.method==='POST').body,{version:1,action:'end',court:0});assert.ok(h.app.innerHTML.includes('live-waiting-name">A'),'ended players return to waiting');assert.ok(!h.app.innerHTML.includes('live-waiting-name">E'),'new playing player remains hidden');h.view.stop();
  }
  {
    const h=harness();await h.open();const dialog=h.join();dialog.querySelector('[data-live-member-index]').onclick();h.server={...fixture(),version:2,participants:[person('A'),person('B'),person('C'),person('다른 회원')],serverNow:now()};h.setAPI(async(path,options)=>{if(options?.method==='POST')throw Error('다른 사람이 먼저 변경했어요. 최신 코트를 확인한 뒤 다시 입력해주세요.');return {data:h.server};});await h.submit(dialog);
    assert.equal(h.calls.filter(call=>call.method==='POST').length,1,'conflict never silently resubmits');assert.equal(dialog.removed,false);assert.ok(dialog.querySelector('#liveJoinError').textContent.includes('다시'));assert.ok(dialog.innerHTML.includes('다른 회원'),'conflict refreshes registered choices');assert.ok(!dialog.querySelectorAll('.live-selection-slot')[0].attrs.class.includes('is-filled'),'fresh conflict data removes a newly unavailable selected person');h.view.stop();
  }
  {
    const state={version:1,isOpen:true,courts:[court(['A','B','','']),court(['C','D','',''])],queue:[],participants:['A','B','C','D','E','F'].map(name=>person(name)),serverNow:now()},h=harness(state);await h.open();const dialog=h.join(),destination=dialog.querySelector('#liveJoinCourt');destination.value='1';destination.onchange();dialog.querySelector('[data-live-member-index]').onclick();h.server={...state,version:2,serverNow:now()};h.setAPI(async(path,options)=>{if(options?.method==='POST')throw Error('최신 정보를 확인하세요.');return {data:h.server};});await h.submit(dialog);
    assert.equal(dialog.querySelector('#liveJoinCourt').value,'1','a conflict keeps the chosen court when it is still available');assert.ok(dialog.querySelectorAll('.live-selection-slot')[0].attrs.class.includes('is-filled'),'a still-unassigned selected person stays selected after refresh');h.view.stop();
  }
  {
    const h=harness();await h.open();const dialog=h.join();dialog.querySelector('[data-live-member-index]').onclick();h.setAPI(async(path,options)=>{if(options?.method==='POST')throw Error('참가 명단에 먼저 등록한 회원만 선택할 수 있습니다.');return {data:h.server};});await h.submit(dialog);assert.equal(dialog.removed,false);assert.equal(dialog.querySelector('#liveJoinError').textContent,'참가 명단에 먼저 등록한 회원만 선택할 수 있습니다.');h.view.stop();
  }
  {
    const initial={version:1,isOpen:false,courts:[],queue:[],participants:[person('A')],serverNow:now()};const h=harness(initial,'operator-key');await h.open();h.app.querySelector('#liveToggle').dispatch('click');const dialog=h.dialogs.at(-1);h.setAPI(async(path,options)=>options?.method==='POST'?{data:{...initial,version:2,isOpen:true,serverNow:now()}}:{data:initial});await dialog.querySelector('#liveToggleYes').onclick();assert.deepEqual(h.calls.find(call=>call.method==='POST').body,{version:1,action:'open'});assert.equal(h.calls.find(call=>call.method==='POST').headers['x-kokkiri-editor'],'operator-key');assert.ok(h.app.querySelector('#liveRegister'),'opening retains the public registry and registration control');h.view.stop();
  }
  {
    const initial={version:1,isOpen:true,courts:[court(['A','B','C','D'])],queue:[{names:['E','F','','']}],participants:['A','B','C','D','E','F'].map(name=>person(name,60)),serverNow:now()};const h=harness(initial,'operator-key',Date.now(),false);await h.open();h.app.querySelector('#liveToggle').dispatch('click');const dialog=h.dialogs.at(-1);
    assert.ok(dialog.innerHTML.includes('실시간대진을 종료하시겠습니까?'));assert.ok(dialog.innerHTML.includes('현재 코트, 대기중인 대진, 등록된 참가자와 대기 시간이 모두 삭제됩니다.'));assert.ok(dialog.innerHTML.includes('점수 정산 명단은 삭제되지 않습니다.'));dialog.querySelector('#liveToggleNo').onclick();
    assert.equal(dialog.removed,true,'No cancels close without writing');assert.equal(h.calls.filter(call=>call.method==='POST').length,0);assert.ok(h.app.innerHTML.includes('A')&&h.app.innerHTML.includes('E'),'cancel preserves the live session');h.view.stop();
  }
  {
    const initial={version:4,isOpen:true,courts:[court(['A','B','C','D'])],queue:[{names:['E','F','','']}],participants:['A','B','C','D','E','F','G'].map(name=>person(name,60)),serverNow:now()};const closed={version:5,isOpen:false,courts:[],queue:[],participants:[],serverNow:now()};const h=harness(initial,'operator-key');await h.open();h.app.querySelector('#liveToggle').dispatch('click');const dialog=h.dialogs.at(-1);h.setAPI(async(path,options)=>options?.method==='POST'?{data:closed}:{data:h.server});await dialog.querySelector('#liveToggleYes').onclick();
    const post=h.calls.find(call=>call.method==='POST');assert.deepEqual(post.body,{version:4,action:'close'});assert.equal(post.headers['x-kokkiri-editor'],'operator-key');assert.ok(!h.app.innerHTML.includes('A')&&!h.app.innerHTML.includes('E')&&!h.app.innerHTML.includes('live-queue')&&!h.app.innerHTML.includes('live-waiting-time'),'close response renders no courts, queue, registered names, or clocks');
    h.setAPI(async()=>({data:{version:6,isOpen:true,courts:[court(['','','',''])],queue:[],participants:[person('새 회원')],serverNow:now()}}));h.app.querySelector('#liveToggle').dispatch('click');const reopen=h.dialogs.at(-1);await reopen.querySelector('#liveToggleYes').onclick();assert.ok(!h.app.innerHTML.includes('A')&&!h.app.innerHTML.includes('E')&&h.app.innerHTML.includes('새 회원'),'reopening starts without old live participants');h.view.stop();
  }
  {
    const h=harness();await h.open();const dialog=h.register(),read=deferred();h.setAPI(()=>read.promise);const poll=h.tick(5);read.resolve({data:{version:2,isOpen:false,courts:[],queue:[],participants:h.server.participants,serverNow:now()}});await poll;assert.equal(dialog.removed,true,'remote close clears a registration dialog');assert.equal(h.app.querySelector('#liveRegister'),null);h.leavePage();assert.equal(h.timers.size,0,'navigation cleanup clears the shared timer');
  }
  {
    const h=harness(fixture(),'operator-key'),read=deferred();await h.open();h.app.querySelector('#liveToggle').dispatch('click');const dialog=h.dialogs.at(-1);h.setAPI(()=>read.promise);const poll=h.tick(5);read.resolve({data:{version:2,isOpen:false,courts:[],queue:[],participants:[],serverNow:now()}});await poll;assert.equal(dialog.removed,true,'remote close clears an operator toggle dialog');assert.equal(h.app.querySelector('#liveToggle').textContent,'실시간대진 열기');assert.ok(!h.app.innerHTML.includes('A')&&!h.app.innerHTML.includes('live-waiting-time'));h.view.stop();
  }
  {
    const h=harness();await h.open();const dialog=h.register(),input=dialog.querySelector('.live-register-name');input.value='한글 입력';input.dispatch('compositionstart');await h.submit(dialog);assert.equal(h.calls.filter(call=>call.method==='POST').length,0,'Korean IME composition cannot submit a partial registration');input.dispatch('compositionend');h.setAPI(async(path,options)=>{if(options?.method==='POST')throw Error('최신 정보를 확인하세요.');throw Error('새로고침 실패');});await h.submit(dialog);assert.equal(dialog.querySelector('#liveRegisterError').textContent,'새로고침 실패','failed conflict refresh preserves the dialog without shadowing its error helper');assert.equal(dialog.querySelector('#liveRegisterSave').disabled,false);h.view.stop();
  }
  {
    const state={version:1,isOpen:true,courts:[court(['A','','',''])],queue:[],participants:[person('A'),person('B')],serverNow:now()};const h=harness(state);await h.open();h.app.querySelector('[data-live-cancel-court]').onclick();const dialog=h.dialogs.at(-1);h.server={...state,version:2,courts:[],serverNow:now()};h.setAPI(async(path,options)=>{if(options?.method==='POST')throw Error('최신 정보를 확인하세요.');return {data:h.server};});await dialog.querySelector('#liveCancelYes').onclick();assert.equal(dialog.removed,true,'a cancel conflict closes its stale confirmation');assert.ok(h.app.innerHTML.includes('아직 만든 코트가 없습니다.'));assert.equal(h.calls.filter(call=>call.method==='POST').length,1);h.view.stop();
  }
  {
    const h=harness(),read=deferred(),post=deferred();await h.open();h.setAPI((path,options)=>options?.method==='POST'?post.promise:read.promise);const polling=h.tick(5),dialog=h.join();dialog.querySelector('[data-live-member-index]').onclick();const submitting=h.submit(dialog);post.resolve({data:{...fixture(),version:2,courts:[court(['A','B','C','D'])],serverNow:now()}});await submitting;read.resolve({data:fixture()});await polling;assert.ok(h.app.innerHTML.includes('1번 코트 4번 참가자 D'),'an acknowledged POST cannot be rolled back by an older GET');h.view.stop();
  }
  {
    const h=harness(),post=deferred();await h.open();h.setAPI(()=>post.promise);const dialog=h.join();dialog.querySelector('[data-live-member-index]').onclick();const submitting=h.submit(dialog);dialog.querySelector('#liveJoinCancel').onclick();post.resolve({data:{...fixture(),version:2,courts:[court(['A','B','C','D'])],serverNow:now()}});await submitting;assert.equal(dialog.removed,true);assert.equal(h.dialogs.length,1,'a canceled dialog never reopens after its late write');h.leavePage();assert.equal(h.timers.size,0,'navigation during public UI activity clears all timers');
  }
  {
    const h=harness(),read=deferred();await h.open();h.setAPI(()=>read.promise);const polling=h.tick(5),dialog=h.join();read.resolve({data:{version:2,isOpen:false,courts:[],queue:[],participants:h.server.participants,serverNow:now()}});await polling;assert.equal(dialog.removed,true,'remote close also dismisses an in-progress select-join dialog');assert.equal(h.app.querySelector('#liveJoin'),null);h.view.stop();
  }
  {
    const serverStart=1700000000000,machineStart=serverStart+3600000;
    const state={version:1,isOpen:true,courts:[court(['','','',''])],queue:[],participants:[{name:'시간 검증',waitingSince:new Date(serverStart-3661000).toISOString()}],serverNow:new Date(serverStart).toISOString()};
    const h=harness(state,'',machineStart);await h.open();
    assert.equal(h.app.querySelector('[data-live-wait-since]').textContent,'61:01','clock corrects a one-hour machine offset and keeps minutes above 59');
    h.setAPI(async()=>({data:{...state,serverNow:new Date(serverStart+h.time-machineStart).toISOString()}}));
    await h.tick(6);
    assert.equal(h.app.querySelector('[data-live-wait-since]').textContent,'61:07','five-second synchronization preserves the running clock');
    await h.open();
    assert.equal(h.app.querySelector('[data-live-wait-since]').textContent,'61:07','reopening the view keeps the persisted start time');
    assert.equal(h.timers.size,1);assert.equal(h.calls.filter(call=>call.method==='POST').length,0,'clock ticking and reloading never write to DB');h.view.stop();
  }
  for(const oldKind of ['register','join']){
    const initial={version:1,isOpen:true,courts:[court(['A','B','C','D'])],queue:[{names:['E','','','']},{names:['F','','','']}],participants:['A','B','C','D','E','F','G'].map(name=>person(name,60)),serverNow:now()};
    const newer={...initial,version:2,queue:[{names:['F','','','']}],serverNow:now()};
    const h=harness(initial),late=deferred(),readStarted=deferred();let reads=0;
    await h.open();
    h.setAPI(async(path,options)=>{
      if(options?.method==='POST')throw Error('다른 사람이 먼저 변경했어요. 최신 코트를 확인한 뒤 다시 입력해주세요.');
      if(++reads===1){readStarted.resolve();return late.promise;}
      return {data:newer};
    });
    const oldDialog=oldKind==='register'?h.register():h.join();
    if(oldKind==='register')oldDialog.querySelector('.live-register-name').value='H';else oldDialog.querySelector('[data-live-member-index]').onclick();
    const pending=h.submit(oldDialog);await readStarted.promise;
    oldDialog.querySelector(oldKind==='register'?'#liveRegisterCancel':'#liveJoinCancel').onclick();
    const next=h.join();next.querySelector('[data-live-member-index]').onclick();
    late.resolve({data:newer});await pending;
    assert.equal(next.removed,false,'the canceled form refresh cannot close or mutate a new form');
    await h.submit(next);
    const posts=h.calls.filter(call=>call.method==='POST');
    assert.equal(posts.length,2,'there is no automatic repost into a shifted queue');
    assert.deepEqual(posts[1].body,{version:1,action:'join',court:'queue',names:['G'],group:0},'new form keeps its original version so CAS rejects its now-shifted queue');
    assert.equal(next.removed,false,'a stale canceled form cannot close the newer main join dialog');
    h.view.stop();
  }
  console.log('PASS: actual live-view factory covers registration, four-slot registered-member joins, waiting clocks/destinations, end return, conflicts, canceled-form refresh ownership, session transitions and cleanup.');
}
