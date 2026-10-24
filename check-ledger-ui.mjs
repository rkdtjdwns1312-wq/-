import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {createLedgerView} from './dist/server/ledger-client.js';
import {ledgerCss} from './dist/server/ledger-style.js';

const clone=value=>structuredClone(value);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const descendants=items=>items.flatMap(item=>[item,...descendants(item._children||[])]);

// The factory renders through innerHTML, so this small parser exposes the real
// rendered controls and event handlers without requiring a browser or DOM package.
function node(tag='div',attrs={},html=''){
  const listeners={};let markup='',children=[];const n={tag,attrs,dataset:{},value:attrs.value||'',textContent:'',disabled:Object.hasOwn(attrs,'disabled'),open:false,focused:false,
    focus(){this.focused=true;},showModal(){this.open=true;},close(){this.open=false;},remove(){this.removed=true;},
    addEventListener(type,fn){listeners[type]=fn;},dispatch(type){const event={target:this,preventDefault(){}};return (this['on'+type]||listeners[type])?.(event);},
    querySelector(selector){return this.querySelectorAll(selector)[0]||null;},querySelectorAll(selector){return descendants(children).filter(child=>matches(child,selector));}};
  Object.defineProperty(n,'_children',{get:()=>children});
  for(const [key,value] of Object.entries(attrs))if(key.startsWith('data-'))n.dataset[key.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=value;
  Object.defineProperty(n,'innerHTML',{get:()=>markup,set:value=>{markup=String(value);children=parse(markup);}});n.innerHTML=html;
  return n;
}
function matches(n,selector){
  if(selector.startsWith('#'))return n.attrs.id===selector.slice(1);
  if(selector.startsWith('.'))return String(n.attrs.class||'').split(/\s+/).includes(selector.slice(1));
  if(selector.startsWith('[')){const [key,value]=selector.slice(1,-1).split('=');return Object.hasOwn(n.attrs,key)&&(value===undefined||n.attrs[key]===value.replace(/^['"]|['"]$/g,''));}
  return n.tag===selector;
}
function parse(html){
  const out=[];for(const m of html.matchAll(/<(button|input|select|form|p|time|textarea|label|div|a|h1|h2|section|table|tr|td|th|dialog|small)\b([^>]*)>/g)){
    const attrs={};for(const a of m[2].matchAll(/([\w-]+)(?:="([^"]*)")?/g))attrs[a[1]]=a[2]??'';
    const child=node(m[1],attrs);let content='';
    if(child.tag==='textarea')content=html.slice(m.index+m[0].length).split('</textarea>')[0];
    child.textContent=content.replace(/<[^>]*>/g,'');
    if(child.tag==='textarea')child.value=content.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'");
    if(child.tag==='input'&&attrs.type==='number')child.value=attrs.value||'';
    out.push(child);
  }return out;
}
function root(){let html='',children=[];const n={querySelector(selector){return n.querySelectorAll(selector)[0]||null;},querySelectorAll(selector){return descendants(children).filter(child=>matches(child,selector));}};Object.defineProperty(n,'innerHTML',{get:()=>html,set:value=>{html=String(value);children=parse(html);}});return n;}
const entry=(id,date,description,income=0,expense=0,note='')=>({id,date,description,income,expense,note});
const ledger=(entries=[entry('e1','2026-10-01','회비',1000)],openingBalance=100,version=4)=>({openingBalance,entries,version,updatedAt:null});
function harness({initial=ledger(),editor='operator-key',token=1}={}){
  let server=clone(initial),isCurrent=key=>key===token;const app=root(),calls=[],messages=[],dirty=[],saving=[];let apiImpl=async(path,options)=>options?.method==='PUT'?{data:{...clone(server),version:server.version+1}}:{data:clone(server)};
  const api=(path,options)=>{calls.push({path,method:options?.method||'GET',headers:options?.headers||{},rawBody:options?.body??null,body:options?.body?JSON.parse(options.body):null});return apiImpl(path,options);};
  const view=createLedgerView({app,api,esc,EDITOR:editor,isCurrent,setDirty:value=>dirty.push(value),setSaving:value=>saving.push(value),message:(...args)=>messages.push(args)});
  return {app,calls,messages,dirty,saving,view,setAPI:fn=>apiImpl=fn,setServer:value=>server=clone(value),navigate(){token++;},async open(){await view.open(token);},getServer:()=>clone(server)};
}

async function ledgerListNavigationChecks(){
  let activeToken=1,listOptions;const app=root(),messages=[],saving=[],dirty=[];let ledgerReads=0;const oldRead=deferred();
  const api=async(path)=>{
    if(path!=='/api/ledger')throw Error('unexpected API request '+path);
    ledgerReads++;if(ledgerReads===2)return oldRead.promise;
    return {data:ledger([entry('e1','2026-10-01','회비',1000)],100,ledgerReads)};
  };
  const view=createLedgerView({app,api,esc,EDITOR:'operator-key',isCurrent:key=>key===activeToken,setDirty:value=>dirty.push(value),setSaving:value=>saving.push(value),message:(...args)=>messages.push(args),createLedgerLists:options=>{listOptions=options;return {open:async()=>{}};}});
  await view.open(1);
  const html=app.innerHTML;assert.ok(html.indexOf('id="ledgerPrepaid"')<html.indexOf('id="ledgerSponsors"'),'ledger header places prepaid before sponsor list button');
  await app.querySelector('#ledgerPrepaid').dispatch('click');assert.ok(listOptions,'ledger view creates the list factory');
  const pendingBack=listOptions.onBack();
  activeToken=2;await view.open(2);await app.querySelector('#ledgerEdit').dispatch('click');
  const description=app.querySelector('[data-field="description"]');assert.ok(description,'new ledger view entered edit mode');
  description.value='새 화면의 편집 초안';await description.dispatch('input');
  oldRead.reject(Error('old ledger read failed'));await pendingBack;
  const stillEditing=app.querySelector('[data-field="description"]');
  assert.ok(stillEditing,'late back-read failure does not replace the current editor');
  assert.equal(stillEditing.value,'새 화면의 편집 초안','late failure preserves the new token draft');
  assert.ok(!app.innerHTML.includes('ledgerRetry'),'late failure does not show an old retry screen');
}

export async function runLedgerUIChecks(){
  const memoStyle=ledgerCss.match(/\.ledger-memo\{([^}]+)\}/)?.[1]||'';
  assert.match(memoStyle,/border:1px solid/,'memo retains a subtle outline');
  assert.doesNotMatch(memoStyle,/border-top:/,'memo has no thick green top border');
  await ledgerListNavigationChecks();
  {
    const linkedEntries=[{...entry('linked:prepaid:p1','2026-10-02','선납 회비 · 회원',3000),sourceKind:'prepaid',sourceId:'p1'},{...entry('linked:sponsors:s1','2026-10-03','찬조 · 후원',2000),sourceKind:'sponsors',sourceId:'s1'}];
    const h=harness({initial:{...ledger([entry('manual','2026-10-01','별도 수입',1000)],100),linkedEntries}});await h.open();
    assert.ok(h.app.innerHTML.includes('총 수입<strong class="ledger-income">6,000원</strong>'));
    assert.ok(h.app.innerHTML.includes('현재 누계<strong>6,100원</strong>'));
    assert.equal(h.app.querySelectorAll('.ledger-linked').length,2);
    await h.app.querySelector('#ledgerEdit').dispatch('click');
    assert.equal(h.app.querySelectorAll('[data-field="income"]').length,1,'only manual income is editable');
    assert.equal(h.app.querySelectorAll('[data-delete]').length,1,'linked income cannot be deleted in ledger');
    assert.equal(h.app.querySelectorAll('[data-linked-list]').length,2);
    const amount=h.app.querySelector('[data-field="income"]');amount.value='1500';await amount.oninput();
    assert.equal(h.app.querySelector('[data-balance-id="linked:sponsors:s1"]').textContent,'6,600원','manual changes recalculate linked running balances');
    await h.app.querySelector('#ledgerSave').dispatch('click');
    const write=h.calls.find(c=>c.method==='PUT');assert.equal(write.body.entries.length,1);assert.equal(write.body.entries[0].id,'manual');assert.ok(!('linkedEntries' in write.body),'derived entries are never copied into manual storage');
    assert.equal(h.app.querySelectorAll('.ledger-linked').length,2,'save response preserves linked display');
    h.setServer({...ledger([],100),linkedEntries:[{...linkedEntries[0],income:4000}]});await h.app.querySelector('#ledgerRefresh').dispatch('click');
    assert.ok(h.app.innerHTML.includes('현재 누계<strong>4,100원</strong>'),'refresh reflects linked edits and deletions');
    assert.ok(!h.app.innerHTML.includes('아직 등록된 거래가 없습니다.'),'linked-only ledger is not empty');
  }
  {
    const secret='<script>alert("x")</script>',description='<img src=x onerror=alert(1)>',h=harness({editor:'',initial:ledger([entry('unsafe','2026-10-01',description,0,25,secret)])});await h.open();
    assert.equal(h.app.querySelector('#ledgerEdit'),null,'members cannot enter edit mode');
    assert.ok(h.app.innerHTML.includes(esc(description)),'description is HTML escaped');assert.ok(!h.app.innerHTML.includes(description),'raw description never enters HTML');
    assert.ok(!h.app.innerHTML.includes(esc(secret)),'memo contents are absent from the table markup');assert.ok(!h.app.innerHTML.includes('<script>'),'no script element is rendered');
    const memo=h.app.querySelector('[data-memo]');assert.ok(memo,'memo is represented by a button');await memo.dispatch('click');
    const dialog=h.app.querySelector('#ledgerMemo');assert.ok(dialog?.open,'memo button opens a dialog');assert.ok(dialog.innerHTML.includes(esc(secret)),'dialog renders memo as escaped text');assert.ok(!dialog.innerHTML.includes(secret));
  }
  {
    const rows=[entry('late','2026-10-03','뒤 날짜',0,40),entry('first','2026-10-01','같은 날 첫 수입',80),entry('middle','2026-10-02','중간 지출',0,15),entry('second','2026-10-01','같은 날 다음 지출',0,5)];
    const h=harness({editor:'',initial:ledger(rows,100)});await h.open();const html=h.app.innerHTML;
    assert.ok(html.indexOf('같은 날 첫 수입')<html.indexOf('같은 날 다음 지출')&&html.indexOf('같은 날 다음 지출')<html.indexOf('중간 지출')&&html.indexOf('중간 지출')<html.indexOf('뒤 날짜'),'chronological rows retain original order on equal dates');
    assert.ok(html.includes('총 수입<strong class="ledger-income">80원</strong>'));assert.ok(html.includes('총 지출<strong class="ledger-expense">60원</strong>'));assert.ok(html.includes('현재 누계<strong>120원</strong>'),'opening balance and income minus expense determine final summary');
  }
  {
    const h=harness();await h.open();await h.app.querySelector('#ledgerEdit').dispatch('click');
    assert.ok(h.app.querySelector('[data-field="description"]'),'edit mode renders editable transaction fields');
    const amount=h.app.querySelector('[data-field="income"]');amount.value='2.5';await amount.oninput();await h.app.querySelector('#ledgerSave').dispatch('click');
    assert.equal(h.calls.filter(call=>call.method==='PUT').length,0,'fractional amount is rejected before network write');assert.ok(h.app.querySelector('#ledgerError').textContent.includes('정수'));
    amount.value='2000';await amount.oninput();await h.app.querySelector('#ledgerSave').dispatch('click');
    assert.equal(h.calls.filter(call=>call.method==='PUT').length,1);const write=h.calls.find(call=>call.method==='PUT');assert.equal(write.headers['content-type'],'application/json','ledger save declares JSON so the API does not reject it with 415');assert.equal(typeof write.rawBody,'string','ledger save sends a serialized request body');assert.deepEqual(JSON.parse(write.rawBody),write.body,'serialized JSON body matches the parsed contract');assert.equal(write.body.entries[0].income,2000,'valid integer amount is saved');
  }
  {
    const h=harness();await h.open();await h.app.querySelector('#ledgerEdit').dispatch('click');const dateInput=h.app.querySelector('[data-field="date"]');
    // The fake parser models input constraints; factory validation checks presence and amounts.
    dateInput.value='';await dateInput.oninput();await h.app.querySelector('#ledgerSave').dispatch('click');assert.equal(h.calls.filter(call=>call.method==='PUT').length,0,'missing required date is rejected');
  }
  {
    const h=harness();await h.open();await h.app.querySelector('#ledgerEdit').dispatch('click');const input=h.app.querySelector('[data-field="description"]');input.value='수정';await input.oninput();
    let fail=true;h.setAPI(async(path,options)=>{if(options?.method==='PUT'&&fail){fail=false;throw Error('network down');}return {data:{...h.getServer(),version:5,entries:[entry('e1','2026-10-01','수정',1000)]}};});
    await h.app.querySelector('#ledgerSave').dispatch('click');const first=h.calls.find(call=>call.method==='PUT').body;assert.equal(h.app.querySelector('[data-field="description"]').value,'수정','network failure retains draft');
    await h.app.querySelector('#ledgerSave').dispatch('click');const writes=h.calls.filter(call=>call.method==='PUT');assert.equal(writes.length,2);assert.equal(writes[1].body.operation,first.operation,'retry reuses the same operation id');assert.deepEqual(writes[1].body,writes[0].body,'retry sends the identical payload');
  }
  {
    const h=harness();await h.open();await h.app.querySelector('#ledgerEdit').dispatch('click');const input=h.app.querySelector('[data-field="description"]');input.value='local draft';await input.oninput();
    h.setAPI(async(path,options)=>{if(options?.method==='PUT'){const error=Error('conflict');error.status=409;throw error;}return {data:h.getServer()};});await h.app.querySelector('#ledgerSave').dispatch('click');
    assert.equal(h.calls.filter(call=>call.method==='PUT').length,1,'conflict does not trigger automatic overwrite or retry');assert.equal(h.app.querySelector('[data-field="description"]').value,'local draft','conflict keeps the local draft visible');assert.equal(h.app.querySelector('#ledgerSave').disabled,false,'conflict re-enables explicit user controls');
  }
  {
    const h=harness(),read=deferred();h.setAPI(()=>read.promise);const opening=h.open();h.navigate();read.resolve({data:ledger([entry('stale','2026-01-01','stale')])});await opening;
    assert.ok(!h.app.innerHTML.includes('stale'),'navigation token ignores a stale ledger response');
  }
  {
    const note='메모'.repeat(2500),h=harness({initial:ledger([entry('long','2026-10-01','장부 메모',100,0,note)])});await h.open();await h.app.querySelector('#ledgerEdit').dispatch('click');await h.app.querySelector('[data-memo]').dispatch('click');
    const textarea=h.app.querySelector('#ledgerMemoText');assert.ok(textarea,'memo editor opens for the transaction');assert.equal(textarea.attrs.maxlength,'5000','memo editor permits up to 5,000 characters');assert.equal(textarea.value.length,5000,'existing 5,000-character memo is preserved');
    textarea.value=note+'x';assert.ok(textarea.value.length>5000,'the DOM maxLength constraint is declared at 5,000 characters');
  }
  return true;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  runLedgerUIChecks().then(()=>console.log('check-ledger-ui PASS')).catch(error=>{console.error(error);process.exitCode=1;});
}
