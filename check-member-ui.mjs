import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { client, createMemberAccess, memberMenuLabel, memberOnlyHash } from './dist/server/boards-client.js';

const source=client.toString();
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

function actual(name){
  let start=source.indexOf('function '+name+'(');
  assert.notEqual(start,-1,'missing actual client function: '+name);
  if(source.slice(start-6,start)==='async ')start-=6;
  const brace=source.indexOf('{',start);let depth=0,quote='',escaped=false;
  for(let i=brace;i<source.length;i++){
    const ch=source[i];
    if(quote){if(escaped)escaped=false;else if(ch==='\\')escaped=true;else if(ch===quote)quote='';continue;}
    if(ch==='"'||ch==="'"||ch==='`'){quote=ch;continue;}
    if(ch==='{')depth++;else if(ch==='}'&&!--depth)return source.slice(start,i+1);
  }
  throw Error('unterminated '+name);
}
function compile(name,scope,prefix=''){return new Function(...Object.keys(scope),prefix+actual(name)+'\nreturn '+name+';')(...Object.values(scope));}

function dialogHarness(){
  const byId=new Map(),listeners=new Map();
  const make=attrs=>({attrs,value:attrs.value??'',textContent:'',disabled:false,focus(){},select(){},setAttribute(name,value){this.attrs[name]=String(value);},addEventListener(type,listener){listeners.set(this,listener);this['_'+type]=listener;},dispatch(type,event={preventDefault(){}}){this['_'+type]?.(event);}});
  const dialog={open:false,onclose:null,oncancel:null,html:'',showModal(){this.open=true;},close(){const was=this.open;this.open=false;if(was)this.onclose?.();},querySelector(selector){return selector.startsWith('#')?byId.get(selector.slice(1))||null:null;},addEventListener(){},removeEventListener(){}};
  Object.defineProperty(dialog,'innerHTML',{get(){return this.html;},set(value){this.html=String(value);byId.clear();for(const tag of this.html.matchAll(/<(button|input|form|p|div)\b([^>]*)>/g)){const attrs={};for(const attr of tag[2].matchAll(/([\w-]+)(?:="([^"]*)")?/g))attrs[attr[1]]=attr[2]??'';const node=make(attrs);if(attrs.id)byId.set(attrs.id,node);}}});
  return {dialog,$:id=>byId.get(id)||null};
}

function checkAccessContract(){
  assert.equal(memberOnlyHash('#schedule'),true);assert.equal(memberOnlyHash('#live'),true);assert.equal(memberOnlyHash('#seed'),true);
  assert.equal(memberOnlyHash('#notice'),false);assert.equal(memberOnlyHash('#post/notice'),false);
  const member=createMemberAccess('',false);assert.equal(member.allowed(),false);member.update(true);assert.equal(member.allowed(),true);member.revoke();assert.equal(member.allowed(),false);
  const editor=createMemberAccess('editor-key',false);assert.equal(editor.allowed(),true);editor.revoke();assert.equal(editor.allowed(),true,'EDITOR always implies member access');
  assert.equal(memberMenuLabel(false),'회원권한');assert.equal(memberMenuLabel(true),'회원 로그아웃');
  assert.match(source,/menu\.append\(memberItem,opItem,adItem\)/,'the rendered access menu orders member access before operator access');
  assert.doesNotMatch(source,/localStorage|actualPIN/i,'member UI never persists access locally or uses a PIN field name');
}

async function checkPublicHomeMvp(){
  const app={innerHTML:''},mvp={innerHTML:''};let calls=0;
  const home=compile('home',{routeToken:1,app,$:id=>id==='mvpHome'?mvp:null,EDITOR:'',openPicker(){},memberAccess:{allowed:()=>false},api:async()=>{calls++;throw Error('public home must not request MVP');},esc});
  await home();assert.equal(calls,0,'public home does not fetch or display MVP data');assert.match(app.innerHTML,/href="#notice"/,'public home retains the notice route');
  const signedIn=compile('home',{routeToken:1,app,$:id=>id==='mvpHome'?mvp:null,EDITOR:'',openPicker(){},memberAccess:{allowed:()=>true},api:async()=>({mvp:['회원'],id:'schedule-1',settledAt:new Date().toISOString()}),esc});
  await signedIn();assert.match(mvp.innerHTML,/이번 정모 MVP/,'member home fetches and displays MVP data');
}

async function checkRoutesAndMemberOnlyResponse(){
  const calls=[],gates=[];
  const route=compile('route',{location:{hash:'#schedule'},routeToken:0,lastHash:'',draft:null,viewRound:1,stopPoll(){},app:{innerHTML:''},memberAccess:{allowed:()=>false},gateProtectedRoute:hash=>gates.push(hash),board:async()=>calls.push('board'),seeds:async()=>calls.push('seed'),liveView:{open:async()=>calls.push('live')},detail:async()=>calls.push('detail'),home(){calls.push('home');},crumb:()=>'',esc,$:()=>null});
  await route();assert.deepEqual(gates,['#schedule']);assert.deepEqual(calls,[],'protected hash routes are denied before any data fetch/render function');
  const noticeCalls=[];
  const noticeRoute=compile('route',{location:{hash:'#notice'},routeToken:0,lastHash:'',draft:null,viewRound:1,stopPoll(){},app:{innerHTML:''},memberAccess:{allowed:()=>false},gateProtectedRoute(){throw Error('notice must stay public');},board:async kind=>noticeCalls.push(kind),seeds:async()=>{},liveView:null,detail:async()=>{},home(){},crumb:()=>'',esc,$:()=>null});
  await noticeRoute();assert.deepEqual(noticeCalls,['notice']);

  let invalidated=0,shown=0,directReads=0;const api=compile('api',{EDITOR:'editor-key',memberAuthEpoch:0,routeToken:1,activeMemberContent:false,memberOnlyHash,location:{href:'https://kokkiri.example/#post/schedule-1',origin:'https://kokkiri.example',hash:'#post/schedule-1'},fetch:async()=>{directReads++;return {ok:false,status:401,json:async()=>({code:'MEMBERS_ONLY',error:'denied'})};},pendingMemberTarget:'',invalidateMemberAccess(){invalidated++;},showMemberGate(){shown++;},renderCurrentPublicRoute(){}});
  await assert.rejects(()=>api('/api/posts/schedule-1'),error=>error.status===401&&error.code==='MEMBERS_ONLY'&&error.memberOnly===true);
  assert.equal(directReads,1);assert.equal(invalidated,1);assert.equal(shown,1,'a public initial direct schedule detail performs one fetch, then uses the member gate from its 401');
  let sent;
  const headerApi=compile('api',{EDITOR:'editor-key',memberAuthEpoch:0,routeToken:1,activeMemberContent:false,memberOnlyHash,location:{href:'https://kokkiri.example/',origin:'https://kokkiri.example',hash:'#home'},fetch:async(path,options)=>{sent={path,options};return {ok:true,status:200,json:async()=>({ok:true})};},pendingMemberTarget:'',invalidateMemberAccess(){},showMemberGate(){},renderCurrentPublicRoute(){}});
  await headerApi('/api/people');assert.equal(new Headers(sent.options.headers).get('x-kokkiri-editor'),'editor-key','same-origin API calls receive the editor header automatically');
  await headerApi('https://elsewhere.example/api/people');assert.equal(new Headers(sent.options.headers||{}).get('x-kokkiri-editor'),null,'external requests never receive the editor header');
  const old401=deferred();let oldInvalidated=0,oldGate=0;
  const oldRequest=new Function('location','fetch','invalidateMemberAccess','showMemberGate','renderCurrentPublicRoute','memberOnlyHash','EDITOR',`let memberAuthEpoch=0,pendingMemberTarget='',routeToken=1,activeMemberContent=true;${actual('api')}return {api,login(){memberAuthEpoch++;}};`)({href:'https://kokkiri.example/',origin:'https://kokkiri.example',hash:'#schedule'},()=>old401.promise,()=>oldInvalidated++,()=>oldGate++,()=>{},memberOnlyHash,'');
  const pending401=oldRequest.api('/api/people');oldRequest.login();old401.resolve({ok:false,status:401,json:async()=>({code:'MEMBERS_ONLY',error:'expired'})});
  await assert.rejects(()=>pending401,error=>error.code==='MEMBERS_ONLY'&&!error.memberOnly);assert.equal(oldInvalidated,0);assert.equal(oldGate,0,'a 401 from before a new login cannot revoke the new member session');
  const moved401=deferred(),movedLocation={href:'https://kokkiri.example/#schedule',origin:'https://kokkiri.example',hash:'#schedule'};let movedInvalidated=0,movedGate=0,movedPublic=0;
  const moved=new Function('location','fetch','invalidateMemberAccess','showMemberGate','renderCurrentPublicRoute','memberOnlyHash','EDITOR',`let memberAuthEpoch=0,pendingMemberTarget='',routeToken=1,activeMemberContent=true;${actual('api')}return {api,navigateNotice(){routeToken++;activeMemberContent=false;location.hash='#notice';}};`)(movedLocation,()=>moved401.promise,()=>movedInvalidated++,()=>movedGate++,()=>movedPublic++,memberOnlyHash,'');
  const pendingMoved=moved.api('/api/people');moved.navigateNotice();moved401.resolve({ok:false,status:401,json:async()=>({code:'MEMBERS_ONLY',error:'expired'})});await assert.rejects(()=>pendingMoved,error=>error.code==='MEMBERS_ONLY');assert.equal(movedInvalidated,1);assert.equal(movedGate,0);assert.equal(movedPublic,1,'a delayed private 401 after navigating to notice preserves the current public route instead of opening a gate');
}

async function checkMemberLoginOwnership(){
  const h=dialogHarness(),access=createMemberAccess('',false),request=deferred(),routes=[];
  const open=compile('openMemberLoginDialog',{$:h.$,dialog:h.dialog,api:()=>request.promise,memberAccess:access,refreshMemberMenu(){},location:{hash:'#schedule'},route:()=>routes.push('route'),memberDialogOwner:0,memberAuthEpoch:0,memberSessionRead:0,memberLoginPending:false,memberLoginPendingOwner:0},'let pendingMemberTarget="#schedule";');
  open();h.$('cancelMemberLogin').onclick();assert.equal(h.dialog.open,false,'cancel works before a member-login request starts');
  open();h.$('memberPassword').dispatch('compositionstart');await h.$('memberLoginForm').onsubmit({preventDefault(){},isComposing:true});assert.equal(access.allowed(),false,'IME composition cannot submit a partial member password');
  h.$('memberPassword').dispatch('compositionend');const first=h.$('memberLoginForm').onsubmit({preventDefault(){}}),second=h.$('memberLoginForm').onsubmit({preventDefault(){}});h.$('cancelMemberLogin').onclick();let prevented=false;h.dialog.oncancel({preventDefault(){prevented=true;}});assert.equal(h.dialog.open,true);assert.equal(prevented,true,'cancel and Escape stay disabled while the login request is in flight');
  request.resolve({member:true});await first;await second;assert.equal(access.allowed(),true);assert.deepEqual(routes,['route'],'successful member login returns to the attempted protected route');

  const failed=dialogHarness(),failedAccess=createMemberAccess('',false),rejected=deferred();
  const retry=compile('openMemberLoginDialog',{$:failed.$,dialog:failed.dialog,api:()=>rejected.promise,memberAccess:failedAccess,refreshMemberMenu(){},location:{hash:'#home'},route(){},memberDialogOwner:0,memberAuthEpoch:0,memberSessionRead:0,memberLoginPending:false,memberLoginPendingOwner:0},'let pendingMemberTarget="";');
  retry();const pending=failed.$('memberLoginForm').onsubmit({preventDefault(){}});rejected.reject(Error('연결 실패'));await pending;
  assert.equal(failed.$('cancelMemberLogin').disabled,false,'a failed login re-enables cancellation for retry');
}

async function checkPendingLoginHashChange(){
  const h=dialogHarness(),request=deferred(),access=createMemberAccess('',false),historyWrites=[],location={hash:'#home'};
  const build=new Function('$','dialog','api','memberAccess','refreshMemberMenu','location','history','route','window','confirm',`
    let memberDialogOwner=0,memberAuthEpoch=0,memberSessionRead=0,memberLoginPending=false,memberLoginPendingOwner=0,pendingMemberTarget='#schedule',saving=false,dirty=false,lastHash='#home';
    ${actual('openMemberLoginDialog')}
    ${actual('handleHashChange')}
    return {openMemberLoginDialog,handleHashChange};
  `)(h.$,h.dialog,()=>request.promise,access,()=>{},location,{replaceState:(...args)=>historyWrites.push(args)},()=>{}, {scrollTo(){}},()=>true);
  build.openMemberLoginDialog();const pending=h.$('memberLoginForm').onsubmit({preventDefault(){}});
  build.handleHashChange();assert.equal(h.dialog.open,true,'a browser hash change cannot close an in-flight login');assert.deepEqual(historyWrites,[[null,'','#home']]);
  request.resolve({member:true});await pending;assert.equal(access.allowed(),true);assert.equal(location.hash,'#schedule','the completed login still navigates to its intended protected route');
}

function checkGateLogoutAndInvalidation(){
  {
    const h=dialogHarness(),app={innerHTML:'private'},homes=[];
    const gate=new Function('$','dialog','app','stopPoll','renderPublicHome',`let memberDialogOwner=0;${actual('showMemberGate')}return {showMemberGate,claim(){memberDialogOwner++;}};`)(h.$,h.dialog,app,()=>{},()=>homes.push('home'));
    gate.showMemberGate();h.$('memberOnlyConfirm').onclick();assert.deepEqual(homes,['home'],'confirming a member gate renders the public home');assert.equal(h.dialog.innerHTML,'','a closed gate clears only its own dialog');
    gate.showMemberGate();gate.claim();h.dialog.innerHTML='<form id="memberLoginForm"></form>';h.dialog.close();assert.deepEqual(homes,['home'],'a stale gate close cannot erase a replacement login or reroute it');assert.match(h.dialog.innerHTML,/memberLoginForm/);
  }
  {
    const access=createMemberAccess('',true),button={disabled:false},calls=[],homes=[];let invalidated=0;
    const logout=compile('logoutMember',{memberAccess:access,api:async(...args)=>{calls.push(args);return {member:false};},invalidateMemberAccess(){invalidated++;},renderPublicHome:()=>homes.push('home'),message(){},EDITOR:''},'let pendingMemberTarget="#post/old";');
    return logout(button).then(()=>{assert.equal(invalidated,1);assert.deepEqual(homes,['home'],'logout always renders home, including public-route origins');assert.equal(button.disabled,false);assert.equal(calls[0][0],'/api/member-logout');});
  }
}

function checkAsyncCloseOwnership(){
  const genericHarness=dialogHarness(),generic=compile('openLoginDialog',{$:genericHarness.$,dialog:genericHarness.dialog,api:async()=>({redirect:'/operate-safe'}),esc,location:{assign(){}}});
  generic('운영진권한','비밀번호','/api/operator-login',/^\/operate-safe$/,'이동');genericHarness.dialog.onclose();assert.ok(genericHarness.$('loginForm'),'a queued old close event cannot clear a newly opened generic login');
  const memberHarness=dialogHarness(),member=compile('openMemberLoginDialog',{$:memberHarness.$,dialog:memberHarness.dialog,api:async()=>({member:true}),memberAccess:createMemberAccess('',false),refreshMemberMenu(){},location:{hash:'#home'},route(){},memberDialogOwner:0,memberAuthEpoch:0,memberSessionRead:0},'let pendingMemberTarget="";');
  member();memberHarness.dialog.onclose();assert.ok(memberHarness.$('memberLoginForm'),'a queued old close event cannot clear a newly opened member login');
  const gateHarness=dialogHarness(),homes=[];
  const gate=new Function('$','dialog','app','stopPoll','renderPublicHome',`let memberDialogOwner=0;${actual('showMemberGate')}return showMemberGate;`)(gateHarness.$,gateHarness.dialog,{innerHTML:''},()=>{},()=>homes.push('home'));
  gate();gateHarness.dialog.onclose();assert.ok(gateHarness.$('memberOnlyGate'));assert.deepEqual(homes,[],'a queued old close event cannot dismiss a newly shown member gate');
}

async function checkSessionRevalidation(){
  const make=({serverMember=true,active=true}={})=>{
    const access=createMemberAccess('',true),events=[];
    const build=new Function('memberAccess','api','document','memberOnlyHash','invalidateMemberAccess','showMemberGate','renderPublicHome','location','EDITOR',`
      let memberSessionRead=0,memberAuthEpoch=0,activeMemberContent=${active},pendingMemberTarget='';
      ${actual('revalidateMemberSession')}
      return {revalidateMemberSession};
    `);
    return {access,events,view:build(access,async()=>({member:serverMember}),{visibilityState:'visible'},memberOnlyHash,()=>events.push('invalidate'),()=>events.push('gate'),()=>events.push('home'),{hash:'#notice'},'')};
  };
  const valid=make({serverMember:true,active:false});await valid.view.revalidateMemberSession();assert.deepEqual(valid.events,[],'a valid focus/session check does not route or repaint');
  const expired=make({serverMember:false,active:true});await expired.view.revalidateMemberSession();assert.deepEqual(expired.events,['invalidate','gate'],'an expired private session clears private UI and uses the gate');
  const publicExpired=make({serverMember:false,active:false});await publicExpired.view.revalidateMemberSession();assert.deepEqual(publicExpired.events,['invalidate','home'],'an expired public session returns to the public home without a private fetch');
  let resolve;const pending=new Promise(yes=>{resolve=yes;}),access=createMemberAccess('',true),events=[];
  const late=new Function('memberAccess','api','document','memberOnlyHash','invalidateMemberAccess','showMemberGate','renderPublicHome','location','EDITOR',`let memberSessionRead=0,memberAuthEpoch=0,activeMemberContent=true,pendingMemberTarget='';${actual('revalidateMemberSession')}return {revalidateMemberSession,login(){memberAuthEpoch++;}};`)(access,()=>pending,{visibilityState:'visible'},memberOnlyHash,()=>events.push('invalidate'),()=>events.push('gate'),()=>events.push('home'),{hash:'#schedule'},'');
  const check=late.revalidateMemberSession();late.login();resolve({member:false});await check;assert.deepEqual(events,[],'a late session response from before a new login cannot repaint or revoke access');
}

export async function runMemberUIChecks(){
  checkAccessContract();
  await checkPublicHomeMvp();
  await checkRoutesAndMemberOnlyResponse();
  await checkMemberLoginOwnership();
  await checkPendingLoginHashChange();
  await checkGateLogoutAndInvalidation();
  checkAsyncCloseOwnership();
  await checkSessionRevalidation();
  console.log('PASS: member UI covers public home, menu order, protected routes, member-only revocation, automatic editor headers, and login ownership.');
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await runMemberUIChecks();
