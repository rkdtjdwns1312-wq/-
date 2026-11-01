import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createScheduleTools} from './dist/server/schedule-tools.js';
import {webcrypto} from 'node:crypto';

const source=await readFile(new URL('./dist/server/boards-client.js',import.meta.url),'utf8');
const css=await readFile(new URL('./dist/server/boards-style.js',import.meta.url),'utf8');
function actual(name){let start=source.indexOf('function '+name+'(');assert.ok(start>=0);if(source.slice(start-6,start)==='async ')start-=6;let depth=0,quote='',escaped=false;for(let i=source.indexOf('{',start);i<source.length;i++){const c=source[i];if(quote){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c===quote)quote='';continue;}if(c==='"'||c==="'"||c==='`'){quote=c;continue;}if(c==='{')depth++;if(c==='}'&&!--depth)return source.slice(start,i+1);}throw Error('unterminated '+name);}
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function harness(){
  const nodes=new Map();
  const node=attrs=>({value:attrs.value||'',textContent:'',innerHTML:'',disabled:false,handlers:{},setAttribute(){},focus(){},addEventListener(type,fn){(this.handlers[type]??=[]).push(fn);}});
  const dialog={open:false,showModal(){this.open=true;},close(){this.open=false;}};
  Object.defineProperty(dialog,'innerHTML',{set(html){this.html=html;nodes.clear();for(const tag of html.matchAll(/<(?:button|input|div|p)\b([^>]*)>/g)){const attrs={};for(const a of tag[1].matchAll(/([\w-]+)(?:="([^"]*)")?/g))attrs[a[1]]=a[2]??'';if(attrs.id)nodes.set(attrs.id,node(attrs));}},get(){return this.html;}});
  return {dialog,$:id=>nodes.get(id),click(selector,dataset){const target={closest:s=>s===selector?{dataset}:null};for(const fn of nodes.get('choices').handlers.click)fn({target,preventDefault(){}});}};
}
const people=['가','나','다','라','마'].map((name,i)=>({id:'p'+i,name,type:'member',points:100,seed:'A'}));
const existing={id:'p',kind:'schedule',version:1,title:'원래 제목',scheduleDate:'2026-11-01',names:people.map(p=>p.name),participantIds:people.map(p=>p.id),courts:1,rounds:4,schedule:Array.from({length:4},(_,i)=>({round:i+1,method:'random',g:[],rest:[]})),lateRounds:{},earlyFromRounds:{가:3,나:4},results:{}};
let made;
const tools=createScheduleTools();
function compile(h){return new Function('EDITOR','dialog','$','getPeople','message','esc','nameHTML','seedHTML','OPERATORS','crypto','confirm','alert','window','editSchedule','scheduleTools','createScheduleInfo',`let routeToken=1,dirty=false;${actual('openPicker')} return openPicker;`)('operator',h.dialog,h.$,async()=>people,()=>{},esc,esc,esc,new Set(),webcrypto,()=>true,()=>{}, {scrollTo(){}},d=>{made=d;},tools,()=>({read:()=>({title:'제목',scheduleDate:'2026-11-01'})}));}
let h=harness(),open=compile(h);await open(existing);
assert.match(h.$('choices').innerHTML,/<span class="person-controls"><button[^>]*class="late-btn[^>]*>늦참<\/button><button[^>]*class="early-btn[^>]*>조퇴<\/button><\/span>/);
assert.match(css,/\.person-controls\{[^}]*display:flex;[^}]*flex-wrap:nowrap/);
assert.match(css,/\.early-options\{[^}]*flex-wrap:wrap/);
assert.match(h.dialog.innerHTML,/조퇴 3은 3라운드부터 마지막 라운드까지 제외/);
assert.match(h.dialog.innerHTML,/조퇴를 지정한 운영진·게스트는 참여 가능한 라운드에서 추가 자동 휴식 배정이 면제/);
assert.match(h.$('choices').innerHTML,/조퇴 3라운드부터 제외/);
assert.match(h.$('choices').innerHTML,/data-early-round="4"/);
h.click('[data-early-round]',{earlyName:'가',earlyRound:'2'});
assert.match(h.$('choices').innerHTML,/조퇴 2라운드부터 제외/);
h.click('.early-btn',{earlyName:'나'});assert.doesNotMatch(h.$('choices').innerHTML,/조퇴 4라운드부터 제외/);
h.click('.late-btn',{lateName:'가'});h.click('[data-late-round]',{lateName:'가',lateRound:'1'});
assert.match(h.$('choices').innerHTML,/참여 가능한 라운드가 없습니다/);
h.$('rounds').value='1';h.$('rounds').oninput();assert.match(h.$('pickerError').textContent,/조퇴 선택을 해제/);assert.doesNotMatch(h.$('choices').innerHTML,/data-early-round="2"/);
h.$('rounds').value='4';h.$('rounds').oninput();h.click('[data-early-round]',{earlyName:'가',earlyRound:'3'});h.click('.early-btn',{earlyName:'나'});h.click('[data-early-round]',{earlyName:'나',earlyRound:'4'});
h.$('choices').onchange({target:{checked:false,value:'p1'}});
await h.$('generate').onclick();
assert.deepEqual(made.earlyFromRounds,{가:3});assert.deepEqual(made.lateRounds,{가:1});assert.ok(!made.names.includes('나'));
assert.deepEqual(made.schedule.map(r=>r.early),[[],[],['가'],['가']]);
h=harness();open=compile(h);await open(made);assert.match(h.$('choices').innerHTML,/조퇴 3라운드부터 제외/);assert.doesNotMatch(h.$('choices').innerHTML,/조퇴 4라운드부터 제외/);

// Actual schedule renderer shows departure independently in both edit and detail.
const render=new Function('scheduleTools','people','viewRound','esc','nameHTML','winBtn','matchStateControl',actual('scheduleHTML')+';return scheduleHTML;')(tools,people,1,esc,esc,()=>'',()=> '');
for(const editing of [false,true]){const html=render(made,editing,true,people);assert.match(html,/조퇴: 가/);assert.match(html,/늦참 대기: 가/);assert.match(html,/휴식:/);}
console.log('early departure UI checks: PASS');
