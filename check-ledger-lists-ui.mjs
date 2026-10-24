import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {createLedgerLists} from './dist/server/ledger-lists-client.js';
import {ledgerListsCss} from './dist/server/ledger-lists-style.js';

const clone=value=>structuredClone(value);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const descendants=items=>items.flatMap(item=>[item,...descendants(item._children||[])]);

function matches(n,selector){
  if(selector.startsWith('#'))return n.attrs.id===selector.slice(1);
  if(selector.startsWith('.'))return String(n.attrs.class||'').split(/\s+/).includes(selector.slice(1));
  if(selector.startsWith('[')){const [key,value]=selector.slice(1,-1).split('=');return Object.hasOwn(n.attrs,key)&&(value===undefined||n.attrs[key]===value.replace(/^['"]|['"]$/g,''));}
  return n.tag===selector;
}
function node(tag='div',attrs={}){
  let markup='',children=[];const n={tag,attrs,dataset:{},value:attrs.value||'',textContent:'',disabled:Object.hasOwn(attrs,'disabled'),checked:Object.hasOwn(attrs,'checked'),indeterminate:false,focused:false,
    focus(){this.focused=true;},addEventListener(){},querySelector(selector){return this.querySelectorAll(selector)[0]||null;},querySelectorAll(selector){return descendants(children).filter(child=>matches(child,selector));}};
  for(const [key,value] of Object.entries(attrs))if(key.startsWith('data-'))n.dataset[key.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=value;
  Object.defineProperty(n,'innerHTML',{get:()=>markup,set:value=>{markup=String(value);children=parse(markup);}});
  Object.defineProperty(n,'_children',{get:()=>children});
  n.dispatch=type=>n['on'+type]?.({target:n,preventDefault(){}});
  return n;
}
function parse(html){
  const out=[];for(const m of html.matchAll(/<(button|input|select|form|p|time|textarea|label|div|a|h1|h2|section|table|tr|td|th|dialog|span)\b([^>]*)>/g)){
    const attrs={};for(const a of m[2].matchAll(/([\w-]+)(?:="([^"]*)")?/g))attrs[a[1]]=a[2]??'';
    const child=node(m[1],attrs);child.textContent='';out.push(child);
  }return out;
}
function root(){let html='',children=[];const n={querySelector(selector){return n.querySelectorAll(selector)[0]||null;},querySelectorAll(selector){return descendants(children).filter(child=>matches(child,selector));}};Object.defineProperty(n,'innerHTML',{get:()=>html,set:value=>{html=String(value);children=parse(html);}});return n;}
const row=(id,name='김회원',amount=30000,date='2026-10-01')=>({id,name,amount,date});
const payload=(entries=[row('entry-1')],version=4)=>({entries,version,updatedAt:null});
async function selectForEdit(app,id='entry-1'){
  const check=app.querySelector('[data-select="'+id+'"]');assert.ok(check,'row selection checkbox exists');check.checked=true;await check.dispatch('change');await app.querySelector('#listModify').dispatch('click');
}
function harness({initial=payload(),editor='operator-key',kind='prepaid'}={}){
  let server=clone(initial),token=1;const app=root(),calls=[],messages=[],dirty=[],saving=[];
  let apiImpl=async(path,options)=>options?.method==='PUT'?{data:{...clone(server),version:server.version+1}}:{data:clone(server)};
  const api=(path,options)=>{calls.push({path,method:options?.method||'GET',headers:options?.headers||{},rawBody:options?.body??null,body:options?.body?JSON.parse(options.body):null});return apiImpl(path,options);};
  const view=createLedgerLists({app,api,esc,EDITOR:editor,isCurrent:key=>key===token,setDirty:value=>dirty.push(value),setSaving:value=>saving.push(value),message:(...args)=>messages.push(args),onBack:()=>messages.push(['back'])});
  return {app,calls,messages,dirty,saving,view,setAPI:fn=>apiImpl=fn,setServer:value=>server=clone(value),navigate(){token++;},async open(nextKind=kind){await view.open(nextKind,token);},getServer:()=>clone(server)};
}
const confirmOriginal=globalThis.confirm;
globalThis.confirm=()=>true;

export async function runLedgerListsUIChecks(){
  {
    const hostile='<img src=x onerror=alert(1)>',h=harness({editor:'',initial:payload([row('safe',hostile,1200)])});await h.open();
    assert.equal(h.app.querySelector('#listEdit'),null,'members cannot enter edit mode');
    assert.ok(h.app.innerHTML.includes(esc(hostile))&&!h.app.innerHTML.includes(hostile),'names are HTML escaped');
    assert.ok(h.app.innerHTML.includes('회원은 조회만 가능합니다.'),'members see read-only guidance');
  }
  {
    const h=harness();await h.open('sponsors');assert.equal(h.calls[0].path,'/api/ledger-lists/sponsors');
    assert.ok(h.app.innerHTML.includes('찬조명단')&&h.app.innerHTML.includes('총 30,000원'),'sponsor list and total render');
    assert.ok(h.app.innerHTML.includes('ledger-list-table')&&h.app.innerHTML.includes('ledger-list-scroll'),'vertical list table is present');
    assert.ok(h.app.innerHTML.includes('ledger-list-total')&&h.app.innerHTML.includes('ledger-list-error'),'markup uses the factory total and error classes');
    assert.ok(h.app.innerHTML.includes('class="list-name"')&&h.app.innerHTML.includes('class="list-amount"')&&h.app.innerHTML.includes('class="list-date"'),'each data column has its semantic style class');
    assert.match(ledgerListsCss,/\.ledger-list-scroll\{[^}]*max-height:min\(58vh,520px\)[^}]*overflow:auto/s,'list scroll region is vertically bounded and scrollable');
    assert.match(ledgerListsCss,/\.ledger-list-table\{[^}]*width:100%[^}]*min-width:360px/s,'read-only table fits narrow panels');
    assert.match(ledgerListsCss,/\.ledger-list-table\.editing\{[^}]*min-width:560px/s,'editing table keeps comfortable input widths inside horizontal scroll');
    assert.match(ledgerListsCss,/\.list-amount[^}]*text-align:right[^}]*white-space:nowrap[^}]*font-variant-numeric:tabular-nums/s,'amount column is right aligned and stays on one line');
    assert.match(ledgerListsCss,/\.list-date[^}]*white-space:nowrap[^}]*font-variant-numeric:tabular-nums/s,'date column stays on one line with tabular digits');
    assert.match(ledgerListsCss,/\.list-name[^}]*overflow-wrap:anywhere/s,'long names can wrap');
    assert.match(ledgerListsCss,/\.ledger-list-table th\{[^}]*position:sticky/s,'table header remains visible while scrolling');
    assert.match(ledgerListsCss,/\.ledger-list-error:empty\{display:none\}/,'empty error message is hidden');
  }
  {
    const h=harness();await h.open();await h.app.querySelector('#listEdit').dispatch('click');
    assert.ok(h.app.innerHTML.includes('ledger-list-table editing'),'edit mode marks the table for its wider layout');
    const check=h.app.querySelector('[data-select="entry-1"]');check.checked=true;await check.dispatch('change');
    assert.equal(h.app.querySelector('#listModify').disabled,false,'selection enables modification');
    await h.app.querySelector('#listModify').dispatch('click');assert.ok(h.app.querySelector('[data-list-field="name"]'),'selected row becomes editable');
    const name=h.app.querySelector('[data-list-field="name"]');name.value='수정 회원';await name.dispatch('input');
    await h.app.querySelector('#listSave').dispatch('click');const put=h.calls.find(call=>call.method==='PUT');
    assert.equal(put.path,'/api/ledger-lists/prepaid');assert.equal(put.headers['content-type'],'application/json');
    assert.equal(put.body.version,4);assert.equal(put.body.entries[0].name,'수정 회원');assert.ok(put.body.operation,'save includes an idempotency operation id');
    assert.ok(h.messages.some(item=>item[0]==='선납자명단을 저장했습니다.'));
  }
  {
    const h=harness();await h.open();await h.app.querySelector('#listEdit').dispatch('click');
    const check=h.app.querySelector('[data-select="entry-1"]');check.checked=true;await check.dispatch('change');await h.app.querySelector('#listDelete').dispatch('click');
    assert.ok(!h.app.innerHTML.includes('김회원'),'selected row can be deleted from the draft');
    assert.equal(h.calls.filter(call=>call.method==='PUT').length,0,'delete stays local until save');
  }
  {
    const h=harness({initial:payload([])});await h.open();await h.app.querySelector('#listEdit').dispatch('click');await h.app.querySelector('#listAdd').dispatch('click');
    const fields=h.app.querySelectorAll('[data-list-field]');assert.equal(fields.length,3,'add creates editable name, amount, and date fields');
    assert.ok(fields[0].focused,'new row focuses its name field');
    for(const field of fields){if(field.dataset.listField==='name')field.value='신규 회원';if(field.dataset.listField==='amount')field.value='45000';}
    await fields[0].dispatch('input');await fields[1].dispatch('input');await h.app.querySelector('#listSave').dispatch('click');
    assert.equal(h.calls.find(call=>call.method==='PUT').body.entries[0].amount,45000,'new entry is serialized with numeric amount');
  }
  {
    const h=harness();await h.open();await h.app.querySelector('#listEdit').dispatch('click');await selectForEdit(h.app);const input=h.app.querySelector('[data-list-field="name"]');input.value='임시 수정';await input.dispatch('input');
    let fail=true;h.setAPI(async(path,options)=>{if(options?.method==='PUT'&&fail){fail=false;throw Error('network down');}return {data:{...h.getServer(),version:5,entries:[row('entry-1','임시 수정')]}};});
    await h.app.querySelector('#listSave').dispatch('click');const first=h.calls.find(call=>call.method==='PUT').body;
    assert.equal(h.app.querySelector('[data-list-field="name"]').value,'임시 수정','network failure retains the draft');
    await h.app.querySelector('#listSave').dispatch('click');const writes=h.calls.filter(call=>call.method==='PUT');
    assert.deepEqual(writes[1].body,first,'retry reuses the identical payload and operation id');
  }
  {
    const h=harness();await h.open();await h.app.querySelector('#listEdit').dispatch('click');await selectForEdit(h.app);const input=h.app.querySelector('[data-list-field="name"]');input.value='로컬 변경';await input.dispatch('input');
    h.setAPI(async(path,options)=>{if(options?.method==='PUT'){const error=Error('conflict');error.status=409;throw error;}return {data:h.getServer()};});
    await h.app.querySelector('#listSave').dispatch('click');
    assert.equal(h.calls.filter(call=>call.method==='PUT').length,1,'conflict does not automatically overwrite');
    assert.equal(h.app.querySelector('[data-list-field="name"]').value,'로컬 변경','conflict preserves the draft');
    assert.ok(h.app.querySelector('#listError').textContent.includes('다른 운영진'));
  }
  {
    const h=harness(),read=deferred();h.setAPI(()=>read.promise);const opening=h.open();h.navigate();read.resolve({data:payload([row('stale','오래된 응답')])});await opening;
    assert.ok(!h.app.innerHTML.includes('오래된 응답'),'navigation token ignores a late response after the view has changed');
  }
  {
    const h=harness();let fail=true;h.setAPI(async()=>{if(fail){fail=false;throw Error('temporary');}return {data:payload()};});await h.open();
    await h.app.querySelector('#listRetry').dispatch('click');assert.ok(h.app.innerHTML.includes('김회원'),'load failure offers a working retry');
  }
  if(confirmOriginal===undefined)delete globalThis.confirm;else globalThis.confirm=confirmOriginal;
  return true;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  runLedgerListsUIChecks().then(()=>console.log('check-ledger-lists-ui PASS')).catch(error=>{console.error(error);process.exitCode=1;});
}
