export function client(EDITOR){
  const $=id=>document.getElementById(id),app=$('app'),dialog=$('picker');
  function updateDaysTogether(){
    const output=$('daysTogether');if(!output)return;
    const parts=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Seoul',year:'numeric',month:'numeric',day:'numeric'}).formatToParts(new Date());
    const today=Date.UTC(Number(parts.find(p=>p.type==='year').value),Number(parts.find(p=>p.type==='month').value)-1,Number(parts.find(p=>p.type==='day').value));
    const since=Date.UTC(2026,4,8);
    output.textContent=String(Math.max(1,Math.floor((today-since)/86400000)+1));
  }
  updateDaysTogether();setInterval(updateDaysTogether,60000);
  if(!EDITOR){
    const accessButton=document.createElement('button');
    accessButton.className='operator-access';accessButton.textContent='운영진권한';
    accessButton.setAttribute('aria-haspopup','dialog');document.body.append(accessButton);
    accessButton.onclick=()=>{
      dialog.innerHTML='<form id="operatorLogin"><div class="dialog-head"><h2 id="pickerTitle">운영진권한</h2><button type="button" id="closeLogin" aria-label="닫기">×</button></div><label for="operatorPassword">운영진 비밀번호</label><input id="operatorPassword" type="password" inputmode="numeric" autocomplete="current-password" required maxlength="128" autofocus><p id="loginError" class="login-error" role="alert"></p><div class="sticky-actions"><button type="submit" id="loginSubmit" class="primary">운영진 화면으로</button><button type="button" id="cancelLogin">취소</button></div></form>';
      const close=()=>dialog.close();$('closeLogin').onclick=close;$('cancelLogin').onclick=close;
      $('operatorLogin').onsubmit=async e=>{
        e.preventDefault();const submit=$('loginSubmit');if(submit.disabled)return;
        submit.disabled=true;submit.textContent='확인 중…';$('loginError').textContent='';
        try{
          const result=await api('/api/operator-login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:$('operatorPassword').value})});
          if(!/^\/operate-[a-zA-Z0-9_-]+$/.test(result.redirect))throw Error('운영진 주소를 확인하지 못했습니다.');
          location.assign(result.redirect);
        }catch(error){$('loginError').textContent=error.message;$('operatorPassword').focus();$('operatorPassword').select();}
        finally{submit.disabled=false;submit.textContent='운영진 화면으로';}
      };
      dialog.onclose=()=>{dialog.innerHTML='';accessButton.focus();};dialog.showModal();
    };
  }
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const date=s=>new Date(s).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit'});
  const stamp=()=>date(new Date());
  let people=[],draft=null,dirty=false,routeToken=0,saving=false,lastHash=location.hash||'#home';
  function message(text,error=false){$('message').textContent=text;$('message').className=error?'error':'';}
  async function api(path,options){const r=await fetch(path,options);let x;try{x=await r.json();}catch{throw Error('응답을 확인하지 못했습니다. 다시 시도해주세요.');}if(!r.ok)throw Error(x.error||'요청에 실패했습니다.');return x;}
  async function getPeople(){if(!people.length)people=(await api('/api/people')).people;return people;}
  function nameOf(p){return people.some(q=>q.name===p.name&&q.id!==p.id)?p.name+' ('+(p.type==='member'?'회원':'게스트')+')':p.name;}
  const crumb=kind=>'<a class="crumb" href="'+(kind?'#'+kind:'#home')+'">← '+(kind==='schedule'?'대진표 목록':kind==='notice'?'공지사항 목록':'홈으로')+'</a>';
  function home(){app.innerHTML='<section class="home-intro"><div><h1>콕하나로 우리끼리</h1><p>오늘의 소식과 대진을 한곳에서.</p></div><img src="/mascot-play.png" alt="배드민턴을 치는 콕끼리" width="175" height="175"></section><nav class="menus" aria-label="게시판"><a class="menu" href="#notice"><span class="menu-num">01</span><span class="menu-title">공지사항</span><small>함께 알아둘 모임 소식</small></a><a class="menu featured" href="#schedule"><span class="menu-num">02</span><span class="menu-title">대진표</span><small>날짜별 대진과 지난 게임</small></a><a class="menu" href="#seed"><span class="menu-num">03</span><span class="menu-title">시드현황</span><small>회원 · 게스트 시드 확인</small></a></nav>'+(EDITOR?'<div class="home-note"><span>새로운 게임을 준비하시나요?</span><button class="primary" id="homeNew">+ 대진 만들기</button></div>':'');if(EDITOR)$('homeNew').onclick=()=>openPicker(null);}
  async function board(kind,token){
    app.innerHTML=crumb()+'<div class="bar"><div><h1>'+(kind==='schedule'?'대진표':'공지사항')+'</h1><p class="muted">'+(kind==='schedule'?'제목을 누르면 그날의 대진표를 볼 수 있어요.':'콕끼리의 새로운 소식을 확인하세요.')+'</p></div>'+(EDITOR?'<button id="newPost" class="primary">+ '+(kind==='schedule'?'대진 만들기':'공지 쓰기')+'</button>':'')+'</div><div class="panel" id="postList"><p class="empty">불러오는 중…</p></div><button class="more" id="more" hidden>더 보기</button>';
    if(EDITOR)$('newPost').onclick=()=>kind==='schedule'?openPicker(null):editNotice({id:crypto.randomUUID(),kind,version:0,title:'',body:''});
    let offset=0;
    async function more(){
      const button=$('more');button.disabled=true;
      try{const x=await api('/api/posts?kind='+kind+'&offset='+offset);if(token!==routeToken)return;
        if(!offset)$('postList').innerHTML='';
        if(!offset&&!x.items.length)$('postList').innerHTML='<div class="empty"><img src="/mascot-rest.png" alt="기다리는 콕끼리"><p>아직 등록된 '+(kind==='schedule'?'대진표':'공지사항')+'가 없습니다.</p></div>';
        $('postList').insertAdjacentHTML('beforeend',x.items.map(p=>'<a class="post" href="#post/'+encodeURIComponent(p.id)+'"><div><div class="post-title">'+esc(p.title)+'</div>'+((EDITOR||kind!=='notice')?'<small>'+esc(date(p.created_at))+(p.version>1?' · 수정됨':'')+'</small>':'')+'</div><span aria-hidden="true">→</span></a>').join(''));
        offset+=x.items.length;button.hidden=!x.hasMore;
      }catch(e){if(token===routeToken){message(e.message,true);button.hidden=false;button.textContent='다시 불러오기';}}finally{button.disabled=false;}
    }
    $('more').onclick=more;await more();
  }
  function scheduleHTML(d,editing=false){return d.schedule.map((r,ri)=>'<section class="round"><h3>'+esc(r.round)+' 라운드</h3><div class="matches">'+r.g.map((m,mi)=>'<div class="match '+(editing?'edit-match':'')+'"><div class="court">'+(mi+1)+'번 코트</div>'+m.map((n,si)=>(si===2?'<b class="vs">VS</b>':'')+(editing?'<select aria-label="'+(ri+1)+'라운드 '+(mi+1)+'코트 '+(si+1)+'번째 참가자" data-r="'+ri+'" data-m="'+mi+'" data-s="'+si+'">'+d.names.map(p=>'<option'+(p===n?' selected':'')+'>'+esc(p)+'</option>').join('')+'</select>':esc(n)+(si===0||si===2?' · ':''))).join('')+'</div>').join('')+'</div><div class="rest" id="rest-'+ri+'">휴식: '+esc(r.rest.join(', ')||'없음')+'</div></section>').join('');}
  async function detail(id,token){
    const {data:d}=await api('/api/posts/'+encodeURIComponent(id));if(token!==routeToken)return;
    app.innerHTML=crumb(d.kind)+'<article class="panel detail"><div class="bar"><div><h1>'+esc(d.title)+'</h1>'+((EDITOR||d.kind!=='notice')?'<p class="muted">등록 '+esc(date(d.createdAt))+(d.version>1?' · 수정 '+esc(date(d.updatedAt)):'')+'</p>':'')+'</div>'+(EDITOR?'<button id="editPost">수정하기</button>':'')+'</div>'+(d.kind==='notice'?'<div class="notice-body">'+esc(d.body)+'</div>':'<p class="muted">참가 '+d.names.length+'명 · '+d.courts+'코트 · '+d.rounds+'라운드</p>'+scheduleHTML(d))+'</article>';
    if(EDITOR)$('editPost').onclick=()=>d.kind==='notice'?editNotice(d):editSchedule(d);
  }
  function changed(){dirty=true;draft.operation=crypto.randomUUID();}
  function startDraft(d){draft=structuredClone(d);draft.operation=crypto.randomUUID();dirty=false;}
  function editSchedule(d){
    startDraft(d);
    app.innerHTML=crumb('schedule')+'<section class="panel detail"><h1>'+(d.version?'대진표 수정':'대진표 저장')+'</h1><label>대진 제목<input id="editTitle" maxlength="120" placeholder="비워두면 오늘 날짜와 시간이 제목이 됩니다" value="'+esc(d.title)+'"></label><div class="edit-info">참가자를 바꾸면 같은 라운드 안에서 두 사람의 자리가 서로 바뀝니다. 전체 대진을 새로 짜려면 ‘참가자·코트 변경’을 눌러주세요.</div><div class="sticky-actions"><button id="changeParticipants">참가자·코트 변경</button><button id="savePost" class="primary">저장하기</button><button id="cancelEdit">취소</button></div><div id="editMatches">'+scheduleHTML(draft,true)+'</div></section>';
    $('editTitle').oninput=()=>{draft.title=$('editTitle').value;changed();};
    $('editMatches').onchange=e=>{
      const select=e.target;if(!select.matches('select'))return;
      const ri=+select.dataset.r,mi=+select.dataset.m,si=+select.dataset.s,r=draft.schedule[ri],previous=r.g[mi][si],next=select.value;
      for(let m=0;m<r.g.length;m++)for(let s=0;s<4;s++)if(r.g[m][s]===next)r.g[m][s]=previous;
      r.g[mi][si]=next;r.rest=draft.names.filter(n=>!r.g.flat().includes(n));changed();
      $('editMatches').innerHTML=scheduleHTML(draft,true);
    };
    $('changeParticipants').onclick=()=>openPicker(draft);
    $('savePost').onclick=save;
    $('cancelEdit').onclick=cancelEdit;
  }
  function editNotice(d){startDraft(d);app.innerHTML=crumb('notice')+'<section class="panel detail"><h1>'+(d.version?'공지 수정':'공지 쓰기')+'</h1><label>제목<input id="editTitle" maxlength="120" value="'+esc(d.title)+'" placeholder="비워두면 오늘 날짜와 시간"></label><label>내용<textarea id="noticeBody" maxlength="20000">'+esc(d.body)+'</textarea></label><div class="sticky-actions"><button id="savePost" class="primary">저장하기</button><button id="cancelEdit">취소</button></div></section>';$('editTitle').oninput=()=>{draft.title=$('editTitle').value;changed();};$('noticeBody').oninput=()=>{draft.body=$('noticeBody').value;changed();};$('savePost').onclick=save;$('cancelEdit').onclick=cancelEdit;}
  function cancelEdit(){if(dirty&&!confirm('저장하지 않은 변경 내용을 취소할까요?'))return;const target=draft.version?'#post/'+draft.id:'#'+draft.kind;dirty=false;draft=null;if(location.hash===target)route();else location.hash=target;}
  async function save(){
    if(saving||!draft)return;
    saving=true;app.querySelectorAll('button,input,select,textarea').forEach(el=>el.disabled=true);message('저장하는 중…');
    try{await api('/api/posts/'+draft.id,{method:'PUT',headers:{'content-type':'application/json','x-kokkiri-editor':EDITOR},body:JSON.stringify({kind:draft.kind,version:draft.version,operation:draft.operation,data:draft})});dirty=false;draft=null;message('저장되었습니다. 게시판에서 언제든 다시 볼 수 있어요.');if(location.hash==='#home'||!location.hash)route();else location.hash='#home';}
    catch(e){message(e.message,true);}finally{saving=false;app.querySelectorAll('button,input,select,textarea').forEach(el=>el.disabled=false);}
  }
  function generate(names,courts,count){
    const rounds=[];for(let r=1;r<=count;r++){const a=[...names];for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}const cap=Math.min(courts,Math.floor(a.length/4)),g=[];for(let i=0;i<cap*4;i+=4)g.push(a.slice(i,i+4));rounds.push({round:r,g,rest:a.slice(cap*4)});}return rounds;
  }
  async function openPicker(existing){
    if(!EDITOR)return;
    try{await getPeople();}catch(e){message(e.message,true);return;}
    let active='member',selected=new Set(existing?.participantIds?.length?existing.participantIds:people.filter(p=>existing?.names.includes(nameOf(p))).map(p=>p.id));
    dialog.innerHTML='<div class="dialog-head"><h2 id="pickerTitle">'+(existing?'참가자·코트 변경':'새 대진 만들기')+'</h2><button id="closePicker" aria-label="닫기">×</button></div><label>대진 제목<input id="newTitle" maxlength="120" value="'+esc(existing?.title||'')+'" placeholder="비워두면 오늘 날짜와 시간이 제목이 됩니다"></label><div class="two"><label>코트 수<input id="courts" type="number" min="1" max="20" value="'+(existing?.courts||3)+'"></label><label>라운드 수<input id="rounds" type="number" min="1" max="20" value="'+(existing?.rounds||4)+'"></label></div><div class="tabs"><button id="memberTab" aria-pressed="true">회원</button><button id="guestTab" aria-pressed="false">게스트</button></div><label>이름 검색<input id="searchPeople" type="search" placeholder="이름으로 찾기"></label><p id="selectedCount" aria-live="polite"></p><div class="people-grid picker-list" id="choices"></div><div class="sticky-actions"><button id="selectAll">현재 목록 전체 선택</button><button id="clearAll">전체 선택 해제</button></div><p class="seed-note">시드는 표시용이며 대진은 무작위로 만들어집니다.</p><button id="generate" class="primary">'+(existing?'선택한 참가자로 대진 다시 만들기':'선택한 참가자로 대진 만들기')+'</button>';
    const visible=()=>people.filter(p=>p.type===active&&p.name.includes($('searchPeople').value.trim()));
    const count=()=>{$('selectedCount').textContent='선택 '+selected.size+'명 · 회원 '+people.filter(p=>p.type==='member'&&selected.has(p.id)).length+'명 / 게스트 '+people.filter(p=>p.type==='guest'&&selected.has(p.id)).length+'명';};
    function render(){for(const type of ['member','guest'])$(type+'Tab').setAttribute('aria-pressed',String(active===type));$('choices').innerHTML=visible().map(p=>'<label class="person"><input type="checkbox" value="'+esc(p.id)+'"'+(selected.has(p.id)?' checked':'')+'><span>'+esc(p.name)+'</span><small>'+esc(p.seed||'미정')+'</small></label>').join('')||'<p>검색 결과가 없습니다.</p>';count();}
    $('choices').onchange=e=>{if(e.target.checked)selected.add(e.target.value);else selected.delete(e.target.value);count();};
    $('memberTab').onclick=()=>{active='member';render();};$('guestTab').onclick=()=>{active='guest';render();};$('searchPeople').oninput=render;$('selectAll').onclick=()=>{visible().forEach(p=>selected.add(p.id));render();};$('clearAll').onclick=()=>{selected.clear();render();};$('closePicker').onclick=()=>dialog.close();
    $('generate').onclick=()=>{
      const c=Number($('courts').value),r=Number($('rounds').value),picked=people.filter(p=>selected.has(p.id));
      if(picked.length<4)return alert('참가자 4명 이상을 선택해주세요.');
      if(!Number.isInteger(c)||c<1||c>20||!Number.isInteger(r)||r<1||r>20)return alert('코트와 라운드는 1~20 사이 정수로 입력해주세요.');
      if(existing&&!confirm('기존 대진 구성을 새로 만듭니다. 저장하기 전까지 게시된 대진은 그대로 유지됩니다. 계속할까요?'))return;
      const names=picked.map(nameOf),d={id:existing?.id||crypto.randomUUID(),kind:'schedule',version:existing?.version||0,title:$('newTitle').value.trim()||stamp(),names,participantIds:picked.map(p=>p.id),courts:c,rounds:r,schedule:generate(names,c,r)};
      dialog.close();editSchedule(d);dirty=true;window.scrollTo(0,0);
    };render();dialog.showModal();
  }
  async function seeds(token){await getPeople();if(token!==routeToken)return;let type='member';app.innerHTML=crumb()+'<h1>시드현황</h1><p class="seed-note">등록된 관리표 기준입니다. 현재 시드는 대진 배정에 자동 반영되지 않습니다.</p><div class="tabs"><button id="seedMembers">회원</button><button id="seedGuests">게스트</button></div><label>이름 검색<input id="seedSearch" type="search" placeholder="이름으로 찾기"></label><p class="muted" id="seedCount"></p><div class="people-grid" id="seedList"></div>';function render(){const list=people.filter(p=>p.type===type&&p.name.includes($('seedSearch').value.trim()));$('seedMembers').setAttribute('aria-pressed',String(type==='member'));$('seedGuests').setAttribute('aria-pressed',String(type==='guest'));$('seedCount').textContent=(type==='member'?'회원':'게스트')+' '+list.length+'명';$('seedList').innerHTML=list.map(p=>'<div class="person"><span>'+esc(p.name)+'</span><small>'+esc(p.seed||'미정')+'</small></div>').join('')||'<p>검색 결과가 없습니다.</p>';}$('seedMembers').onclick=()=>{type='member';render();};$('seedGuests').onclick=()=>{type='guest';render();};$('seedSearch').oninput=render;render();}
  async function route(){
    const token=++routeToken,hash=location.hash||'#home';lastHash=hash;draft=null;app.innerHTML='<p class="empty">불러오는 중…</p>';
    try{if(hash==='#schedule'||hash==='#notice')await board(hash.slice(1),token);else if(hash==='#seed')await seeds(token);else if(hash.startsWith('#post/'))await detail(hash.slice(6),token);else home();}catch(e){if(token===routeToken){app.innerHTML=crumb()+'<div class="panel error-box">'+esc(e.message)+'<p><button id="retry">다시 시도</button></p></div>';$('retry').onclick=route;}}
  }
  window.addEventListener('hashchange',()=>{if(saving){history.replaceState(null,'',lastHash);return;}if(dirty&&!confirm('저장하지 않은 변경 내용이 있습니다. 이동할까요?')){history.replaceState(null,'',lastHash);return;}dirty=false;dialog.close();route();window.scrollTo(0,0);});
  document.addEventListener('click',e=>{const a=e.target.closest('a');if(a&&draft&&a.getAttribute('href')===(location.hash||'#home')){e.preventDefault();if(saving)return;if(dirty&&!confirm('저장하지 않은 변경 내용이 있습니다. 이동할까요?'))return;dirty=false;route();}});
  window.addEventListener('beforeunload',e=>{if(dirty||saving){e.preventDefault();e.returnValue='';}});
  route();
}
