// This factory is serialized into the browser. Keep it self-contained.
export function createLiveView({app,api,esc,EDITOR,message,isCurrent}){
  let timer=null,activeToken=0,model={version:0,courts:[],queue:[]},editing=false,saving=false,joinDialog=null;
  const current=token=>token===activeToken&&isCurrent(token);
  const stop=()=>{if(timer){clearInterval(timer);timer=null;}if(joinDialog){joinDialog.remove();joinDialog=null;}editing=false;};
  const courtLabel=index=>(index+1)+'번 코트';
  const namesOf=item=>Array.isArray(item?.names)?item.names.map(name=>String(name||'').trim()).slice(0,4):['','','',''];
  const countNames=item=>namesOf(item).filter(Boolean).length;
  const full=item=>countNames(item)===4;
  const queue=()=>Array.isArray(model.queue)?model.queue:[];
  const versionOf=data=>Number.isInteger(data?.version)&&data.version>=0?data.version:0;
  function leaveButton(attrs,label){return '<button type="button" class="live-leave" '+attrs+' aria-label="'+esc(label)+'" title="참가 취소">×</button>';}
  function courtSlot(court,courtIndex,slot){
    const name=namesOf(court)[slot],partial=!full(court)&&court.state==='waiting';
    return '<div class="live-player'+(name?' has-name':'')+'"><span aria-label="'+courtLabel(courtIndex)+' '+(slot+1)+'번 참가자 '+(name?esc(name):'비어 있음')+'">'+(name?esc(name):'&nbsp;')+'</span>'+(name&&partial?leaveButton('data-live-leave-court="'+courtIndex+'" data-live-leave-slot="'+slot+'"',name+' 참가를 취소할까요?'):'')+'</div>';
  }
  function courtHTML(court,index){return '<section class="live-court'+(full(court)?' is-full':'')+'"><span class="live-court-name">'+courtLabel(index)+'</span><div class="live-players">'+[0,1,2,3].map(slot=>courtSlot(court,index,slot)).join('')+'</div>'+(full(court)?'<button type="button" class="primary live-end" data-live-end="'+index+'" aria-label="'+courtLabel(index)+' 대진 종료">대진 종료</button>':'')+'</section>';}
  function queueHTML(){
    const groups=queue();if(!groups.length)return'';
    return '<section class="live-queue"><h2>대기중인 다음 대진</h2><div class="live-queue-list">'+groups.map((group,groupIndex)=>'<article class="live-queue-card"><h3>대기중인 대진 '+(groupIndex+1)+'</h3><div class="live-queue-names">'+[0,1,2,3].map(slot=>{const name=namesOf(group)[slot];return '<span class="live-queue-name'+(name?' has-name':'')+'"><span class="live-queue-text" title="'+esc(name||'빈자리')+'">'+(name?esc(name):'-')+'</span>'+(name?leaveButton('data-live-leave-queue="'+groupIndex+'" data-live-leave-slot="'+slot+'"',name+' 참가를 취소할까요?'):'')+'</span>';}).join('')+'</div></article>').join('')+'</div></section>';
  }
  function render(token){
    if(!current(token))return;
    const courts=Array.isArray(model.courts)?model.courts:[],joinDisabled=courts.length?'':' disabled';
    app.innerHTML='<a class="crumb" href="#home">← 홈으로</a><section class="panel detail live-view"><div class="live-head"><div><h1>실시간대진</h1><p class="muted">오늘의 자유대진</p></div><div class="live-head-actions"><button type="button" id="liveJoin"'+joinDisabled+' title="'+(courts.length?'이름을 등록하고 대진에 들어가기':'운영진이 코트를 만들면 입장할 수 있어요.')+'">실시간대진 들어가기</button>'+(EDITOR?'<button type="button" class="primary" id="liveCreate">코트 생성하기</button>':'')+'</div></div><p class="live-note">자유대진은 시드·순위·출석에 반영되지 않습니다.</p>'+(courts.length?'<div class="live-courts">'+courts.map(courtHTML).join('')+'</div>':'<div class="live-empty"><p>아직 만든 코트가 없습니다.</p><p>운영진이 코트를 만들면 자유대진에 들어갈 수 있어요.</p></div>')+queueHTML()+'</section>';
    const join=app.querySelector('#liveJoin');if(join)join.onclick=()=>openJoinDialog(token);
    const create=app.querySelector('#liveCreate');if(create)create.onclick=()=>openCreate(token);
    app.querySelectorAll('[data-live-end]').forEach(button=>button.onclick=()=>runAction('end',{court:+button.dataset.liveEnd},token));
    app.querySelectorAll('[data-live-leave-court]').forEach(button=>button.onclick=()=>leave({court:+button.dataset.liveLeaveCourt,slot:+button.dataset.liveLeaveSlot},token));
    app.querySelectorAll('[data-live-leave-queue]').forEach(button=>button.onclick=()=>leave({court:'queue',group:+button.dataset.liveLeaveQueue,slot:+button.dataset.liveLeaveSlot},token));
  }
  async function load(token,paint=true,allowEditing=false,forcePaint=false){
    if((editing||saving)&&!allowEditing)return null;
    const startedVersion=versionOf(model),response=await api('/api/live-courts');
    if(!current(token)||((editing||saving)&&!allowEditing))return null;
    const fresh=response?.data||{version:0,courts:[],queue:[]},freshVersion=versionOf(fresh);
    const previousVersion=versionOf(model);if(freshVersion<startedVersion||freshVersion<previousVersion)return model;
    const changed=freshVersion>previousVersion;model=fresh;if(!Array.isArray(model.queue))model.queue=[];
    if(paint&&(forcePaint||changed))render(token);return model;
  }
  function startPoll(token){timer=setInterval(async()=>{if(!current(token)){stop();return;}if(editing||saving)return;const before=versionOf(model);try{await load(token);if(!current(token)||editing||saving||versionOf(model)<before)return;}catch(error){}},5000);}
  function isConflict(error){return /다른 기기|최신.*확인|충돌/.test(error?.message||'');}
  async function refreshConflict(error,token){message(error.message||'저장하지 못했어요.',true);if(isConflict(error)&&current(token)){try{await load(token);}catch(refreshError){message(refreshError.message||'최신 대진을 불러오지 못했어요.',true);}}}
  async function write(action,extra,token){
    if(saving||!current(token))return null;saving=true;
    try{const headers={'content-type':'application/json'};if(action==='create'&&EDITOR)headers['x-kokkiri-editor']=EDITOR;const response=await api('/api/live-courts',{method:'POST',headers,body:JSON.stringify({version:model.version,action,...extra})});if(!current(token))return null;model=response?.data||model;if(!Array.isArray(model.queue))model.queue=[];render(token);return model;}finally{saving=false;}
  }
  async function openCreate(token){
    if(!EDITOR||saving||!current(token))return;const value=prompt('만들 코트 수를 입력해주세요. (1~20)',String(Math.max(1,model.courts.length||1)));if(value===null)return;
    const count=Number(value);if(!Number.isInteger(count)||count<1||count>20){message('코트 수는 1~20 사이의 정수로 입력해주세요.',true);return;}
    if((model.courts.length||queue().length)&&!confirm('현재 코트와 대기중인 다음 대진이 모두 초기화됩니다. 새로 만들까요?'))return;
    try{await write('create',{count},token);}catch(error){await refreshConflict(error,token);}
  }
  async function runAction(action,extra,token){if(saving||editing||!current(token))return;try{await write(action,extra,token);}catch(error){await refreshConflict(error,token);}}
  async function leave(extra,token){const item=extra.court==='queue'?queue()[extra.group]:model.courts?.[extra.court],name=namesOf(item)[extra.slot];if(!name||!confirm(name+' 참가를 취소할까요?'))return;await runAction('leave',extra,token);}
  function closeJoinDialog(dialog=joinDialog){if(!dialog||joinDialog!==dialog)return;dialog.close();dialog.remove();joinDialog=null;editing=false;if(current(activeToken))render(activeToken);}
  function joinDestinations(){
    const courts=Array.isArray(model.courts)?model.courts:[];
    const available=courts.map((court,index)=>({court,index})).filter(({court})=>court.state==='waiting'&&!full(court));
    const items=available.map(({court,index})=>({value:String(index),label:courtLabel(index)+' · '+countNames(court)+'/4명'}));
    if(queue().length||!items.length)items.push({value:'queue',label:'다음 대진 대기'});
    return items;
  }
  function setJoinDestinations(dialog,preferred){
    if(joinDialog!==dialog)return;
    const select=dialog.querySelector('#liveJoinCourt'),items=joinDestinations(),keep=items.some(item=>item.value===preferred)?preferred:items[0].value;
    select.innerHTML=items.map(item=>'<option value="'+item.value+'">'+esc(item.label)+'</option>').join('');select.value=keep;
  }
  function showJoinError(dialog,text){const output=dialog.querySelector('#liveJoinError');if(output)output.textContent=text;}
  async function refreshJoinConflict(error,token,dialog,preferred){
    showJoinError(dialog,(error.message||'다른 사람이 먼저 변경했어요.')+' 최신 대진을 확인했어요. 내용을 확인한 뒤 완료를 다시 눌러주세요.');
    if(!isConflict(error)||!current(token)||joinDialog!==dialog)return;
    try{await load(token,false,true);if(current(token)&&joinDialog===dialog)setJoinDestinations(dialog,preferred);}catch(refreshError){showJoinError(dialog,refreshError.message||'최신 대진을 불러오지 못했어요.');}
  }
  function openJoinDialog(token){
    if(!model.courts.length||editing||saving||!current(token))return;editing=true;const destinations=joinDestinations();
    joinDialog=document.createElement('dialog');joinDialog.className='live-name-dialog';
    joinDialog.innerHTML='<form method="dialog"><div class="dialog-head"><h2>실시간대진 들어가기</h2><button type="button" class="live-dialog-close" aria-label="닫기">×</button></div><label for="liveJoinName">이름</label><input id="liveJoinName" maxlength="40" autocomplete="off" required><label for="liveJoinCourt">들어갈 대진</label><select id="liveJoinCourt">'+destinations.map(item=>'<option value="'+item.value+'">'+esc(item.label)+'</option>').join('')+'</select><p id="liveJoinError" class="live-join-error" role="alert"></p><p class="muted">완료하면 선택한 대진의 빈 자리에 순서대로 등록됩니다.</p><div class="sticky-actions"><button type="submit" class="primary" id="liveJoinSave">완료</button><button type="button" id="liveJoinCancel">취소</button></div></form>';
    document.body.append(joinDialog);const dialog=joinDialog,input=dialog.querySelector('#liveJoinName'),select=dialog.querySelector('#liveJoinCourt'),save=dialog.querySelector('#liveJoinSave'),cancel=()=>closeJoinDialog(dialog);
    dialog.querySelector('.live-dialog-close').onclick=cancel;dialog.querySelector('#liveJoinCancel').onclick=cancel;dialog.addEventListener('cancel',event=>{event.preventDefault();cancel();},{once:true});
    dialog.querySelector('form').onsubmit=async event=>{event.preventDefault();if(saving||input.dataset.composing==='true')return;const name=input.value.trim();if(!name||name.length>40){showJoinError(dialog,'이름은 1~40자로 입력해주세요.');return;}save.disabled=true;const chosen=select.value,court=chosen==='queue'?'queue':Number(chosen);try{const updated=await write('join',{court,name},token);if(updated&&current(token)&&joinDialog===dialog)closeJoinDialog(dialog);}catch(error){save.disabled=false;if(isConflict(error))await refreshJoinConflict(error,token,dialog,chosen);else showJoinError(dialog,error.message||'참가 등록을 하지 못했어요.');}};
    input.addEventListener('compositionstart',()=>input.dataset.composing='true');input.addEventListener('compositionend',()=>delete input.dataset.composing);joinDialog.showModal();input.focus();
  }
  return {open:async token=>{stop();activeToken=token;if(!current(token))return;app.innerHTML='<p class="empty">실시간대진을 불러오는 중…</p>';try{await load(token,true,false,true);if(current(token))startPoll(token);}catch(error){if(current(token))app.innerHTML='<div class="panel error-box">'+esc(error.message||'실시간대진을 불러오지 못했어요.')+'</div>';}} ,stop};
}
