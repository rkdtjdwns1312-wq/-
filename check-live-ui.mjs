import assert from 'node:assert/strict';
import { createLiveView } from './dist/server/live-client.js';

const clone=value=>structuredClone(value);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const court=names=>({names,state:names.every(Boolean)?'playing':'waiting'});
const fixture=()=>({version:1,isOpen:true,courts:[court(['A','B','C',''])],queue:[],updatedAt:null});
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}

// Minimal DOM boundaries for the real factory. No live requests or real timers.
// Every innerHTML assignment replaces child identities, as a browser would.
function element(tag='div',attrs={},onPaint=()=>{}){
  let html='',children=[];
  const listeners=new Map();
  const node={tag,attrs,dataset:{},value:'',textContent:'',disabled:Object.hasOwn(attrs,'disabled'),removed:false,open:false,options:[],
    focus(){},showModal(){this.open=true;},close(){this.open=false;},remove(){this.removed=true;},
    addEventListener(type,handler){listeners.set(type,handler);},
    dispatch(type){listeners.get(type)?.({preventDefault(){}});},
    querySelector(selector){return this.querySelectorAll(selector)[0]||null;},
    querySelectorAll(selector){return children.filter(child=>selector.startsWith('#')?child.attrs.id===selector.slice(1):selector.startsWith('.')?String(child.attrs.class||'').split(/\s+/).includes(selector.slice(1)):selector.startsWith('[')?Object.hasOwn(child.attrs,selector.slice(1,-1)):child.tag===selector);}
  };
  for(const [key,value] of Object.entries(attrs))if(key.startsWith('data-'))node.dataset[key.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=value;
  Object.defineProperty(node,'innerHTML',{get:()=>html,set(value){
    html=String(value);children=[];onPaint();
    if(tag==='select'){
      node.options=[...html.matchAll(/<option value="([^"]*)">/g)].map(m=>m[1]);
      node.value=node.options[0]||'';return;
    }
    for(const match of html.matchAll(/<(button|input|select|form|p)\b([^>]*)>/g)){
      const attributes={};
      for(const attr of match[2].matchAll(/([\w-]+)(?:="([^"]*)")?/g))attributes[attr[1]]=attr[2]??'';
      const child=element(match[1],attributes);
      if(child.tag==='select')child.innerHTML=html.slice(match.index+match[0].length).split('</select>')[0];
      children.push(child);
    }
  }});
  return node;
}
function harness(initial=fixture(),editor=''){
  let server=clone(initial),paints=0,nextTimer=0,routeToken=1;
  const timers=new Map(),calls=[],messages=[],dialogs=[],app=element('main',{},()=>paints++);
  let apiImpl=async()=>({data:clone(server)});
  const api=(path,options)=>{
    calls.push({path,method:options?.method||'GET',body:options?.body?JSON.parse(options.body):null,headers:options?.headers});
    return apiImpl(path,options);
  };
  const document={createElement:tag=>element(tag),body:{append(dialog){dialogs.push(dialog);}}};
  const instantiate=new Function('options','document','setInterval','clearInterval','confirm','prompt','return ('+createLiveView.toString()+')(options);');
  const view=instantiate({app,api,esc,EDITOR:editor,message:(text,error)=>messages.push({text,error}),isCurrent:token=>token===routeToken},document,
    callback=>{const id=++nextTimer;timers.set(id,callback);return id;},id=>timers.delete(id),()=>true,()=>null);
  return {
    app,view,timers,calls,messages,dialogs,
    get paints(){return paints;},get server(){return clone(server);},set server(value){server=clone(value);},
    setAPI(fn){apiImpl=fn;},getAPI(){return apiImpl;},
    async open(){await view.open(routeToken);},
    join(){const button=app.querySelector('#liveJoin');assert.ok(button&&!button.disabled);button.onclick();return dialogs.at(-1);},
    submit(dialog){return dialog.querySelector('form').onsubmit({preventDefault(){}});},
    cancel(dialog){dialog.querySelector('#liveJoinCancel').onclick();},
    async tick(){assert.equal(timers.size,1,'expected a single active poll');await [...timers.values()][0]();},
    leavePage(){routeToken++;view.stop();app.innerHTML='Other page';}
  };
}

export async function runLiveUIChecks(){
  {
    const h=harness({version:0,isOpen:false,courts:[],queue:[],updatedAt:null});await h.open();
    assert.ok(h.app.innerHTML.includes('운영진이 실시간대진을 열면 입장할 수 있어요.'));
    assert.equal(h.app.querySelector('#liveJoin'),null,'legacy or missing isOpen defaults to a closed public view');
    h.view.stop();
  }
  {
    const state=fixture();state.queue=[{names:['E','F','G','H']}];
    const h=harness(state);await h.open();
    assert.equal(h.app.querySelectorAll('input').length,0,'no direct slot editing');
    assert.equal(h.app.querySelectorAll('[data-live-end]').length,0,'a three-person court cannot end');
    const dialog=h.join(),select=dialog.querySelector('#liveJoinCourt');
    assert.deepEqual(select.options,['0','queue'],'a partially promoted court remains selectable ahead of the queue');
    assert.equal(select.value,'0');
    h.cancel(dialog);h.view.stop();
  }
  {
    const initial={...fixture(),courts:[court(['OldA','OldB','OldC','OldD'])]};
    const h=harness(initial);await h.open();
    const dialog=h.join(),input=dialog.querySelector('#liveJoinName');input.value='입력 보존';
    h.server={...initial,version:2,courts:[court(['NewA','NewB','NewC','NewD'])]};
    h.setAPI(async(path,options)=>{
      if(options?.method==='POST')throw Error('다른 사람이 먼저 변경했어요. 최신 코트를 확인한 뒤 다시 입력해주세요.');
      return {data:h.server};
    });
    await h.submit(dialog);
    assert.equal(input.value,'입력 보존');assert.equal(dialog.removed,false);
    assert.equal(dialog.querySelector('#liveJoinSave').disabled,false);
    assert.ok(dialog.querySelector('#liveJoinError').textContent.includes('다시'));
    h.cancel(dialog);
    assert.ok(h.app.innerHTML.includes('NewA'),'cancel after conflict immediately paints the refreshed model');
    assert.ok(!h.app.innerHTML.includes('OldA'));
    const paints=h.paints,joinButton=h.app.querySelector('#liveJoin');
    await h.tick();await h.tick();
    assert.equal(h.paints,paints,'unchanged polls preserve DOM identity');
    assert.equal(h.app.querySelector('#liveJoin'),joinButton);
    h.view.stop();
  }
  {
    const h=harness();await h.open();
    const dialog=h.join(),input=dialog.querySelector('#liveJoinName');input.value='검증 이름';
    input.dispatch('compositionstart');await h.submit(dialog);
    assert.ok(h.calls.every(call=>call.method==='GET'),'IME composition cannot submit prematurely');
    input.dispatch('compositionend');h.setAPI(async()=>{throw Error('등록 연결 실패');});
    await h.submit(dialog);
    assert.equal(input.value,'검증 이름');assert.equal(dialog.removed,false);
    assert.equal(dialog.querySelector('#liveJoinError').textContent,'등록 연결 실패');
    assert.equal(dialog.querySelector('#liveJoinSave').disabled,false);
    h.view.stop();
  }
  {
    const h=harness();await h.open();const read=deferred();
    h.setAPI(()=>read.promise);const poll=h.tick();
    const dialog=h.join(),input=dialog.querySelector('#liveJoinName');input.value='작성 중';
    const paints=h.paints;
    read.resolve({data:{...fixture(),version:2,courts:[court(['OtherA','OtherB','OtherC','OtherD'])]}});await poll;
    assert.equal(h.paints,paints,'a poll started before opening the dialog cannot repaint it');
    assert.equal(input.value,'작성 중');assert.deepEqual(dialog.querySelector('#liveJoinCourt').options,['0']);
    h.view.stop();
  }
  {
    const h=harness();await h.open();const read=deferred(),post=deferred();
    h.setAPI((path,options)=>options?.method==='POST'?post.promise:read.promise);
    const poll=h.tick(),dialog=h.join();dialog.querySelector('#liveJoinName').value='NewD';
    const submitting=h.submit(dialog);await h.submit(dialog);
    assert.equal(h.calls.filter(call=>call.method==='POST').length,1,'double submission sends one write');
    assert.equal(dialog.querySelector('#liveJoinSave').disabled,true);
    const registered={...fixture(),version:2,courts:[court(['A','B','C','NewD'])]};
    post.resolve({data:registered});await submitting;
    assert.equal(dialog.removed,true);assert.ok(h.app.innerHTML.includes('NewD'));
    const paints=h.paints;
    read.resolve({data:fixture()});await poll;
    assert.equal(h.paints,paints,'older GET completing after POST cannot restore old players');
    assert.ok(h.app.innerHTML.includes('NewD'));
    const write=h.calls.find(call=>call.method==='POST');
    assert.deepEqual(write.body,{version:1,action:'join',court:0,name:'NewD'});
    assert.equal(write.headers['x-kokkiri-editor'],undefined,'ordinary members can use the modal');
    h.view.stop();
  }
  {
    const h=harness();await h.open();const reads=[deferred(),deferred()];let count=0;
    h.setAPI(()=>reads[count++].promise);
    const older=h.tick(),newer=h.tick();
    reads[1].resolve({data:{...fixture(),version:3,courts:[court(['Newest','B','C',''])]}});await newer;
    const paints=h.paints;
    reads[0].resolve({data:{...fixture(),version:2,courts:[court(['Older','B','C',''])]}});await older;
    assert.equal(h.paints,paints);assert.ok(h.app.innerHTML.includes('Newest'));
    h.view.stop();
  }
  {
    const initial={version:1,isOpen:true,courts:[court(['A','B','C','D'])],queue:[{names:['E','F','G','H']},{names:['I','J','K','L']}]};
    const h=harness(initial);await h.open();
    assert.equal(h.app.querySelectorAll('[data-live-end]').length,1);
    assert.ok(!/\bVS\b|data-winner|win-pick/.test(h.app.innerHTML),'no VS or win controls in free play');
    const post=deferred();h.setAPI(()=>post.promise);
    const button=h.app.querySelector('[data-live-end]'),ending=button.onclick();await button.onclick();
    assert.equal(h.calls.filter(call=>call.method==='POST').length,1,'double end cannot advance two groups');
    post.resolve({data:{version:2,isOpen:true,courts:[court(['E','F','G','H'])],queue:[{names:['I','J','K','L']}]}});await ending;
    assert.deepEqual(h.calls.find(call=>call.method==='POST').body,{version:1,action:'end',court:0});
    assert.ok(h.app.innerHTML.includes('1번 코트 1번 참가자 E'));
    assert.ok(!h.app.innerHTML.includes('1번 코트 1번 참가자 A'));
    assert.ok(h.app.innerHTML.includes('대기중인 대진 1')&&!h.app.innerHTML.includes('대기중인 대진 2'));
    h.view.stop();
  }
  {
    const h=harness();await h.open();const read=deferred();h.setAPI(()=>read.promise);
    const poll=h.tick();h.leavePage();
    read.resolve({data:{...fixture(),version:2}});await poll;
    assert.equal(h.app.innerHTML,'Other page');assert.equal(h.timers.size,0);
  }
  {
    const h=harness();await h.open();const post=deferred();h.setAPI(()=>post.promise);
    const dialog=h.join();dialog.querySelector('#liveJoinName').value='이동 중';
    const pending=h.submit(dialog);h.leavePage();
    post.resolve({data:{...fixture(),version:2}});await pending;
    assert.equal(h.app.innerHTML,'Other page');assert.equal(dialog.removed,true);assert.equal(h.timers.size,0);
  }
  {
    const closed={version:1,isOpen:false,courts:[],queue:[],updatedAt:null};
    const member=harness(closed);await member.open();
    assert.equal(member.app.querySelector('#liveToggle'),null,'public users never receive an operator toggle');
    assert.equal(member.app.querySelector('#liveCreate'),null);
    assert.ok(member.app.innerHTML.includes('운영진이 실시간대진을 열면 입장할 수 있어요.'));
    member.view.stop();

    const operator=harness(closed,'operator-key');await operator.open();
    assert.equal(operator.calls[0].headers['x-kokkiri-editor'],'operator-key','operator reads retained closed data with the editor header');
    const toggle=operator.app.querySelector('#liveToggle');assert.ok(toggle);
    toggle.onclick();let dialog=operator.dialogs.at(-1);
    assert.ok(dialog.innerHTML.includes('실시간대진을 시작하시겠습니까?'));
    dialog.querySelector('#liveToggleNo').onclick();
    assert.equal(operator.calls.filter(call=>call.method==='POST').length,0,'no confirmation never writes');
    operator.app.querySelector('#liveToggle').onclick();dialog=operator.dialogs.at(-1);
    const reopened={version:2,isOpen:true,courts:[],queue:[],updatedAt:null};
    operator.setAPI(async(path,options)=>options?.method==='POST'?{data:reopened}:{data:closed});
    await dialog.querySelector('#liveToggleYes').onclick();
    const write=operator.calls.find(call=>call.method==='POST');
    assert.deepEqual(write.body,{version:1,action:'open'});assert.equal(write.headers['x-kokkiri-editor'],'operator-key');
    assert.ok(operator.app.querySelector('#liveJoin')?.disabled,'opening before any court keeps the join button disabled');
    operator.view.stop();
  }
  {
    const h=harness();await h.open();const read=deferred();h.setAPI(()=>read.promise);
    const pending=h.tick(),dialog=h.join(),input=dialog.querySelector('#liveJoinName');input.value='종료 중';
    read.resolve({data:{version:2,isOpen:false,courts:[],queue:[],updatedAt:null}});await pending;
    assert.equal(dialog.removed,true,'a remote close dismisses an in-progress join dialog');
    assert.ok(h.app.innerHTML.includes('운영진이 실시간대진을 열면 입장할 수 있어요.'));
    assert.equal(h.app.querySelector('#liveJoin'),null);
    h.view.stop();
  }
  {
    const initial={version:1,isOpen:true,courts:[court(['A','B','C','D'])],queue:[],updatedAt:null};
    const h=harness(initial);await h.open();const read=deferred(),post=deferred();
    h.setAPI((path,options)=>options?.method==='POST'?post.promise:read.promise);
    const polling=h.tick(),ending=h.app.querySelector('[data-live-end]').onclick();
    post.resolve({data:{version:3,isOpen:true,courts:[court(['E','F','G','H'])],queue:[],updatedAt:null}});await ending;
    read.resolve({data:{version:2,isOpen:false,courts:[],queue:[],updatedAt:null}});await polling;
    assert.ok(h.app.querySelector('#liveJoin'),'an older closed GET cannot replace a newer open write response');
    assert.ok(h.app.innerHTML.includes('1번 코트 1번 참가자 E'));
    h.view.stop();
  }
  {
    const h=harness();await h.open();const dialog=h.join(),input=dialog.querySelector('#liveJoinName'),select=dialog.querySelector('#liveJoinCourt');
    input.value='A';const selected=select.value;
    h.setAPI(async(path,options)=>{if(options?.method==='POST')throw Error('현재 게임중인 회원입니다. 등록할 수 없습니다.');return {data:h.server};});
    await h.submit(dialog);
    const notice=h.dialogs.at(-1);
    assert.equal(dialog.removed,false,'duplicate notice keeps the join form open');
    assert.equal(input.value,'A');assert.equal(select.value,selected);
    assert.equal(notice.querySelectorAll('button').length,1,'duplicate notice has one acknowledgement button');
    assert.ok(notice.innerHTML.includes('현재 게임중인 회원입니다. 등록할 수 없습니다.'));
    notice.querySelector('#liveDuplicateOk').onclick();
    assert.equal(notice.removed,true);assert.equal(dialog.removed,false,'closing the notice preserves the retry form');
    h.view.stop();
  }
  {
    const h=harness();await h.open();const dialog=h.join();dialog.querySelector('#liveJoinName').value='종료 충돌';
    h.server={version:2,isOpen:false,courts:[],queue:[]};
    h.setAPI(async(path,options)=>{if(options?.method==='POST')throw Error('실시간대진이 종료되어 입장하거나 변경할 수 없습니다.');return {data:h.server};});
    await h.submit(dialog);await h.tick();
    assert.equal(dialog.removed,true);assert.equal(h.app.querySelector('#liveJoin'),null,'closed conflict refresh immediately renders the closed page');
    assert.ok(h.app.innerHTML.includes('운영진이 실시간대진을 열면'));h.view.stop();
  }
  {
    const h=harness();await h.open();const dialog=h.join();dialog.querySelector('#liveJoinName').value='A';
    h.setAPI(async(path,options)=>{if(options?.method==='POST')throw Error('현재 게임중인 회원입니다. 등록할 수 없습니다.');return {data:h.server};});
    await h.submit(dialog);const notice=h.dialogs.at(-1);
    h.server={version:2,isOpen:false,courts:[],queue:[]};await h.tick();
    assert.equal(dialog.removed,true);assert.equal(notice.removed,true,'closing the session clears both stacked dialogs');h.view.stop();
  }
  {
    const h=harness();await h.open();const dialog=h.join(),post=deferred();dialog.querySelector('#liveJoinName').value='A';
    h.setAPI(()=>post.promise);const submitting=h.submit(dialog);h.leavePage();
    post.reject(Error('현재 게임중인 회원입니다. 등록할 수 없습니다.'));await submitting;
    assert.equal(h.dialogs.length,1,'late duplicate response cannot open a notice on another page');assert.equal(h.app.innerHTML,'Other page');
  }
  {
    const h=harness();await h.open();const dialog=h.join(),select=dialog.querySelector('#liveJoinCourt');dialog.querySelector('#liveJoinName').value='새 참가';
    h.server={...fixture(),version:2,courts:[court(['New','','',''])]};await h.tick();
    assert.equal(select.value,'0');assert.ok(select.innerHTML.includes('3/4명'),'gate-only poll does not silently replace join destinations');
    h.setAPI(async(path,options)=>{if(options?.method==='POST')throw Error('다른 사람이 먼저 변경했어요. 최신 코트를 확인한 뒤 다시 입력해주세요.');return {data:h.server};});
    await h.submit(dialog);assert.equal(h.calls.find(c=>c.method==='POST').body.version,1,'join must submit the version the user actually saw');
    assert.ok(select.innerHTML.includes('1/4명'),'explicit conflict refresh updates choices');assert.equal(dialog.querySelector('#liveJoinName').value,'새 참가');h.view.stop();
  }
  {
    const initial={...fixture(),isOpen:false};const h=harness(initial,'operator-key');await h.open();
    h.app.querySelector('#liveToggle').onclick();const dialog=h.dialogs.at(-1);
    h.server={...initial,version:3};await h.tick();
    h.setAPI(async(path,options)=>{if(options?.method==='POST')throw Error('다른 사람이 먼저 변경했어요. 최신 코트를 확인한 뒤 다시 입력해주세요.');return {data:h.server};});
    await dialog.querySelector('#liveToggleYes').onclick();
    assert.equal(h.calls.find(c=>c.method==='POST').body.version,1,'confirmation uses its opening version, not a newer poll');
    assert.equal(dialog.removed,true);assert.equal(h.calls.filter(c=>c.method==='POST').length,1,'conflict requires a fresh confirmation');
    h.app.querySelector('#liveToggle').onclick();h.dialogs.at(-1).dispatch('cancel');
    assert.equal(h.calls.filter(c=>c.method==='POST').length,1,'ESC never writes');h.view.stop();
  }
  {
    const h=harness();await h.open();const read=deferred(),post=deferred();
    h.setAPI((path,options)=>options?.method==='POST'?post.promise:read.promise);
    const polling=h.tick(),dialog=h.join();dialog.querySelector('#liveJoinName').value='저장 중';
    const submitting=h.submit(dialog),paints=h.paints;
    read.resolve({data:{version:3,isOpen:false,courts:[],queue:[]}});await polling;
    assert.equal(h.paints,paints);assert.equal(dialog.removed,false,'GET cannot adopt state while saving');
    post.resolve({data:{...fixture(),version:2,courts:[court(['A','B','C','저장 중'])]}});await submitting;
    assert.ok(h.app.innerHTML.includes('저장 중'));h.view.stop();
  }
  console.log('PASS: actual live-view factory covers operator confirmation/gate races, remote closure, duplicate-name notice, preserved input, stale reads, writes and navigation cleanup.');
}
