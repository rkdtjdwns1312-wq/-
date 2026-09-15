// This factory is serialized into the browser. Keep it self-contained.
export function createLiveView({app,api,esc,EDITOR,message,isCurrent}){
  let timer=null,activeToken=0,model={version:0,isOpen:false,courts:[],queue:[]},editing=false,saving=false,joinDialog=null,toggleDialog=null,cancelDialog=null,noticeDialog=null;
  const current=token=>token===activeToken&&isCurrent(token);
  const stop=()=>{if(timer){clearInterval(timer);timer=null;}if(joinDialog){joinDialog.remove();joinDialog=null;}if(toggleDialog){toggleDialog.remove();toggleDialog=null;}if(cancelDialog){cancelDialog.remove();cancelDialog=null;}if(noticeDialog){noticeDialog.remove();noticeDialog=null;}editing=false;};
  const courtLabel=index=>(index+1)+'번 코트';
  const namesOf=item=>Array.isArray(item?.names)?item.names.map(name=>String(name||'').trim()).slice(0,4):['','','',''];
  const countNames=item=>namesOf(item).filter(Boolean).length;
  const full=item=>countNames(item)===4;
  const queue=()=>Array.isArray(model.queue)?model.queue:[];
  const versionOf=data=>Number.isInteger(data?.version)&&data.version>=0?data.version:0;
  function leaveButton(attrs,label){return '<button type="button" class="live-leave" '+attrs+' aria-label="'+esc(label)+'" title="참가 취소">×</button>';}
  function addButton(attrs,label){return '<button type="button" class="live-add" '+attrs+' aria-label="'+esc(label)+'" title="빈자리 채우기">+</button>';}
  function courtSlot(court,courtIndex,slot){
    const name=namesOf(court)[slot],partial=Boolean(model.isOpen)&&!full(court)&&court.state==='waiting';
    return '<div class="live-player'+(name?' has-name':'')+'"><span aria-label="'+courtLabel(courtIndex)+' '+(slot+1)+'번 참가자 '+(name?esc(name):'비어 있음')+'">'+(name?esc(name):'빈자리')+'</span>'+(partial?(name?leaveButton('data-live-leave-court="'+courtIndex+'" data-live-leave-slot="'+slot+'"',name+' 참가를 취소할까요?'):addButton('data-live-add-court="'+courtIndex+'" data-live-add-slot="'+slot+'"',courtLabel(courtIndex)+' 빈자리 채우기')):'')+'</div>';
  }
  function courtHTML(court,index){const waiting=model.isOpen&&court.state==='waiting'&&countNames(court)>0;return '<section class="live-court'+(full(court)?' is-full':'')+'"><div class="live-court-top"><span class="live-court-name">'+courtLabel(index)+'</span>'+(waiting?'<button type="button" class="live-cancel" data-live-cancel-court="'+index+'">대기 취소</button>':'')+'</div><div class="live-players">'+[0,1,2,3].map(slot=>courtSlot(court,index,slot)).join('')+'</div>'+(model.isOpen&&full(court)?'<button type="button" class="primary live-end" data-live-end="'+index+'" aria-label="'+courtLabel(index)+' 대진 종료">대진 종료</button>':'')+'</section>';}
  function queueHTML(){
    const groups=queue();if(!groups.length)return'';
    return '<section class="live-queue"><h2>대기중인 다음 대진</h2><div class="live-queue-list">'+groups.map((group,groupIndex)=>'<article class="live-queue-card"><div class="live-queue-top"><h3>대기중인 대진 '+(groupIndex+1)+'</h3>'+(model.isOpen?'<button type="button" class="live-cancel" data-live-cancel-queue="'+groupIndex+'">대기 취소</button>':'')+'</div><div class="live-queue-names">'+[0,1,2,3].map(slot=>{const name=namesOf(group)[slot];return '<span class="live-queue-name'+(name?' has-name':'')+'"><span class="live-queue-text" title="'+esc(name||'빈자리')+'">'+(name?esc(name):'빈자리')+'</span>'+(model.isOpen?(name?leaveButton('data-live-leave-queue="'+groupIndex+'" data-live-leave-slot="'+slot+'"',name+' 참가를 취소할까요?'):addButton('data-live-add-queue="'+groupIndex+'" data-live-add-slot="'+slot+'"','대기중인 대진 '+(groupIndex+1)+' 빈자리 채우기')):'')+'</span>';}).join('')+'</div></article>').join('')+'</div></section>';
  }
  function render(token){
    if(!current(token))return;
    const open=Boolean(model.isOpen),courts=Array.isArray(model.courts)?model.courts:[],joinDisabled=open&&courts.length?'':' disabled',showBoards=open||Boolean(EDITOR);
    app.innerHTML='<a class="crumb" href="#home">← 홈으로</a><section class="panel detail live-view"><div class="live-head"><div><h1>실시간대진</h1><p class="muted">오늘의 자유대진</p></div><div class="live-head-actions">'+(open?'<button type="button" id="liveJoin"'+joinDisabled+' title="'+(courts.length?'이름을 등록하고 대진에 들어가기':'운영진이 코트를 만들면 입장할 수 있어요.')+'">실시간대진 들어가기</button>':'')+(EDITOR?'<button type="button" id="liveToggle" class="'+(open?'danger':'primary')+'">'+(open?'실시간대진 종료':'실시간대진 열기')+'</button><button type="button" class="primary" id="liveCreate">코트 생성하기</button>':'')+'</div></div><p class="live-note">자유대진은 시드·순위·출석에 반영되지 않습니다.</p>'+(!open&&!EDITOR?'<div class="live-empty"><p>운영진이 실시간대진을 열면 입장할 수 있어요.</p></div>':(showBoards?(courts.length?'<div class="live-courts">'+courts.map(courtHTML).join('')+'</div>':'<div class="live-empty"><p>아직 만든 코트가 없습니다.</p><p>운영진이 코트를 만들면 자유대진에 들어갈 수 있어요.</p></div>')+queueHTML():''))+'</section>';
    const join=app.querySelector('#liveJoin');if(join)join.onclick=()=>openJoinDialog(token);
    const create=app.querySelector('#liveCreate');if(create)create.onclick=()=>openCreate(token);
    const toggle=app.querySelector('#liveToggle');if(toggle)toggle.onclick=()=>openToggleDialog(token);
    app.querySelectorAll('[data-live-end]').forEach(button=>button.onclick=()=>runAction('end',{court:+button.dataset.liveEnd},token));
    app.querySelectorAll('[data-live-leave-court]').forEach(button=>button.onclick=()=>leave({court:+button.dataset.liveLeaveCourt,slot:+button.dataset.liveLeaveSlot},token));
    app.querySelectorAll('[data-live-leave-queue]').forEach(button=>button.onclick=()=>leave({court:'queue',group:+button.dataset.liveLeaveQueue,slot:+button.dataset.liveLeaveSlot},token));
    app.querySelectorAll('[data-live-add-court]').forEach(button=>button.onclick=()=>openJoinDialog(token,{court:+button.dataset.liveAddCourt,slot:+button.dataset.liveAddSlot}));
    app.querySelectorAll('[data-live-add-queue]').forEach(button=>button.onclick=()=>openJoinDialog(token,{court:'queue',group:+button.dataset.liveAddQueue,slot:+button.dataset.liveAddSlot}));
    app.querySelectorAll('[data-live-cancel-court]').forEach(button=>button.onclick=()=>openCancelDialog({court:+button.dataset.liveCancelCourt},token));
    app.querySelectorAll('[data-live-cancel-queue]').forEach(button=>button.onclick=()=>openCancelDialog({court:'queue',group:+button.dataset.liveCancelQueue},token));
  }
  async function load(token,paint=true,allowEditing=false,forcePaint=false,gateOnly=false){
    if(saving||(editing&&!allowEditing))return null;
    const startedVersion=versionOf(model),response=await api('/api/live-courts',EDITOR?{headers:{'x-kokkiri-editor':EDITOR}}:undefined);
    if(!current(token)||saving||(editing&&!allowEditing))return null;
    const fresh=response?.data||{version:0,isOpen:false,courts:[],queue:[]},freshVersion=versionOf(fresh);
    const previousVersion=versionOf(model);if(freshVersion<startedVersion||freshVersion<previousVersion)return model;
    const changed=freshVersion>previousVersion,wasOpen=Boolean(model.isOpen),nowOpen=Boolean(fresh.isOpen),remoteClosed=Boolean(joinDialog)&&wasOpen&&!nowOpen;
    if(gateOnly&&joinDialog&&!remoteClosed)return model;
    model=fresh;if(!Array.isArray(model.queue))model.queue=[];
    if(remoteClosed)closeJoinDialog(joinDialog,false);
    if(remoteClosed||(paint&&(forcePaint||changed)&&!editing))render(token);return model;
  }
  function startPoll(token){timer=setInterval(async()=>{if(!current(token)){stop();return;}if(saving)return;const before=versionOf(model);try{await load(token,true,true,false,true);if(!current(token)||saving||versionOf(model)<before)return;}catch(error){}},5000);}
  function isConflict(error){return /다른 기기|최신.*확인|충돌|실시간대진이 종료/.test(error?.message||'');}
  async function refreshConflict(error,token){message(error.message||'저장하지 못했어요.',true);if(isConflict(error)&&current(token)){try{await load(token);}catch(refreshError){message(refreshError.message||'최신 대진을 불러오지 못했어요.',true);}}}
  async function write(action,extra,token,expectedVersion=model.version){
    if(saving||!current(token))return null;saving=true;
    try{const headers={'content-type':'application/json'};if(['create','open','close'].includes(action)&&EDITOR)headers['x-kokkiri-editor']=EDITOR;const response=await api('/api/live-courts',{method:'POST',headers,body:JSON.stringify({version:expectedVersion,action,...extra})});if(!current(token))return null;model=response?.data||model;if(!Array.isArray(model.queue))model.queue=[];render(token);return model;}finally{saving=false;}
  }
  async function openCreate(token){
    if(!EDITOR||saving||!current(token))return;const value=prompt('만들 코트 수를 입력해주세요. (1~20)',String(Math.max(1,model.courts.length||1)));if(value===null)return;
    const count=Number(value);if(!Number.isInteger(count)||count<1||count>20){message('코트 수는 1~20 사이의 정수로 입력해주세요.',true);return;}
    if((model.courts.length||queue().length)&&!confirm('현재 코트와 대기중인 다음 대진이 모두 초기화됩니다. 새로 만들까요?'))return;
    try{await write('create',{count},token);}catch(error){await refreshConflict(error,token);}
  }
  function closeToggleDialog(dialog=toggleDialog){if(!dialog||toggleDialog!==dialog)return;dialog.close();dialog.remove();toggleDialog=null;}
  function showToggleError(dialog,text){const output=dialog.querySelector('#liveToggleError');if(output)output.textContent=text;}
  function closeCancelDialog(dialog=cancelDialog){if(!dialog||cancelDialog!==dialog)return;dialog.close();dialog.remove();cancelDialog=null;}
  function openCancelDialog(extra,token){
    if(saving||cancelDialog||!current(token))return;const expectedVersion=model.version;
    cancelDialog=document.createElement('dialog');cancelDialog.className='live-confirm-dialog';
    cancelDialog.innerHTML='<div class="confirm-box"><p class="confirm-msg">대기 취소하시겠습니까?</p><p id="liveCancelError" class="live-join-error" role="alert"></p><div class="confirm-actions"><button type="button" id="liveCancelNo">아니오</button><button type="button" id="liveCancelYes" class="danger">예</button></div></div>';
    document.body.append(cancelDialog);const dialog=cancelDialog,yes=dialog.querySelector('#liveCancelYes'),close=()=>closeCancelDialog(dialog);
    dialog.querySelector('#liveCancelNo').onclick=close;dialog.addEventListener('cancel',event=>{event.preventDefault();close();},{once:true});
    yes.onclick=async()=>{if(saving||yes.disabled||!current(token)||cancelDialog!==dialog)return;yes.disabled=true;try{const updated=await write('cancel',extra,token,expectedVersion);if(updated&&current(token)&&cancelDialog===dialog)close();}catch(error){if(isConflict(error)){close();await refreshConflict(error,token);}else{yes.disabled=false;const output=dialog.querySelector('#liveCancelError');if(output)output.textContent=error.message||'대기 취소를 하지 못했어요.';}}};
    dialog.showModal();yes.focus();
  }
  function closeNoticeDialog(dialog=noticeDialog){if(!dialog||noticeDialog!==dialog)return;dialog.close();dialog.remove();noticeDialog=null;}
  function openCurrentGameNotice(){
    if(noticeDialog)return;
    noticeDialog=document.createElement('dialog');noticeDialog.className='live-confirm-dialog';
    noticeDialog.innerHTML='<div class="confirm-box"><p class="confirm-msg">현재 게임중인 회원입니다. 등록할 수 없습니다.</p><div class="confirm-actions"><button type="button" id="liveDuplicateOk" class="primary">확인</button></div></div>';
    document.body.append(noticeDialog);const dialog=noticeDialog,close=()=>closeNoticeDialog(dialog);
    dialog.querySelector('#liveDuplicateOk').onclick=close;dialog.addEventListener('cancel',event=>{event.preventDefault();close();},{once:true});dialog.showModal();dialog.querySelector('#liveDuplicateOk').focus();
  }
  function openToggleDialog(token){
    if(!EDITOR||saving||toggleDialog||!current(token))return;
    const opening=!model.isOpen,action=opening?'open':'close',expectedVersion=model.version,question=opening?'실시간대진을 시작하시겠습니까?':'실시간대진을 종료하시겠습니까?';
    toggleDialog=document.createElement('dialog');toggleDialog.className='live-confirm-dialog';
    toggleDialog.innerHTML='<div class="confirm-box"><p class="confirm-msg">'+question+'</p><p id="liveToggleError" class="live-join-error" role="alert"></p><div class="confirm-actions"><button type="button" id="liveToggleNo">아니오</button><button type="button" id="liveToggleYes" class="primary">예</button></div></div>';
    document.body.append(toggleDialog);const dialog=toggleDialog,yes=dialog.querySelector('#liveToggleYes'),cancel=()=>closeToggleDialog(dialog);
    dialog.querySelector('#liveToggleNo').onclick=cancel;dialog.addEventListener('cancel',event=>{event.preventDefault();cancel();},{once:true});
    yes.onclick=async()=>{if(saving||yes.disabled||!current(token)||toggleDialog!==dialog)return;yes.disabled=true;try{const updated=await write(action,{},token,expectedVersion);if(updated&&current(token)&&toggleDialog===dialog)closeToggleDialog(dialog);}catch(error){if(isConflict(error)){showToggleError(dialog,'최신 상태를 확인한 뒤 버튼을 다시 눌러 새로 확인해주세요.');try{await load(token,true,false,true);}catch(refreshError){message(refreshError.message||'최신 대진을 불러오지 못했어요.',true);}closeToggleDialog(dialog);message(error.message||'다른 사람이 먼저 변경했어요.',true);}else{yes.disabled=false;showToggleError(dialog,error.message||'실시간대진 상태를 바꾸지 못했어요.');}}};
    dialog.showModal();yes.focus();
  }
  async function runAction(action,extra,token){if(saving||editing||!current(token)||(!model.isOpen&&['join','leave','end'].includes(action)))return;try{await write(action,extra,token);}catch(error){await refreshConflict(error,token);}}
  async function leave(extra,token){const item=extra.court==='queue'?queue()[extra.group]:model.courts?.[extra.court],name=namesOf(item)[extra.slot];if(!name||!confirm(name+' 참가를 취소할까요?'))return;await runAction('leave',extra,token);}
  function closeJoinDialog(dialog=joinDialog,repaint=true){if(!dialog||joinDialog!==dialog)return;closeNoticeDialog();dialog.close();dialog.remove();joinDialog=null;editing=false;if(repaint&&current(activeToken))render(activeToken);}
  function joinDestinations(){
    const courts=Array.isArray(model.courts)?model.courts:[];
    const available=courts.map((court,index)=>({court,index})).filter(({court})=>court.state==='waiting'&&!full(court));
    const items=available.map(({court,index})=>({value:String(index),label:courtLabel(index)+' · '+countNames(court)+'/4명'})),waitingIndex=queue().findIndex(group=>!full(group));
    if(queue().length||!items.length)items.push(waitingIndex>=0?{value:'queue:'+waitingIndex,label:'대기중인 대진 '+(waitingIndex+1)+' · '+countNames(queue()[waitingIndex])+'/4명'}:{value:'queue',label:'다음 대진 대기 · 0/4명'});
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
    try{await load(token,false,true);if(current(token)&&joinDialog===dialog){if(!model.isOpen){closeJoinDialog(dialog,false);render(token);return;}setJoinDestinations(dialog,preferred);}}catch(refreshError){showJoinError(dialog,refreshError.message||'최신 대진을 불러오지 못했어요.');}
  }
  function openJoinDialog(token,target=null){
    if(!model.isOpen||!model.courts.length||editing||saving||!current(token))return;editing=true;const single=Boolean(target),destinations=joinDestinations();
    const targetValue=target?(target.court==='queue'?'queue:'+target.group:String(target.court)):null,targetLabel=target?(target.court==='queue'?'대기중인 대진 '+(target.group+1):courtLabel(target.court)):'';
    joinDialog=document.createElement('dialog');joinDialog.className='live-name-dialog';
    const fields=Array.from({length:single?1:4},(_,index)=>{const id=index?'liveJoinName'+(index+1):'liveJoinName';return '<label for="'+id+'">이름 '+(index+1)+'</label><input class="live-join-name" id="'+id+'" maxlength="40" autocomplete="off" placeholder="'+(index?'선택 입력':'이름을 입력해주세요')+'">';}).join('');
    joinDialog.innerHTML='<form method="dialog"><div class="dialog-head"><h2>'+(single?'빈자리 채우기':'실시간대진 들어가기')+'</h2><button type="button" class="live-dialog-close" aria-label="닫기">×</button></div><div class="live-name-fields">'+fields+'</div><label for="liveJoinCourt">들어갈 대진</label><select id="liveJoinCourt"'+(single?' disabled':'')+'>'+(single?'<option value="'+targetValue+'">'+esc(targetLabel)+'</option>':destinations.map(item=>'<option value="'+item.value+'">'+esc(item.label)+'</option>').join(''))+'</select><p id="liveJoinError" class="live-join-error" role="alert"></p><p class="muted">'+(single?'이름을 입력하면 선택한 빈자리에 등록됩니다.':'1명부터 4명까지 입력한 뒤 한 번에 등록할 수 있습니다.')+'</p><div class="sticky-actions"><button type="submit" class="primary" id="liveJoinSave">완료</button><button type="button" id="liveJoinCancel">취소</button></div></form>';
    document.body.append(joinDialog);const dialog=joinDialog,inputs=[...dialog.querySelectorAll('.live-join-name')],input=inputs[0],select=dialog.querySelector('#liveJoinCourt'),save=dialog.querySelector('#liveJoinSave'),cancel=()=>closeJoinDialog(dialog);
    dialog.querySelector('.live-dialog-close').onclick=cancel;dialog.querySelector('#liveJoinCancel').onclick=cancel;dialog.addEventListener('cancel',event=>{event.preventDefault();cancel();},{once:true});
    dialog.querySelector('form').onsubmit=async event=>{event.preventDefault();if(saving||inputs.some(field=>field.dataset.composing==='true'))return;const names=inputs.map(field=>field.value.trim()).filter(Boolean);if(!names.length||names.some(name=>name.length>40)){showJoinError(dialog,'이름은 1~40자로, 최소 1명 입력해주세요.');return;}if(new Set(names).size!==names.length){showJoinError(dialog,'같은 이름을 두 번 입력할 수 없습니다.');return;}save.disabled=true;const chosen=targetValue||select.value,parts=chosen.split(':'),court=parts[0]==='queue'?'queue':Number(parts[0]),extra={court,names};if(parts[0]==='queue'&&parts[1]!==undefined)extra.group=Number(parts[1]);if(single)extra.slot=target.slot;try{const updated=await write('join',extra,token);if(updated&&current(token)&&joinDialog===dialog)closeJoinDialog(dialog);}catch(error){if(!current(token)||joinDialog!==dialog)return;save.disabled=false;if(error.message==='현재 게임중인 회원입니다. 등록할 수 없습니다.')openCurrentGameNotice();else if(isConflict(error))await refreshJoinConflict(error,token,dialog,chosen);else showJoinError(dialog,error.message||'참가 등록을 하지 못했어요.');}};
    inputs.forEach(field=>{field.addEventListener('compositionstart',()=>field.dataset.composing='true');field.addEventListener('compositionend',()=>delete field.dataset.composing);});joinDialog.showModal();input.focus();
  }
  return {open:async token=>{stop();activeToken=token;if(!current(token))return;app.innerHTML='<p class="empty">실시간대진을 불러오는 중…</p>';try{await load(token,true,false,true);if(current(token))startPoll(token);}catch(error){if(current(token))app.innerHTML='<div class="panel error-box">'+esc(error.message||'실시간대진을 불러오지 못했어요.')+'</div>';}} ,stop};
}
