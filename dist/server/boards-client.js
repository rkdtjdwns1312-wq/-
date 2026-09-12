export function client(EDITOR){
  const $=id=>document.getElementById(id),app=$('app'),dialog=$('picker');
  const extraStyle=document.createElement('style');extraStyle.textContent='.ranking-table-wrap{overflow:auto}.ranking-table{width:100%;border-collapse:collapse;min-width:620px}.ranking-table th{background:#eafff1;color:#245c39;font-weight:700}.ranking-table th,.ranking-table td{padding:12px 14px;text-align:center;border-bottom:1px solid #e0ebe4;white-space:nowrap}.ranking-table th:nth-child(3),.ranking-table td:nth-child(3){text-align:left}.rank-movement{color:#e5484d;font-weight:700}.rank-down{color:#2f6fed;font-weight:700}.seed-badge{display:inline-block;min-width:2.7em;padding:2px 7px;border-radius:999px;background:#eafff1;color:#176337;font-weight:700}.match-result{display:flex;justify-content:center;align-items:center;gap:7px;flex-wrap:wrap;margin-top:14px;padding-top:12px;border-top:1px solid #dcece1}.result-label{width:100%;color:#587261;font-size:.875rem}.winner-button{padding:7px 10px;font-size:.875rem}.winner-button.selected{background:#03ac50;color:#fff;border-color:#03ac50}.settled-badge{display:inline-block;margin:8px 0;padding:4px 9px;border-radius:999px;background:#eafff1;color:#176337;font-size:.875rem;font-weight:600}@media(max-width:650px){.ranking-table th,.ranking-table td{padding:10px 9px}.winner-button{font-size:.8rem;padding:6px 8px}}';document.head.append(extraStyle);
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
  const OPERATORS=new Set(['로토','백구','구구','이코','뉴키','단우']);
  const crown=name=>OPERATORS.has(name)?'<span class="crown" title="운영진" aria-label="운영진">👑</span>':'';
  const nameHTML=name=>{const s=String(name??''),m=/^(.*[^\s])\(([^)\s]+)\)$/.exec(s);return m?esc(m[1])+'<span class="region">'+esc(m[2])+'</span>':esc(s);};
  const seedHTML=seed=>{const s=String(seed==null?'':seed),m=/^(.*[^+\-])([+\-])$/.exec(s);return m?esc(m[1])+'<sup class="seed-mod">'+esc(m[2])+'</sup>':esc(s);};
  const date=s=>new Date(s).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit'});
  const stamp=()=>date(new Date());
  function noticeHTML(body){
    if(!body)return'';
    const lines=String(body).replace(/\r\n?/g,'\n').split('\n');
    const parts=[];let list=false;
    function closeList(){if(list){parts.push('</ul>');list=false;}}
    for(const raw of lines){
      const line=raw.replace(/\s+$/,'');
      if(!line.trim()){closeList();continue;}
      const indented=/^[ \t]/.test(line);
      const text=line.trim();
      let m;
      if(m=text.match(/^(\d{1,2})[.)]\s*(.+)$/)){closeList();parts.push('<h2 class="nb-section"><span class="nb-num">'+esc(m[1])+'</span><span>'+esc(m[2])+'</span></h2>');continue;}
      if(m=text.match(/^\[(.+)\]$/)){closeList();parts.push('<h3 class="nb-sub">'+esc(m[1])+'</h3>');continue;}
      if(/^\d{1,2}월$/.test(text)){closeList();parts.push('<p class="nb-month">'+esc(text)+'</p>');continue;}
      if(m=text.match(/^(?:(▶|►|▸|▷|•|・|·|ㄴ)\s*|(-|–)\s+)(.+)$/)){m=[m[0],m[1]||m[2],m[3]];if(!list){parts.push('<ul class="nb-list">');list=true;}parts.push('<li>'+esc(m[2])+'</li>');continue;}
      if(indented){
        if(list)parts[parts.length-1]=parts[parts.length-1].replace(/<\/li>$/,()=>'<span class="nb-cont">'+esc(text)+'</span></li>');
        else parts.push('<p>'+esc(text)+'</p>');
        continue;
      }
      if(/^(🔵|※|❗|⚠️?|❕|★)/.test(text)){closeList();parts.push('<p class="nb-note">'+esc(text)+'</p>');continue;}
      closeList();parts.push('<p>'+esc(text)+'</p>');
    }
    closeList();
    return parts.join('');
  }
  let people=[],draft=null,dirty=false,routeToken=0,saving=false,lastHash=location.hash||'#home';
  function message(text,error=false){$('message').textContent=text;$('message').className=error?'error':'';}
  async function api(path,options){const r=await fetch(path,options);let x;try{x=await r.json();}catch{throw Error('응답을 확인하지 못했습니다. 다시 시도해주세요.');}if(!r.ok)throw Error(x.error||'요청에 실패했습니다.');return x;}
  async function getPeople(){if(!people.length)people=(await api('/api/people')).people;return people;}
  function nameOf(p){return people.some(q=>q.name===p.name&&q.id!==p.id)?p.name+' ('+(p.type==='member'?'회원':'게스트')+')':p.name;}
  const crumb=kind=>'<a class="crumb" href="'+(kind?'#'+kind:'#home')+'">← '+(kind==='schedule'?'대진표 목록':kind==='notice'?'공지사항 목록':'홈으로')+'</a>';
  async function home(){const token=routeToken;app.innerHTML='<section class="home-intro"><div><h1>콕하나로 우리끼리</h1><p>오늘의 소식과 대진을 한곳에서.</p></div><img src="/mascot-play.png" alt="배드민턴을 치는 콕끼리" width="175" height="175"></section><nav class="menus" aria-label="게시판"><a class="menu" href="#notice"><span class="menu-num">01</span><span class="menu-title">공지사항</span><small>함께 알아둘 모임 소식</small></a><a class="menu" href="#schedule"><span class="menu-num">02</span><span class="menu-title">대진표</span><small>날짜별 대진과 지난 게임</small></a><a class="menu" href="#seed"><span class="menu-num">03</span><span class="menu-title">시드현황</span><small>회원 · 게스트 시드 확인</small></a></nav>'+(EDITOR?'<div class="home-note"><span>새로운 게임을 준비하시나요?</span><button class="primary" id="homeNew">+ 대진 만들기</button></div>':'')+'<div id="mvpHome"></div>';if(EDITOR)$('homeNew').onclick=()=>openPicker(null);try{const m=await api('/api/mvp');if(token!==routeToken)return;if(m&&Array.isArray(m.mvp)&&m.mvp.length&&m.settledAt&&(Date.now()-new Date(m.settledAt).getTime())/86400000<=5){const el=$('mvpHome');if(el)el.innerHTML='<a class="mvp-home" href="#post/'+encodeURIComponent(m.id)+'"><span class="mvp-home-cap">✨ 이번 정모 MVP</span><span class="mvp-title">'+esc(m.mvp.join(' · '))+'</span></a>';}}catch(e){}}
  async function board(kind,token){
    app.innerHTML=crumb()+'<div class="bar"><div><h1>'+(kind==='schedule'?'대진표':'공지사항')+'</h1><p class="muted">'+(kind==='schedule'?'제목을 누르면 그날의 대진표를 볼 수 있어요.':'콕끼리의 새로운 소식을 확인하세요.')+'</p></div>'+(EDITOR?'<button id="newPost" class="primary">+ '+(kind==='schedule'?'대진 만들기':'공지 쓰기')+'</button>':'')+'</div><div class="panel" id="postList"><p class="empty">불러오는 중…</p></div><button class="more" id="more" hidden>더 보기</button>';
    if(EDITOR)$('newPost').onclick=()=>kind==='schedule'?openPicker(null):editNotice({id:crypto.randomUUID(),kind,version:0,title:'',body:''});
    let offset=0;
    async function more(){
      const button=$('more');button.disabled=true;
      try{const x=await api('/api/posts?kind='+kind+'&offset='+offset);if(token!==routeToken)return;
        if(!offset)$('postList').innerHTML='';
        if(!offset&&!x.items.length)$('postList').innerHTML='<div class="empty"><img src="/mascot-rest.png" alt="기다리는 콕끼리"><p>아직 등록된 '+(kind==='schedule'?'대진표':'공지사항')+'가 없습니다.</p></div>';
        $('postList').insertAdjacentHTML('beforeend',x.items.map(p=>'<a class="post'+((kind==='notice'||kind==='schedule')?' post-notice':'')+'" href="#post/'+encodeURIComponent(p.id)+'"><div>'+(kind==='notice'?'<span class="post-label">공지</span>':kind==='schedule'?'<span class="post-label post-label-alt">대진</span>':'')+'<div class="post-title">'+esc(p.title)+'</div>'+((EDITOR||kind!=='notice')?'<small>'+esc(date(p.created_at))+(p.version>1?' · 수정됨':'')+'</small>':'')+'</div><span aria-hidden="true">→</span></a>').join(''));
        offset+=x.items.length;button.hidden=!x.hasMore;
      }catch(e){if(token===routeToken){message(e.message,true);button.hidden=false;button.textContent='다시 불러오기';}}finally{button.disabled=false;}
    }
    $('more').onclick=more;await more();
  }
  function winBtn(key,side,result,locked){
    return '<button type="button" class="win-pick'+(result===side?' picked':'')+'" data-result-key="'+key+'" data-winner="'+side+'" aria-pressed="'+(result===side)+'"'+(locked?' disabled':'')+' aria-label="이 팀 승리">승</button>';
  }
  function scheduleHTML(d,editing=false,showResults=false){
    const results=d.results||{};
    const cell=(m,mi,ri,si)=>editing
      ? '<select aria-label="'+(ri+1)+'라운드 '+(mi+1)+'코트 '+(si+1)+'번째 참가자" data-r="'+ri+'" data-m="'+mi+'" data-s="'+si+'">'+d.names.map(p=>'<option'+(p===m[si]?' selected':'')+'>'+esc(p)+'</option>').join('')+'</select>'
      : '<span class="player">'+nameHTML(m[si])+'</span>';
    const team=(m,mi,ri,a,b)=>'<div class="team">'+cell(m,mi,ri,a)+'<span class="team-amp">·</span>'+cell(m,mi,ri,b)+'</div>';
    return d.schedule.map((r,ri)=>{
      const scored=r.method!=='random';
      return '<section class="round"><div class="round-head"><span class="round-badge">'+esc(r.round)+'R</span><h3>'+esc(r.round)+' 라운드</h3>'+(scored?'':'<span class="round-tag">랜덤 · 점수 미반영</span>')+'</div><div class="matches">'+r.g.map((m,mi)=>{
        const key=ri+'-'+mi,result=results[key];
        const showWin=scored&&(showResults||result),locked=Boolean(d.settledAt)&&!editing;
        const twrap=(a,b,side)=>'<div class="team-wrap wrap-'+side+(result===side?' win':'')+'">'+team(m,mi,ri,a,b)+'</div>';
        const mid=scored?'<div class="vs-cluster">'+(showWin?winBtn(key,'a',result,locked):'')+'<b class="vs">VS</b>'+(showWin?winBtn(key,'b',result,locked):'')+'</div>':'<b class="vs">VS</b>';
        let note='';
        if(!scored)note='<div class="match-result"><span class="random-note">랜덤 경기예요. 승패는 점수에 반영되지 않아요.</span></div>';
        else if(showWin&&!result&&!locked)note='<div class="match-hint">이긴 팀의 <b>승</b>을 눌러주세요</div>';
        return '<div class="match '+(editing?'edit-match':'')+(result?' has-result result-'+result:'')+(scored?'':' random-match')+'"><div class="court">'+(mi+1)+'번 코트</div><div class="teams">'+twrap(0,1,'a')+mid+twrap(2,3,'b')+'</div>'+note+'</div>';
      }).join('')+'</div><div class="rest" id="rest-'+ri+'">휴식: '+esc(r.rest.join(', ')||'없음')+'</div></section>';
    }).join('');
  }
  async function detail(id,token){
    const {data:d}=await api('/api/posts/'+encodeURIComponent(id));if(token!==routeToken)return;
    const allScoredDone=d.kind==='schedule'&&d.schedule.every((r,ri)=>r.method==='random'||r.g.every((m,mi)=>{const v=d.results&&d.results[ri+'-'+mi];return v==='a'||v==='b';}));
    const editable=EDITOR&&!(d.kind==='schedule'&&d.settledAt);
    const actions=editable?'<div class="detail-actions"><button id="editPost">수정하기</button><button id="deletePost" class="danger">삭제</button></div>':'';
    const endBtn=(EDITOR&&d.kind==='schedule'&&!d.settledAt&&allScoredDone)?'<div class="end-match-wrap"><button id="endMatch" class="primary end-match">대진 종료</button></div>':'';
    const mvpCls=(d.kind==='schedule'&&d.settledAt&&Array.isArray(d.mvp)&&d.mvp.length)?' class="mvp-title"':'';
    app.innerHTML=crumb(d.kind)+'<article class="panel detail"><div class="bar"><div>'+(d.kind==='notice'?'<span class="post-label">공지사항</span>':'')+'<h1'+mvpCls+'>'+esc(d.title)+'</h1>'+((EDITOR||d.kind!=='notice')?'<p class="muted">등록 '+esc(date(d.createdAt))+(d.version>1?' · 수정 '+esc(date(d.updatedAt)):'')+'</p>':'')+(d.settledAt?'<span class="settled-badge">점수 반영 완료</span>':'')+'</div>'+actions+'</div>'+(d.kind==='notice'?'<div class="notice-body">'+noticeHTML(d.body)+'</div>':'<div class="schedule-meta"><span class="chip">참가 '+d.names.length+'명</span><span class="chip">'+d.courts+'코트</span><span class="chip">'+d.rounds+'라운드</span></div>'+scheduleHTML(d,false,!d.settledAt)+endBtn)+'</article>';
    if(d.kind==='schedule'&&!d.settledAt)app.querySelectorAll('.win-pick:not([disabled])').forEach(btn=>btn.onclick=()=>recordResult(d,btn));
    if(EDITOR&&$('editPost'))$('editPost').onclick=()=>d.kind==='notice'?editNotice(d):editSchedule(d);
    if(EDITOR&&$('deletePost'))$('deletePost').onclick=async()=>{if(!confirm((d.kind==='schedule'?'이 대진표':'이 공지')+'를 삭제할까요? 삭제하면 되돌릴 수 없습니다.'))return;try{await api('/api/posts/'+encodeURIComponent(d.id),{method:'DELETE',headers:{'x-kokkiri-editor':EDITOR}});}catch(e){return message(e.message,true);}location.hash='#'+d.kind;};
    if($('endMatch'))$('endMatch').onclick=()=>endMatch(d);
  }
  function changed(){dirty=true;draft.operation=crypto.randomUUID();}
  function startDraft(d){draft=structuredClone(d);draft.operation=crypto.randomUUID();dirty=false;}
  function editSchedule(d){
    startDraft(d);draft.results=draft.results||{};
    app.innerHTML=crumb('schedule')+'<section class="panel detail"><h1>'+(d.version?'대진표 수정':'대진표 저장')+'</h1><label>대진 제목<input id="editTitle" maxlength="120" placeholder="비워두면 오늘 날짜와 시간이 제목이 됩니다" value="'+esc(d.title)+'"></label><div class="edit-info">선수 자리는 드롭다운으로 바꿀 수 있어요. 승패 기록과 대진 종료(점수 확정)는 저장한 뒤 대진표 화면에서 합니다. 랜덤 라운드는 승패를 기록하지 않아요.</div><div class="sticky-actions"><button id="changeParticipants">참가자·코트 변경</button><button id="savePost" class="primary">'+(d.version?'대진·승패 저장':'대진 저장')+'</button><button id="cancelEdit">취소</button></div><div id="editMatches">'+scheduleHTML(draft,true,true)+'</div></section>';
    $('editTitle').oninput=()=>{draft.title=$('editTitle').value;changed();};
    $('editMatches').onclick=e=>{
      const button=e.target.closest('[data-result-key]');if(!button)return;
      draft.results[button.dataset.resultKey]=button.dataset.winner;changed();$('editMatches').innerHTML=scheduleHTML(draft,true,true);
    };
    $('editMatches').onchange=e=>{
      const select=e.target;if(!select.matches('select'))return;
      const ri=+select.dataset.r,mi=+select.dataset.m,si=+select.dataset.s,r=draft.schedule[ri],previous=r.g[mi][si],next=select.value;
      for(let m=0;m<r.g.length;m++)for(let s=0;s<4;s++)if(r.g[m][s]===next)r.g[m][s]=previous;
      r.g[mi][si]=next;r.rest=draft.names.filter(n=>!r.g.flat().includes(n));changed();
      $('editMatches').innerHTML=scheduleHTML(draft,true,true);
    };
    $('changeParticipants').onclick=()=>openPicker(draft);
    $('savePost').onclick=save;
    $('cancelEdit').onclick=cancelEdit;
  }
  function editNotice(d){startDraft(d);app.innerHTML=crumb('notice')+'<section class="panel detail"><h1>'+(d.version?'공지 수정':'공지 쓰기')+'</h1><label>제목<input id="editTitle" maxlength="120" value="'+esc(d.title)+'" placeholder="비워두면 오늘 날짜와 시간"></label><label>내용<textarea id="noticeBody" maxlength="20000">'+esc(d.body)+'</textarea></label><p class="edit-info">줄 앞에 1. 2. 를 붙이면 큰 제목, [소제목]은 작은 제목, ▶ 나 - 로 시작하면 목록으로 보기 좋게 표시됩니다. 🔵 로 시작하면 강조 메모가 됩니다.</p><div class="sticky-actions"><button id="savePost" class="primary">저장하기</button><button id="cancelEdit">취소</button></div></section>';$('editTitle').oninput=()=>{draft.title=$('editTitle').value;changed();};$('noticeBody').oninput=()=>{draft.body=$('noticeBody').value;changed();};$('savePost').onclick=save;$('cancelEdit').onclick=cancelEdit;}
  function cancelEdit(){if(dirty&&!confirm('저장하지 않은 변경 내용을 취소할까요?'))return;const target=draft.version?'#post/'+draft.id:'#'+draft.kind;dirty=false;draft=null;if(location.hash===target)route();else location.hash=target;}
  async function persistDraft(){
    const {data}=await api('/api/posts/'+draft.id,{method:'PUT',headers:{'content-type':'application/json','x-kokkiri-editor':EDITOR},body:JSON.stringify({kind:draft.kind,version:draft.version,operation:draft.operation,data:draft})});draft=data;dirty=false;return data;
  }
  async function save(){
    if(saving||!draft)return;
    saving=true;app.querySelectorAll('button,input,select,textarea').forEach(el=>el.disabled=true);message('저장하는 중…');
    try{await persistDraft();draft=null;message('저장되었습니다. 게시판에서 언제든 다시 볼 수 있어요.');if(location.hash==='#home'||!location.hash)route();else location.hash='#home';}
    catch(e){message(e.message,true);}finally{saving=false;app.querySelectorAll('button,input,select,textarea').forEach(el=>el.disabled=false);}
  }
  async function recordResult(d,btn){
    const key=btn.dataset.resultKey,winner=btn.dataset.winner,matchEl=btn.closest('.match');
    const prev=d.results?.[key];if(prev===winner)return;
    applyWin(matchEl,winner);
    d.results={...(d.results||{}),[key]:winner};
    try{await saveResult(d.id,key,winner);if(EDITOR){routeToken++;detail(d.id,routeToken);}}
    catch(e){if(prev){d.results[key]=prev;applyWin(matchEl,prev);}else{delete d.results[key];applyWin(matchEl,null);}message(e.message||'승패를 저장하지 못했어요.',true);}
  }
  function applyWin(matchEl,w){if(!matchEl)return;matchEl.classList.remove('result-a','result-b');if(w)matchEl.classList.add('has-result','result-'+w);else matchEl.classList.remove('has-result');const wraps=matchEl.querySelectorAll('.team-wrap');if(wraps[0])wraps[0].classList.toggle('win',w==='a');if(wraps[1])wraps[1].classList.toggle('win',w==='b');matchEl.querySelectorAll('.win-pick').forEach(b=>{const on=b.dataset.winner===w;b.classList.toggle('picked',on);b.setAttribute('aria-pressed',String(on));});if(w){const h=matchEl.querySelector('.match-hint');if(h)h.remove();}}
  async function saveResult(id,key,winner){let last;for(let i=0;i<3;i++){try{return await api('/api/posts/'+encodeURIComponent(id)+'/result',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({key,winner})});}catch(e){last=e;if(i<2&&/다른 기기/.test(e.message||'')){await new Promise(r=>setTimeout(r,250));continue;}throw e;}}throw last;}
  async function endMatch(d){
    if(!(await confirmDialog('정말 확정하시겠습니까? 확정하면 출석·승패 점수가 시드현황에 반영되고 되돌릴 수 없습니다.')))return;
    if(saving)return;saving=true;message('점수를 반영하는 중…');
    try{const fresh=(await api('/api/posts/'+encodeURIComponent(d.id))).data;await api('/api/posts/'+encodeURIComponent(d.id)+'/settle',{method:'POST',headers:{'content-type':'application/json','x-kokkiri-editor':EDITOR},body:JSON.stringify({version:fresh.version,operation:crypto.randomUUID()})});message('점수 반영이 완료되었습니다. 시드현황에 새 순위가 반영됩니다.');routeToken++;detail(d.id,routeToken);window.scrollTo(0,0);}
    catch(e){message(e.message,true);}finally{saving=false;}
  }
  function confirmDialog(msg){return new Promise(resolve=>{let done=false;const finish=v=>{if(done)return;done=true;try{dialog.close();}catch(e){}resolve(v);};dialog.innerHTML='<div class="confirm-box"><p class="confirm-msg">'+esc(msg)+'</p><div class="confirm-actions"><button id="confirmNo">아니오</button><button id="confirmYes" class="primary">예</button></div></div>';$('confirmYes').onclick=()=>finish(true);$('confirmNo').onclick=()=>finish(false);dialog.addEventListener('cancel',()=>finish(false),{once:true});dialog.showModal();});}
  function generate(roster,courts,rounds,methods){
    const shuffle=a=>{a=[...a];for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;};
    const pts=p=>Number.isFinite(p.points)?p.points:0;
    const roleRank=p=>p.type==='guest'?3:p.late?2:p.operator?1:0; // 클수록 먼저 쉼(회원0<운영진1<늦참2<게스트3)
    const cap=Math.min(courts,Math.floor(roster.length/4));
    const plays=new Map(roster.map(p=>[p.id,0]));
    const out=[];
    for(let r=0;r<rounds;r++){
      const order=shuffle(roster).sort((a,b)=>roleRank(a)-roleRank(b)||(plays.get(a.id)-plays.get(b.id)));
      const playing=order.slice(0,cap*4),resting=order.slice(cap*4);
      playing.forEach(p=>plays.set(p.id,plays.get(p.id)+1));
      const method=methods[r]||'random';
      const groups=Array.from({length:cap},()=>[]);
      if(method==='random'){const sh=shuffle(playing);for(let i=0;i<cap*4;i++)groups[Math.floor(i/4)].push(sh[i]);}
      else{const sorted=[...playing].sort((a,b)=>pts(b)-pts(a)||Math.random()-.5);
        if(method==='same')for(let i=0;i<cap*4;i++)groups[Math.floor(i/4)].push(sorted[i]);
        else for(let i=0;i<cap*4;i++)groups[i%cap].push(sorted[i]);} // balanced(인접=실력균형): 사분위 라운드로빈
      const g=groups.map(group=>{
        if(method==='random')return group.map(p=>p.name);
        const s=[...group].sort((a,b)=>pts(b)-pts(a));
        return [s[0].name,s[3].name,s[1].name,s[2].name]; // 균형: (최고+최저) vs (중간 둘), 앞2=A팀 뒤2=B팀
      });
      out.push({round:r+1,method,g,rest:resting.map(p=>p.name)});
    }
    return out;
  }
  async function openPicker(existing){
    if(!EDITOR)return;
    try{await getPeople();}catch(e){message(e.message,true);return;}
    if(existing&&Array.isArray(existing.participantIds)&&Array.isArray(existing.names))existing.participantIds.forEach((pid,i)=>{const nm=existing.names[i];if(pid&&typeof nm==='string'&&nm.trim()&&!people.some(p=>p.id===pid))people.push({id:pid,name:nm,type:'guest',seed:'미정',points:0,adhoc:true});});
    let active='member',selected=new Set(existing?.participantIds?.length?existing.participantIds:people.filter(p=>existing?.names.includes(nameOf(p))).map(p=>p.id));
    let methods=Array.from({length:Number(existing?.rounds)||4},()=>'random');
    let lateIds=new Set();
    dialog.innerHTML='<div class="dialog-head"><h2 id="pickerTitle">'+(existing?'참가자·코트 변경':'새 대진 만들기')+'</h2><button id="closePicker" aria-label="닫기">×</button></div><label>대진 제목<input id="newTitle" maxlength="120" value="'+esc(existing?.title||'')+'" placeholder="비워두면 오늘 날짜와 시간이 제목이 됩니다"></label><div class="two"><label>코트 수<input id="courts" type="number" min="1" max="20" value="'+(existing?.courts||3)+'"></label><label>라운드 수<input id="rounds" type="number" min="1" max="20" value="'+(existing?.rounds||4)+'"></label></div><div id="roundMethods" class="round-methods"></div><div class="tabs"><button id="memberTab" aria-pressed="true">회원</button><button id="guestTab" aria-pressed="false">게스트</button></div><label>이름 검색<input id="searchPeople" type="search" placeholder="이름으로 찾기"></label><div class="add-guest"><input id="newGuestName" maxlength="100" placeholder="새로 온 게스트 이름"><button type="button" id="addGuest">추가하기</button></div><p id="selectedCount" aria-live="polite"></p><div class="people-grid picker-list" id="choices"></div><div class="sticky-actions"><button id="selectAll">현재 목록 전체 선택</button><button id="clearAll">전체 선택 해제</button></div><p class="seed-note">라운드마다 매칭 방식을 고르면 시드 점수를 반영해 대진이 만들어집니다. 동일=점수가 가까운 사람끼리, 인접=실력 균형(강약 섞기), 랜덤=점수 무관. 늦참자는 아래 목록에서 표시하면 쉬는 순서가 조정됩니다.</p><button id="generate" class="primary">'+(existing?'선택한 참가자로 대진 다시 만들기':'선택한 참가자로 대진 만들기')+'</button>';
    const visible=()=>people.filter(p=>p.type===active&&p.name.includes($('searchPeople').value.trim()));
    const count=()=>{$('selectedCount').textContent='선택 '+selected.size+'명 · 회원 '+people.filter(p=>p.type==='member'&&selected.has(p.id)).length+'명 / 게스트 '+people.filter(p=>p.type==='guest'&&selected.has(p.id)).length+'명';};
    function render(){for(const type of ['member','guest'])$(type+'Tab').setAttribute('aria-pressed',String(active===type));$('choices').innerHTML=visible().map(p=>'<label class="person"><input type="checkbox" value="'+esc(p.id)+'"'+(selected.has(p.id)?' checked':'')+'><span>'+nameHTML(p.name)+'</span><small>'+seedHTML(p.seed||'미정')+'</small>'+'<button type="button" class="late-btn'+(lateIds.has(p.id)?' on':'')+'" data-id="'+esc(p.id)+'">늦참</button>'+'</label>').join('')||'<p>검색 결과가 없습니다.</p>';count();}
    const methodLabels=[['same','동일'],['balanced','인접'],['random','랜덤']];
    function renderMethods(){
      const n=Math.max(1,Math.min(20,Number($('rounds').value)||1));
      if(methods.length<n)while(methods.length<n)methods.push('random');
      if(methods.length>n)methods=methods.slice(0,n);
      $('roundMethods').innerHTML='<div class="rm-title">라운드별 매칭 방식</div>'+methods.map((mth,i)=>'<div class="rm-row"><span class="rm-round">'+(i+1)+'R</span><div class="rm-opts" role="group" aria-label="'+(i+1)+'라운드 매칭 방식">'+methodLabels.map(([v,l])=>'<button type="button" class="rm-btn'+(mth===v?' on':'')+'" data-r="'+i+'" data-v="'+v+'" aria-pressed="'+(mth===v)+'">'+l+'</button>').join('')+'</div></div>').join('');
    }
    $('choices').onchange=e=>{if(e.target.checked)selected.add(e.target.value);else selected.delete(e.target.value);count();};
    $('choices').addEventListener('click',e=>{const b=e.target.closest('.late-btn');if(!b)return;e.preventDefault();const id=b.dataset.id;if(lateIds.has(id))lateIds.delete(id);else lateIds.add(id);b.classList.toggle('on');b.setAttribute('aria-pressed',String(lateIds.has(id)));});
    $('roundMethods').onclick=e=>{const b=e.target.closest('.rm-btn');if(!b)return;methods[+b.dataset.r]=b.dataset.v;renderMethods();};
    $('rounds').oninput=renderMethods;
    $('memberTab').onclick=()=>{active='member';render();};$('guestTab').onclick=()=>{active='guest';render();};$('searchPeople').oninput=render;$('selectAll').onclick=()=>{visible().forEach(p=>selected.add(p.id));render();};$('clearAll').onclick=()=>{selected.clear();render();};$('closePicker').onclick=()=>dialog.close();
    $('addGuest').onclick=()=>{const inp=$('newGuestName'),name=inp.value.trim();if(!name)return alert('게스트 이름을 입력해주세요.');if(people.some(p=>p.name===name))return alert('같은 이름이 이미 목록에 있어요. 이름을 다르게 적어주세요.');const g={id:crypto.randomUUID(),name,type:'guest',seed:'미정',points:0,adhoc:true};people.push(g);selected.add(g.id);inp.value='';active='guest';$('searchPeople').value='';render();inp.focus();};
    $('newGuestName').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();$('addGuest').click();}};
    $('generate').onclick=()=>{
      const c=Number($('courts').value),r=Number($('rounds').value),picked=people.filter(p=>selected.has(p.id));
      if(picked.length<4)return alert('참가자 4명 이상을 선택해주세요.');
      if(!Number.isInteger(c)||c<1||c>20||!Number.isInteger(r)||r<1||r>20)return alert('코트와 라운드는 1~20 사이 정수로 입력해주세요.');
      if(existing&&!confirm('기존 대진 구성을 새로 만듭니다. 저장하기 전까지 게시된 대진은 그대로 유지됩니다. 계속할까요?'))return;
      const roster=picked.map(p=>({id:p.id,name:nameOf(p),type:p.type,points:Number(p.points)||0,late:lateIds.has(p.id),operator:OPERATORS.has(p.name)}));
      const names=roster.map(x=>x.name),d={id:existing?.id||crypto.randomUUID(),kind:'schedule',version:existing?.version||0,title:$('newTitle').value.trim()||stamp(),names,participantIds:picked.map(p=>p.id),courts:c,rounds:r,schedule:generate(roster,c,r,methods),results:{}};
      dialog.close();editSchedule(d);dirty=true;window.scrollTo(0,0);
    };render();renderMethods();dialog.showModal();
  }
  async function seeds(token){
    await getPeople();const rankingData=await api('/api/rankings'),ranking=rankingData.items;if(token!==routeToken)return;let type='member';
    const ud=(rankingData.updatedDate||'2026-09-10').split('-'),updatedText=(+ud[0])+'년 '+(+ud[1])+'월 '+(+ud[2])+'일';
    app.innerHTML=crumb()+'<h1>시드현황</h1><p class="seed-note"><strong>'+updatedText+' 최신화된 시드현황표입니다</strong><br>정모 출석 +1, 승 +1, 패 -1을 누적해 시드를 자동 계산합니다</p><div class="tabs"><button id="seedMembers" aria-pressed="true">회원 랭킹</button><button id="seedGuests" aria-pressed="false">게스트</button></div><label>이름 검색<input id="seedSearch" type="search" placeholder="이름으로 찾기"></label><p class="muted" id="seedCount"></p><div id="seedList"></div>';
    function movement(row){if(row.previous_rank===row.rank)return '<span class="muted">-</span>';return row.previous_rank>row.rank?'<span class="rank-movement">▲ '+(row.previous_rank-row.rank)+'</span>':'<span class="rank-down">▼ '+(row.rank-row.previous_rank)+'</span>';}
    function render(){
      const term=$('seedSearch').value.trim();$('seedMembers').setAttribute('aria-pressed',String(type==='member'));$('seedGuests').setAttribute('aria-pressed',String(type==='guest'));
      if(type==='member'){
        const list=ranking.filter(row=>row.name.includes(term));$('seedCount').textContent='회원 '+list.length+'명';const rows=list.map(row=>'<tr><td>'+row.rank+'</td><td>'+movement(row)+'</td><td>'+nameHTML(row.name)+crown(row.name)+'</td><td><span class="seed-badge">'+seedHTML(row.seed)+'</span></td><td>'+row.points+'</td><td>'+row.attendance+'</td><td>'+row.wins+'</td><td>'+row.losses+'</td></tr>').join('');$('seedList').innerHTML=rows?'<div class="panel ranking-table-wrap"><table class="ranking-table"><thead><tr><th>순위</th><th>변동</th><th>회원</th><th>시드</th><th>점수</th><th>출석</th><th>승</th><th>패</th></tr></thead><tbody>'+rows+'</tbody></table></div>':'<p>검색 결과가 없습니다.</p>';
      }else{
        const ranked=people.filter(p=>p.type==='guest'&&!p.adhoc).map((p,i)=>({...p,i})).sort((a,b)=>(b.points||0)-(a.points||0)||a.i-b.i).map((p,idx)=>({...p,rank:idx+1}));
        const list=ranked.filter(p=>p.name.includes(term));$('seedCount').textContent='게스트 '+list.length+'명';
        const rows=list.map(p=>'<tr><td>'+p.rank+'</td><td><span class="muted">-</span></td><td>'+nameHTML(p.name)+'</td><td><span class="seed-badge">'+seedHTML(p.seed||'미정')+'</span></td><td>'+(typeof p.points==='number'?p.points:'-')+'</td><td><span class="muted">-</span></td><td><span class="muted">-</span></td><td><span class="muted">-</span></td></tr>').join('');
        $('seedList').innerHTML=rows?'<p class="seed-note">게스트 점수는 2026년 9월 10일 기준표 값이며, 정모 출석·승패 점수 누적에는 반영되지 않습니다.</p><div class="panel ranking-table-wrap"><table class="ranking-table"><thead><tr><th>순위</th><th>변동</th><th>게스트</th><th>시드</th><th>점수</th><th>출석</th><th>승</th><th>패</th></tr></thead><tbody>'+rows+'</tbody></table></div>':'<p>검색 결과가 없습니다.</p>';
      }
    }
    $('seedMembers').onclick=()=>{type='member';render();};$('seedGuests').onclick=()=>{type='guest';render();};$('seedSearch').oninput=render;render();
  }
  async function route(){
    const token=++routeToken,hash=location.hash||'#home';lastHash=hash;draft=null;app.innerHTML='<p class="empty">불러오는 중…</p>';
    try{if(hash==='#schedule'||hash==='#notice')await board(hash.slice(1),token);else if(hash==='#seed')await seeds(token);else if(hash.startsWith('#post/'))await detail(hash.slice(6),token);else home();}catch(e){if(token===routeToken){app.innerHTML=crumb()+'<div class="panel error-box">'+esc(e.message)+'<p><button id="retry">다시 시도</button></p></div>';$('retry').onclick=route;}}
  }
  window.addEventListener('hashchange',()=>{if(saving){history.replaceState(null,'',lastHash);return;}if(dirty&&!confirm('저장하지 않은 변경 내용이 있습니다. 이동할까요?')){history.replaceState(null,'',lastHash);return;}dirty=false;dialog.close();route();window.scrollTo(0,0);});
  document.addEventListener('click',e=>{const a=e.target.closest('a');if(a&&draft&&a.getAttribute('href')===(location.hash||'#home')){e.preventDefault();if(saving)return;if(dirty&&!confirm('저장하지 않은 변경 내용이 있습니다. 이동할까요?'))return;dirty=false;route();}});
  window.addEventListener('beforeunload',e=>{if(dirty||saving){e.preventDefault();e.returnValue='';}});
  route();
}
