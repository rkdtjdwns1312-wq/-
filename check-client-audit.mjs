import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { runProgressUIChecks } from './check-progress-ui.mjs';
import { runLiveUIChecks } from './check-live-ui.mjs';
import { createScheduleTools } from './dist/server/schedule-tools.js';

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
    EDITOR:'operator',getPeople:async()=>people,message(){},people,dialog:h.dialog,$:h.$,esc,nameHTML:esc,seedHTML:esc,
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
      EDITOR:'operator',getPeople:async()=>people,message(){},people,dialog:h.dialog,$:h.$,esc,nameHTML:esc,seedHTML:esc,nameOf:()=> 'GLOBAL-NAME',
      crypto:{randomUUID:()=> 'new'},scheduleTools:{generate(value){roster.push(...value);return [];},},OPERATORS:new Set(),confirm:()=>true,alert(){},window:{scrollTo(){}},stamp:()=>'',editSchedule(){},dirty:false,routeToken:1,
    });
    await openPicker({id:'draft',participantIds:people.map(p=>p.id),names:['중복 (회원)','중복 (게스트)','A','B','C'],courts:1,rounds:1,absent:[]});
    assert.match(h.dialog.innerHTML,/동일은 휴식·늦참을 뺀 뒤 점수순 4명씩 고정으로 묶고, 동일 라운드 회차마다 1·4 vs 2·3 → 1·3 vs 2·4 → 1·2 vs 3·4 팀 조합을 순환합니다\./,'picker help must explain same rank blocks and its three-team cycle');
    assert.match(h.dialog.innerHTML,/동일의 고정 묶음·팀은 중복 후처리로 바꾸지 않습니다\./,'picker help must not promise partner-repeat repair for fixed same teams');
    assert.match(h.dialog.innerHTML,/인접은 박스·근접 제약을 지키며 파트너 중복을 줄이고,/,'picker help must limit adjacent repair to the box and neighborhood constraints');
    assert.match(h.dialog.innerHTML,/인접은 휴식·늦참을 뺀 뒤 점수 내림차순 4명씩 박스로 묶고, 한 경기에서 각 박스는 최대 2명만 사용하며 가까운 박스부터 우선 혼합합니다\./,'picker help must explain adjacent score boxes, max-two-per-box, and nearest-box priority');
    assert.match(h.dialog.innerHTML,/인접한 두 박스 8명은 1·2·5·6 \/ 3·4·7·8 방식으로 섞고,/,'picker help must explain the eight-person adjacent mix');
    assert.match(h.dialog.innerHTML,/인접한 두 박스 8명은 1·2·5·6 \/ 3·4·7·8 방식으로 섞고, 출전 인원이 4명뿐인 라운드는 다른 박스와 섞지 않고 예외 편성합니다\./,'picker help must explain the adjacent four-person exception');
    assert.match(h.dialog.innerHTML,/인접은 박스·근접 제약을 지키며 파트너 중복을 줄이고, 조건상 남는 팀 동반 반복은 그대로 안내합니다\. 휴식·늦참과 랜덤은 바꾸지 않습니다\./,'picker help must explain constrained partner repair and remaining repeats without promising unlimited cross-court changes');
    await h.$('generate').onclick();
    assert.deepEqual(roster.map(person=>person.name),['중복 (회원)','중복 (게스트)','A','B','C'],'the generated roster must use the picker-local duplicate-name labels');
  }
}

async function checkLatestDrawPoints(){
  const fixture=[['주밤',116],['아식스',20],['두진',97],['시오',104]].map(([name,points],i)=>({id:'balance-'+i,name,points,type:'member',seed:'A',is_operator:0}));
  const fresh=fixture.map(p=>({...p,points:p.name==='아식스'?110:p.points}));
  const pickerInput={id:'balance-draft',participantIds:fixture.map(p=>p.id),names:fixture.map(p=>p.name),courts:1,rounds:1,schedule:[{method:'same'}],absent:[]};
  {
    const h=dialogHarness(),made=[];let current=fixture,calls=0;
    const scope={EDITOR:'operator',initial:fixture,api:async()=>{calls++;return {people:current};},syncOperators(){},message(){},dialog:h.dialog,$:h.$,esc,nameHTML:esc,seedHTML:esc,
      crypto:{randomUUID:()=> 'local-draw'},scheduleTools:createScheduleTools(),OPERATORS:new Set(),confirm:()=>true,alert(){},window:{scrollTo(){}},stamp:()=>'',editSchedule:d=>made.push(d)};
    const picker=new Function(...Object.keys(scope),'let people=initial,peopleRead=0,routeToken=1,dirty=false;'+actual('getPeople')+actual('openPicker')+';return openPicker;')(...Object.values(scope));
    await picker(pickerInput);assert.equal(calls,1,'opening a picker must refresh an existing page cache');
    current=fresh;await h.$('generate').onclick();
    assert.equal(calls,2,'generation must refresh points changed while the picker was open');
    assert.equal(made.length,1);
    const match=made[0].schedule[0].g[0],points=new Map(fresh.map(p=>[p.name,p.points]));
    assert.deepEqual([match.slice(0,2).sort(),match.slice(2).sort()].sort(),[['주밤','두진'].sort(),['아식스','시오'].sort()].sort());
    assert.equal(Math.abs(points.get(match[0])+points.get(match[1])-points.get(match[2])-points.get(match[3]))/2,0.5,'real picker must not use the outdated 20-point cache for Asics');
  }
  {
    const first=deferred(),second=deferred();let calls=0;
    const scope={initial:fixture,api:()=>++calls===1?first.promise:second.promise,syncOperators(){}};
    const cache=new Function(...Object.keys(scope),'let people=initial,peopleRead=0;'+actual('getPeople')+';return {getPeople,cached:()=>people};')(...Object.values(scope));
    const older=cache.getPeople(true),newer=cache.getPeople(true);second.resolve({people:fresh});await newer;first.resolve({people:fixture});await older;
    assert.deepEqual(cache.cached(),fresh,'an older late response cannot overwrite a newer cache');
  }
  for(const scenario of ['failure','closed','changed','removed','renamed']){
    const h=dialogHarness(),load=deferred(),made=[];let calls=0;
    const picker=compilePicker({EDITOR:'operator',getPeople:async()=>++calls===1?fresh:load.promise,message(){},people:fresh,dialog:h.dialog,$:h.$,esc,nameHTML:esc,seedHTML:esc,
      crypto:{randomUUID:()=> 'draw'},scheduleTools:createScheduleTools(),OPERATORS:new Set(),confirm:()=>true,alert(){},window:{scrollTo(){}},stamp:()=>'',editSchedule:d=>made.push(d),dirty:false});
    await picker.openPicker(pickerInput);const submit=h.$('generate'),pending=submit.onclick();await submit.onclick();assert.equal(calls,2,'double-clicking generates one fresh read');
    if(scenario==='closed')h.dialog.close();
    if(scenario==='changed')h.$('courts').value='2';
    if(scenario==='failure')load.reject(Error('offline'));
    else load.resolve(scenario==='removed'?fresh.slice(1):scenario==='renamed'?fresh.map((p,i)=>({...p,name:i?'renamed':p.name})):fresh);
    await pending;assert.equal(made.length,0,scenario+' must not generate from invalid/stale points or reopen a canceled picker');
    assert.equal(submit.disabled,false,'failed or canceled refresh releases the generate button');
    if(scenario!=='closed')assert.ok(h.$('pickerError').textContent);
  }
}

async function checkAddedCourtBalance(){
  const members=[['주밤',116],['아식스',110],['두진',97],['시오',104]].map(([name,points],i)=>({id:'extra-'+i,name,points}));
  const fixture=()=>({id:'local-extra',operation:'original',names:members.map(p=>p.name),participantIds:members.map(p=>p.id),schedule:[{method:'same',g:[members.map(p=>p.name)],rest:[]}],results:{'0-0':'a'}});
  const make=(initial=fixture())=>{
    const messages=[],paint={innerHTML:''};let read=async()=>members;
    const scope={initial,editRoster:members,scheduleTools:createScheduleTools(),getPeople:()=>read(),alert:text=>messages.push(text),message:text=>messages.push(text),$:()=>paint,scheduleHTML:()=>'<updated/>'};
    const h=new Function(...Object.keys(scope),'let draft=initial,routeToken=1,saving=false,addingCourt=false;function changed(){draft.operation="changed";}'+actual('addBalancedCourt')+';return {addBalancedCourt,current:()=>draft,navigate(){draft=null;routeToken++;}};')(...Object.values(scope));
    return {...h,messages,paint,setRead(fn){read=fn;}};
  };
  for(const method of ['same','balanced']){
    const h=make(),d=h.current();d.schedule[0].method=method;const original=structuredClone(d.schedule[0].g[0]);
    await h.addBalancedCourt(0);
    assert.deepEqual(d.schedule[0].g[0],original,'adding a court does not reorder a manually chosen existing team');
    assert.deepEqual(d.results,{'0-0':'a'},'adding a court does not alter a recorded existing game');
    assert.deepEqual(d.schedule[0].g[1],['주밤','두진','아식스','시오'],'a repeated same-four history changes only the added court to different partner teams');
  }
  {
    const partnerMembers=[['가',100],['나',99],['다',98],['라',97]].map(([name,points],i)=>({id:'partner-'+i,name,points}));
    const round=(method,g=[],rest=partnerMembers.map(p=>p.name))=>({method,g,rest});
    const draft={id:'random-history',operation:'original',names:partnerMembers.map(p=>p.name),participantIds:partnerMembers.map(p=>p.id),schedule:[round('random',[['가','라','나','다']]),round('same')]};
    const h=make(draft);h.setRead(async()=>partnerMembers);
    await h.addBalancedCourt(1);
    assert.deepEqual(draft.schedule[1].g,[['가','라','나','다']],'a random-round partner history must not influence an added same court');
  }
  {
    const partnerMembers=[['가',100],['나',99],['다',98],['라',97]].map(([name,points],i)=>({id:'same-cycle-'+i,name,points}));
    const round=(method,g=[],rest=partnerMembers.map(p=>p.name))=>({method,g,rest});
    const draft={id:'future-same',operation:'original',names:partnerMembers.map(p=>p.name),participantIds:partnerMembers.map(p=>p.id),schedule:[round('same'),round('same')]};
    const h=make(draft);h.setRead(async()=>partnerMembers);
    await h.addBalancedCourt(0);
    assert.deepEqual(draft.schedule[0].g,[['가','라','나','다']],'an added court in an earlier same round uses that round\'s first cycle, ignoring later same rounds');
    assert.deepEqual(draft.schedule[1].g,[],'adding an earlier same court must not alter a later same round');
  }
  {
    const partnerMembers=[['가',100],['나',99],['다',98],['라',97]].map(([name,points],i)=>({id:'same-cycle-'+i,name,points}));
    const round=(method,g=[],rest=partnerMembers.map(p=>p.name))=>({method,g,rest});
    const draft={id:'second-same',operation:'original',names:partnerMembers.map(p=>p.name),participantIds:partnerMembers.map(p=>p.id),schedule:[round('same'),round('same')]};
    const h=make(draft);h.setRead(async()=>partnerMembers);
    await h.addBalancedCourt(1);
    assert.deepEqual(draft.schedule[1].g,[['가','다','나','라']],'an added court in a later same round uses the count of earlier same rounds');
  }
  {
    const partnerMembers=[['가',100],['나',99],['다',98],['라',97]].map(([name,points],i)=>({id:'same-cycle-'+i,name,points}));
    const round=(method,g=[],rest=partnerMembers.map(p=>p.name))=>({method,g,rest});
    const draft={id:'third-interleaved-same',operation:'original',names:partnerMembers.map(p=>p.name),participantIds:partnerMembers.map(p=>p.id),schedule:[round('same'),round('random'),round('same'),round('balanced'),round('same'),round('same')]};
    const h=make(draft);h.setRead(async()=>partnerMembers);
    await h.addBalancedCourt(4);
    assert.deepEqual(draft.schedule[4].g,[['가','나','다','라']],'a third same round counts only earlier same rounds when random and balanced rounds are interleaved');
    await h.addBalancedCourt(4);
    assert.deepEqual(draft.schedule[4].g,[['가','나','다','라'],['가','나','다','라']],'adding a second court to one same round must not advance the same-round cycle');
  }
  {
    const partnerMembers=[['가',100],['나',99],['다',98],['라',97]].map(([name,points],i)=>({id:'partner-'+i,name,points}));
    const round=(method,g=[],rest=partnerMembers.map(p=>p.name))=>({method,g,rest});
    const draft={id:'later-history',operation:'original',names:partnerMembers.map(p=>p.name),participantIds:partnerMembers.map(p=>p.id),schedule:[round('balanced'),round('same',[['가','라','나','다']]) ]};
    const h=make(draft);h.setRead(async()=>partnerMembers);
    await h.addBalancedCourt(0);
    assert.deepEqual(draft.schedule[0].g,[['가','다','나','라']],'a later non-random round must prevent repeated partners in an added balanced court');
  }
  for(const scenario of ['closed','edited','failure']){
    const h=make(),d=h.current(),read=deferred();let calls=0;h.setRead(()=>{calls++;return read.promise;});
    const pending=h.addBalancedCourt(0);await h.addBalancedCourt(0);assert.equal(calls,1,'extra court double click shares one pending operation');
    if(scenario==='closed')h.navigate();if(scenario==='edited')d.operation='another-edit';
    if(scenario==='failure')read.reject(Error('offline'));else read.resolve(members);
    await pending;assert.equal(d.schedule[0].g.length,1,'stale or failed extra court read must not modify the draft');
    if(scenario!=='closed')assert.ok(h.messages.length);
  }
}

function checkPartnerSummaryDisplay(){
  const d={names:[],schedule:[]};
  const render=summary=>compile('scheduleHTML',{people:[],scheduleTools:{availableNames:()=>[],matchState:()=> 'waiting',partnerSummary:()=>summary,scoreGap:()=>null},esc,nameHTML:esc,viewRound:1});
  const renderSchedule=schedule=>compile('scheduleHTML',{people:[],scheduleTools:{availableNames:()=>[],matchState:()=> 'waiting',partnerSummary:()=>({duplicateTeams:0}),scoreGap:()=>null},esc,nameHTML:esc,viewRound:1})({names:['가','나','다','라','마','바','사','아'],schedule,results:{},absent:[]},true);
  assert.match(render({duplicateTeams:0,pairs:[]})(d,true),/팀 파트너 중복이 없습니다\. 동일은 점수순 고정 4인 묶음과 회차별 팀 조합을 유지하고, 인접은 점수순 4인 박스·박스별 최대 2명·가까운 박스 우선 제약 안에서 생성합니다\./,'editing schedule must explain same blocks and constrained adjacent generation even without repeats');
  assert.match(render({duplicateTeams:2,pairs:[]})(d,true),/팀 파트너 중복 2건이 남았습니다\. 동일의 고정 4인 묶음·팀은 유지하며, 인접은 점수순 4인 박스·박스별 한 경기 최대 2명·가까운 박스 우선 제약을 지킨 뒤에도 참가 인원·라운드 수에 따라 반복이 남을 수 있습니다\./,'editing schedule must honestly retain repeats after constrained adjacent repair');
  const fourNote=renderSchedule([{round:1,method:'balanced',g:[['가','나','다','라']],rest:[]}]);
  assert.match(fourNote,/출전 인원이 4명뿐이라 다른 박스와 섞지 않고 예외 편성했습니다\./,'editing four-person adjacent rounds must show the exception notice');
  const same=renderSchedule([{round:1,method:'same',g:[['가','나','다','라']],rest:[]}]);
  assert.doesNotMatch(same,/출전 인원이 4명뿐이라 다른 박스와 섞지 않고 예외 편성했습니다\./,'same four-person rounds must not show the adjacent exception notice');
  const eight=renderSchedule([{round:1,method:'balanced',g:[['가','나','마','바'],['다','라','사','아']],rest:[]}]);
  assert.doesNotMatch(eight,/출전 인원이 4명뿐이라 다른 박스와 섞지 않고 예외 편성했습니다\./,'eight-person adjacent rounds must not show the four-person exception notice');
  assert.match(render({duplicateTeams:0,pairs:[]})(d,true),/박스가 홀수 개면 마지막 세 박스를 함께 섞습니다\. 중복 정도가 같으면 팀 점수 균형을 맞춥니다\./,'editing help must explain the odd-box mix and equal-repeat balance priority');
}

function checkMatchWarnings(){
  const tools=createScheduleTools(),names=['A','B','C','D','E','F','G','H'],people=[100,100,70,70,100,100,99,99].map((points,index)=>({id:'p'+index,name:names[index],points}));
  const render=compile('scheduleHTML',{people:[],scheduleTools:tools,esc,nameHTML:esc,viewRound:1,winBtn:()=>'',matchStateControl:()=>''});
  const single=(method,roster=people.slice(0,4))=>render({names:names.slice(0,4),participantIds:people.slice(0,4).map(p=>p.id),schedule:[{round:1,method,g:[names.slice(0,4)]}],results:{},absent:[]},false,false,roster);
  const gapPhrase='상당한 시드 점수 차이가 존재하는 대진 입니다.',partnerPhrase='파트너가 중복된 대진입니다.',unknown='시드 점수를 확인할 수 없어 점수 차이를 계산하지 못했습니다.';
  for(const method of ['same','balanced'])for(const [points,shown] of [[71,false],[70,true],[69,true]]){
    const roster=people.slice(0,4).map((p,index)=>index>1?{...p,points}:p),html=single(method,roster);
    assert.equal(html.includes(gapPhrase),shown,method+' exact gap '+(100-points)+' must '+(shown?'warn':'stay clear'));
    assert.equal(html.includes(unknown),false,'known '+method+' gap '+(100-points)+' must not claim its points are unavailable');
  }
  const publicHTML=single('balanced'),editorHTML=render({names:names.slice(0,4),participantIds:people.slice(0,4).map(p=>p.id),schedule:[{round:1,method:'balanced',g:[names.slice(0,4)]}],results:{},absent:[]},true,true,people.slice(0,4));
  assert.match(publicHTML,/class="seed-gap-warning" role="note"/,'public detail warning is an accessible compact card');
  assert.match(editorHTML,new RegExp(gapPhrase),'editor warning uses the exact current text');
  const randomHTML=single('random');
  for(const text of [gapPhrase,unknown,partnerPhrase])assert.doesNotMatch(randomHTML,new RegExp(text),'random matches must stay clear of nonrandom warnings');
  const unknownHTML=single('same',people.slice(0,4).map((p,index)=>index===0?{...p,points:null}:p));
  assert.doesNotMatch(unknownHTML,new RegExp(gapPhrase),'unknown current points must not be treated as zero or safe');
  assert.match(unknownHTML,new RegExp(unknown),'unknown current points must explain that the nonrandom-match gap was not calculated');
  assert.match(single('balanced',[]),new RegExp(unknown),'a failed current-roster read must display an unavailable-gap note instead of reusing a cache');
  assert.match(single('balanced',people.slice(0,4).map((p,index)=>index===0?{...p,id:'renamed-id'}:p)),new RegExp(unknown),'a missing current ID must display an unavailable-gap note without a namesake fallback');

  const sharedSchedule=[
    {round:1,method:'same',g:[['A','B','C','D']]},
    {round:2,method:'balanced',g:[['A','B','E','F'],['E','G','F','H']]},
  ];
  const sharedHTML=render({names,participantIds:people.map(p=>p.id),schedule:sharedSchedule,results:{},absent:[]},false,false,people),cards=sharedHTML.split('<div class="match ').slice(1);
  assert.equal((sharedHTML.match(new RegExp(partnerPhrase,'g'))||[]).length,2,'a shared pair across same and balanced rounds warns every affected match, including its first occurrence');
  assert.match(sharedHTML,/class="partner-duplicate-warning" role="note"><span aria-hidden="true">⚠️<\/span>/,'partner warning is an accessible card with the same warning icon');
  assert.match(cards[0],new RegExp(gapPhrase),'a match with both conditions keeps its score-gap warning');
  assert.match(cards[0],new RegExp(partnerPhrase),'a match with both conditions also shows its partner warning');
  assert.match(cards[1],new RegExp(partnerPhrase),'the later cross-method occurrence shows its partner warning');
  assert.doesNotMatch(cards[2],new RegExp(partnerPhrase),'an uninvolved match card stays clear of the partner warning');
  const randomPairHTML=render({names,participantIds:people.map(p=>p.id),schedule:[{round:1,method:'same',g:[['A','B','C','D']]},{round:2,method:'random',g:[['A','B','E','F']]}],results:{},absent:[]},false,false,people);
  assert.doesNotMatch(randomPairHTML,new RegExp(partnerPhrase),'a pair repeated only in a random round is excluded from partner warnings');
}

function checkEditorRosterIsolation(){
  const stale=[{id:'p1',name:'이전 명단',points:100}],elements=new Map();let renderedRoster;
  const build=new Function('people','scheduleHTML','esc','elements',`
    let draft=null,editRoster=people,dirty=false;
    const stopPoll=()=>{},startDraft=value=>{draft=structuredClone(value);},app={innerHTML:''},crumb=()=>'',scheduleTools={},openPicker=()=>{},save=()=>{},cancelEdit=()=>{},alert=()=>{},confirm=()=>true;
    const $=id=>{if(!elements.has(id))elements.set(id,{innerHTML:'',value:'',oninput:null,onclick:null,onchange:null});return elements.get(id);};
    ${actual('editSchedule')}
    return {editSchedule,roster:()=>editRoster};
  `);
  const h=build(stale,(d,editing,results,roster)=>{renderedRoster=roster;return '';},esc,elements);
  h.editSchedule({id:'draft',version:1,title:'',results:{},absent:[],schedule:[]},[]);
  assert.deepEqual(h.roster(),[],'an editor opened after a failed detail roster read must retain its unavailable roster instead of using stale people');
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
  await checkLatestDrawPoints();
  await checkAddedCourtBalance();
  checkPartnerSummaryDisplay();
  checkMatchWarnings();
  checkEditorRosterIsolation();
  await checkSettlementVersions();
  await checkConfirmationLifecycle();
  await checkHistoryAndPeopleWrites();
  console.log('PASS: actual client factories cover notice navigation, confirmation lifecycle, canceled login, local picker state, settlement versions, and people dialogs.');
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){await runClientAuditChecks();await runProgressUIChecks();await runLiveUIChecks();}
