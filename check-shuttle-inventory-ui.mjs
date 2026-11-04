import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { createShuttleInventory } from './dist/server/shuttle-inventory-client.js';
import { createLedgerView } from './dist/server/ledger-client.js';
import { shuttleInventoryCss } from './dist/server/shuttle-inventory-style.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const descendants=items=>items.flatMap(item=>[item,...descendants(item._children||[])]);
function matches(node,selector){if(selector.startsWith('#'))return node.attrs.id===selector.slice(1);if(selector.startsWith('.'))return String(node.attrs.class||'').split(/\s+/).includes(selector.slice(1));if(selector.startsWith('[')){const [key,value]=selector.slice(1,-1).split('=');return Object.hasOwn(node.attrs,key)&&(value===undefined||node.attrs[key]===value.replace(/^['"]|['"]$/g,''));}return node.tag===selector;}
function element(tag='div',attrs={}){let markup='',children=[];const node={tag,attrs,dataset:{},value:attrs.value||'',textContent:'',disabled:Object.hasOwn(attrs,'disabled'),focused:false,focus(){this.focused=true;},querySelector(selector){return this.querySelectorAll(selector)[0]||null;},querySelectorAll(selector){return descendants(children).filter(child=>matches(child,selector));}};for(const [key,value] of Object.entries(attrs))if(key.startsWith('data-'))node.dataset[key.slice(5).replace(/-([a-z])/g,(_,char)=>char.toUpperCase())]=value;Object.defineProperty(node,'innerHTML',{get:()=>markup,set:value=>{markup=String(value);children=parse(markup);}});Object.defineProperty(node,'_children',{get:()=>children});node.dispatch=type=>node['on'+type]?.({target:node,preventDefault(){}});return node;}
function parse(html){const result=[];for(const match of html.matchAll(/<(button|input|p|div|a|h1|section|table|tr|td|th|strong)\b([^>]*)>/g)){const attrs={};for(const item of match[2].matchAll(/([\w-]+)(?:="([^"]*)")?/g))attrs[item[1]]=item[2]??'';result.push(element(match[1],attrs));}return result;}
function root(){let markup='',children=[];const node={querySelector(selector){return node.querySelectorAll(selector)[0]||null;},querySelectorAll(selector){return descendants(children).filter(child=>matches(child,selector));}};Object.defineProperty(node,'innerHTML',{get:()=>markup,set:value=>{markup=String(value);children=parse(markup);}});return node;}
const initial={entries:[{id:'11111111-1111-4111-8111-111111111111',date:'2026-11-02',change:-3},{id:'22222222-2222-4222-8222-222222222222',date:'2026-11-01',change:12}],version:2,updatedAt:'2026-11-02T00:00:00.000Z'};
function harness(editor='operator-key'){
  const app=root(),calls=[],messages=[],dirty=[],saving=[];let data=structuredClone(initial),token=1;
  const api=async(path,options)=>{calls.push({path,method:options?.method||'GET',body:options?.body?JSON.parse(options.body):null});if(options?.method==='PUT')data={...structuredClone(options.body?JSON.parse(options.body):{}),version:data.version+1,updatedAt:new Date().toISOString()};return {data:structuredClone(data)};};
  const view=createShuttleInventory({app,api,esc,EDITOR:editor,isCurrent:value=>value===token,setDirty:value=>dirty.push(value),setSaving:value=>saving.push(value),message:text=>messages.push(text),onBack:()=>messages.push('back')});
  return {app,calls,messages,dirty,saving,view,open:()=>view.open(token)};
}
const originalConfirm=globalThis.confirm;globalThis.confirm=()=>true;

export async function runShuttleInventoryUIChecks(){
  {
    const h=harness('');await h.open();assert.equal(h.app.querySelector('#inventoryEdit'),null);assert.ok(h.app.innerHTML.includes('회원은 조회만 가능합니다.'));
    assert.ok(h.app.innerHTML.indexOf('2026-11-01')<h.app.innerHTML.indexOf('2026-11-02'),'rows are shown in date order');assert.ok(h.app.innerHTML.includes('+12개')&&h.app.innerHTML.includes('-3개')&&h.app.innerHTML.includes('9개'));
  }
  {
    const h=harness();await h.open();await h.app.querySelector('#inventoryEdit').dispatch('click');assert.ok(h.app.innerHTML.includes('날짜')&&h.app.innerHTML.includes('콕 변동 개수')&&h.app.innerHTML.includes('누계'));
    const changes=h.app.querySelectorAll('[data-inventory-field="change"]');changes[0].value='15';await changes[0].dispatch('input');await h.app.querySelector('#inventorySave').dispatch('click');
    const put=h.calls.find(call=>call.method==='PUT');assert.equal(put.path,'/api/shuttle-inventory');assert.equal(put.body.version,2);assert.ok(put.body.operation);assert.ok(put.body.entries.some(entry=>entry.change===15));assert.ok(h.messages.includes('콕 재고 기록을 저장했습니다.'));
  }
  assert.match(createLedgerView.toString(),/id="ledgerInventory">콕 재고 관리/,'ledger shows the inventory button beside list buttons');
  assert.match(createLedgerView.toString(),/createShuttleInventory/,'ledger wires the inventory factory');
  assert.match(shuttleInventoryCss,/\.inventory-scroll\{[^}]*overflow:auto/s);assert.match(shuttleInventoryCss,/\.inventory-table th\{[^}]*position:sticky/s);assert.match(shuttleInventoryCss,/\.inventory-in\{color:/);assert.match(shuttleInventoryCss,/\.inventory-out\{color:/);
  if(originalConfirm===undefined)delete globalThis.confirm;else globalThis.confirm=originalConfirm;
  return true;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){await runShuttleInventoryUIChecks();console.log('check-shuttle-inventory-ui PASS');}
