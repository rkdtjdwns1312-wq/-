export function client(EDITOR,ADMIN,createScheduleTools,createLiveView){
  const scheduleTools=createScheduleTools();
  const $=id=>document.getElementById(id),app=$('app'),dialog=$('picker');
  const extraStyle=document.createElement('style');extraStyle.textContent='.ranking-table-wrap{overflow:auto}.ranking-table{width:100%;border-collapse:collapse;min-width:620px}.ranking-table th{background:#eafff1;color:#245c39;font-weight:700}.ranking-table th,.ranking-table td{padding:12px 14px;text-align:center;border-bottom:1px solid #e0ebe4;white-space:nowrap}.ranking-table th:nth-child(3),.ranking-table td:nth-child(3){text-align:left}.rank-movement{color:#e5484d;font-weight:700}.rank-down{color:#2f6fed;font-weight:700}.seed-badge{display:inline-block;min-width:2.7em;padding:2px 7px;border-radius:999px;background:#eafff1;color:#176337;font-weight:700}.match-result{display:flex;justify-content:center;align-items:center;gap:7px;flex-wrap:wrap;margin-top:14px;padding-top:12px;border-top:1px solid #dcece1}.result-label{width:100%;color:#587261;font-size:.875rem}.winner-button{padding:7px 10px;font-size:.875rem}.winner-button.selected{background:#03ac50;color:#fff;border-color:#03ac50}.settled-badge{display:inline-block;margin:8px 0;padding:4px 9px;border-radius:999px;background:#eafff1;color:#176337;font-size:.875rem;font-weight:600}@media(max-width:650px){.ranking-table th,.ranking-table td{padding:10px 9px}.winner-button{font-size:.8rem;padding:6px 8px}}';extraStyle.textContent+='.seed-actions{display:inline-flex;gap:4px;margin-left:7px;vertical-align:middle}.person-manage{padding:3px 7px;font-size:.68rem;border-radius:999px;font-weight:700}.history-list{list-style:none;padding:0;margin:10px 0}.history-list li{padding:10px 0;border-bottom:1px solid #e0ebe4;font-size:.88rem}.history-list li:last-child{border-bottom:0}.history-meta{display:block;color:#708078;font-size:.78rem;margin-bottom:2px}.history-reason{display:block;color:#4f6759;margin-top:3px;overflow-wrap:anywhere}';document.head.append(extraStyle);
  function updateDaysTogether(){
    const output=$('daysTogether');if(!output)return;
    const parts=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Seoul',year:'numeric',month:'numeric',day:'numeric'}).formatToParts(new Date());
    const today=Date.UTC(Number(parts.find(p=>p.type==='year').value),Number(parts.find(p=>p.type==='month').value)-1,Number(parts.find(p=>p.type==='day').value));
    const since=Date.UTC(2026,4,8);
    output.textContent=String(Math.max(1,Math.floor((today-since)/86400000)+1));
  }
  updateDaysTogether();setInterval(updateDaysTogether,60000);
  function openLoginDialog(title,fieldLabel,endpoint,redirectRe,goLabel,focusBack){
    dialog.innerHTML='<form id="loginForm"><div class="dialog-head"><h2 id="pickerTitle">'+esc(title)+'</h2><button type="button" id="closeLogin" aria-label="닫기">×</button></div><label for="loginPw">'+esc(fieldLabel)+'</label><input id="loginPw" type="password" inputmode="numeric" autocomplete="current-password" required maxlength="128" autofocus><p id="loginError" class="login-error" role="alert"></p><div class="sticky-actions"><button type="submit" id="loginSubmit" class="primary">'+esc(goLabel)+'</button><button type="button" id="cancelLogin">취소</button></div></form>';
    const form=$('loginForm'),password=$('loginPw'),submit=$('loginSubmit'),errorOutput=$('loginError');
    const active=()=>dialog.open&&dialog.querySelector('#loginForm')===form;
    const close=()=>dialog.close();$('closeLogin').onclick=close;$('cancelLogin').onclick=close;
    form.onsubmit=async e=>{
      e.preventDefault();if(submit.disabled)return;
      submit.disabled=true;submit.textContent='확인 중…';errorOutput.textContent='';
      try{
        const result=await api(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:password.value})});
        if(!active())return;
        if(!redirectRe.test(result.redirect||''))throw Error('주소를 확인하지 못했습니다.');
        location.assign(result.redirect);
      }catch(error){if(active()){errorOutput.textContent=error.message;password.focus();password.select();}}
      finally{if(active()){submit.disabled=false;submit.textContent=goLabel;}}
    };
    dialog.onclose=()=>{dialog.onclose=null;dialog.innerHTML='';if(focusBack)focusBack();};dialog.showModal();
  }
  if(!EDITOR&&!ADMIN){
    // 요청 075: 항상 노출된 버튼 대신 작은 사람 실루엣 버튼 → 누르면 두 항목(운영진권한 위 / 홈페이지관리자 권한 아래).
    const fab=document.createElement('button');
    fab.className='access-fab';fab.type='button';fab.setAttribute('aria-label','로그인');fab.setAttribute('aria-haspopup','menu');fab.setAttribute('aria-expanded','false');
    fab.innerHTML='<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"><path fill="currentColor" d="M12 12a5 5 0 1 0-5-5 5 5 0 0 0 5 5Zm0 2c-4.42 0-8 2.24-8 5v1h16v-1c0-2.76-3.58-5-8-5Z"/></svg>';
    const menu=document.createElement('div');menu.className='access-menu';menu.hidden=true;menu.setAttribute('role','menu');
    const opItem=document.createElement('button');opItem.type='button';opItem.className='access-item';opItem.textContent='운영진권한';opItem.setAttribute('role','menuitem');
    const adItem=document.createElement('button');adItem.type='button';adItem.className='access-item';adItem.textContent='홈페이지관리자 권한';adItem.setAttribute('role','menuitem');
    menu.append(opItem,adItem);
    document.body.append(menu,fab);
    const closeMenu=()=>{menu.hidden=true;fab.setAttribute('aria-expanded','false');};
    fab.onclick=e=>{e.stopPropagation();const willOpen=menu.hidden;menu.hidden=!willOpen;fab.setAttribute('aria-expanded',String(willOpen));};
    document.addEventListener('click',e=>{if(!menu.hidden&&!menu.contains(e.target)&&e.target!==fab)closeMenu();});
    document.addEventListener('keydown',e=>{if(e.key==='Escape')closeMenu();});
    opItem.onclick=()=>{closeMenu();openLoginDialog('운영진권한','운영진 비밀번호','/api/operator-login',/^\/operate-[a-zA-Z0-9_-]+$/,'운영진 화면으로',()=>fab.focus());};
    adItem.onclick=()=>{closeMenu();openLoginDialog('홈페이지관리자 권한','관리자 비밀번호','/api/admin-login',/^\/administrate-[a-zA-Z0-9_-]+$/,'관리자 화면으로',()=>fab.focus());};
  }
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  // 요청 073: 운영진(왕관)은 DB(is_operator)로 관리. 초기값은 아래 6명, 데이터 로드 시 갱신.
  let OPERATORS=new Set(['로토','백구','구구','이코','뉴키','단우']);
  function syncOperators(list){const ms=(list||[]).filter(p=>p.type==='member'||('member_id' in p));if(ms.length&&('is_operator' in ms[0]))OPERATORS=new Set(ms.filter(p=>p.is_operator).map(p=>p.name));}
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
      if(m=text.match(/^🔴\s*(.+)$/)){closeList();parts.push('<h2 class="nb-section nb-section-alert"><span>'+esc(m[1])+'</span></h2>');continue;}
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
  let people=[],peopleRead=0,draft=null,editRoster=people,dirty=false,routeToken=0,detailRead=0,saving=false,lastHash=location.hash||'#home',viewRound=1,pollTimer=null,recordingResult=false,ending=false,unsettling=false,addingCourt=false,emergencySubstituteOpening=false;
  let liveView=null;
  const stopPoll=()=>{if(pollTimer){clearInterval(pollTimer);pollTimer=null;}liveView?.stop();};
  if(typeof createLiveView==='function')liveView=createLiveView({app,api,esc,EDITOR,message,isCurrent:token=>token===routeToken&&location.hash==='#live'});
  function message(text,error=false){$('message').textContent=text;$('message').className=error?'error':'';}
  async function api(path,options){const r=await fetch(path,options);let x;try{x=await r.json();}catch{throw Error('응답을 확인하지 못했습니다. 다시 시도해주세요.');}if(!r.ok){const error=Error(x.error||'요청에 실패했습니다.');error.status=r.status;throw error;}return x;}
  async function getPeople(force=false){if(force||!people.length){const request=++peopleRead,next=(await api('/api/people')).people;if(!Array.isArray(next))throw Error('최신 명단을 확인하지 못했습니다. 다시 시도해주세요.');if(request===peopleRead){people=next;syncOperators(people);}return next;}return people;}
  function nameOf(p){return people.some(q=>q.name===p.name&&q.id!==p.id)?p.name+' ('+(p.type==='member'?'회원':'게스트')+')':p.name;}
  const crumb=kind=>'<a class="crumb'+(kind?'':' home-return')+'" href="'+(kind?'#'+kind:'#home')+'">'+(kind?'← '+(kind==='schedule'?'대진표 목록':kind==='notice'?'공지사항 목록':'홈으로'):'홈으로 가기')+'</a>';
  async function home(){const token=routeToken;app.innerHTML='<section class="home-intro"><img src="/mascot-play.png" alt="배드민턴을 치는 콕끼리" width="175" height="175"></section><nav class="menus" aria-label="게시판"><a class="menu" href="#notice"><span class="menu-title">공지사항</span><small>함께 알아둘 모임 소식</small></a><a class="menu" href="#schedule"><span class="menu-title">대진표</span><small>날짜별 대진과 지난 게임</small></a><a class="menu" href="#live"><span class="menu-title">실시간대진</span><small>오늘의 자유대진</small></a><a class="menu" href="#seed"><span class="menu-title">시드현황</span><small>회원 · 게스트 시드 확인</small></a></nav>'+(EDITOR?'<div class="home-note"><span>새로운 게임을 준비하시나요?</span><button class="primary" id="homeNew">+ 대진 만들기</button></div>':'')+'<div id="mvpHome"></div>';if(EDITOR)$('homeNew').onclick=()=>openPicker(null);try{const m=await api('/api/mvp');if(token!==routeToken)return;if(m&&Array.isArray(m.mvp)&&m.mvp.length&&m.settledAt&&(Date.now()-new Date(m.settledAt).getTime())/86400000<=5){const el=$('mvpHome');if(el)el.innerHTML='<a class="mvp-home" href="#post/'+encodeURIComponent(m.id)+'"><span class="mvp-home-cap">🥇 이번 정모 MVP</span><span class="mvp-title">'+esc(m.mvp.join(' '))+'</span></a>';}}catch(e){}}
  async function board(kind,token){
    app.innerHTML=crumb()+'<div class="bar"><div><h1>'+(kind==='schedule'?'대진표':'공지사항')+'</h1><p class="muted">'+(kind==='schedule'?'제목을 누르면 그날의 대진표를 볼 수 있어요.':'콕끼리의 새로운 소식을 확인하세요.')+'</p></div>'+(EDITOR?'<button id="newPost" class="primary">+ '+(kind==='schedule'?'대진 만들기':'공지 쓰기')+'</button>':'')+'</div><div class="panel" id="postList"><p class="empty">불러오는 중…</p></div><button class="more" id="more" hidden>더 보기</button>';
    if(EDITOR)$('newPost').onclick=()=>kind==='schedule'?openPicker(null):editNotice({id:crypto.randomUUID(),kind,version:0,title:'',body:''});
    let offset=0;
    async function more(){
      const button=$('more');button.disabled=true;
      try{const x=await api('/api/posts?kind='+kind+'&offset='+offset);if(token!==routeToken)return;
        if(!offset)$('postList').innerHTML='';
        if(!offset&&!x.items.length)$('postList').innerHTML='<div class="empty"><img src="/mascot-rest.png" alt="기다리는 콕끼리"><p>아직 등록된 '+(kind==='schedule'?'대진표':'공지사항')+'가 없습니다.</p></div>';
        $('postList').insertAdjacentHTML('beforeend',x.items.map(p=>'<a class="post'+((kind==='notice'||kind==='schedule')?' post-notice':'')+'" href="#post/'+encodeURIComponent(p.id)+'"><div>'+(kind==='notice'?'<span class="post-label">공지</span>':kind==='schedule'?'<span class="post-label post-label-alt">대진</span>':'')+'<div class="post-title">'+esc(p.title)+(kind==='schedule'&&p.settledAt?'<span class="settled-tag">마감</span>':'')+'</div>'+(kind==='schedule'&&p.settledAt&&Array.isArray(p.mvp)&&p.mvp.length?'<div class="mvp-line"><span class="mvp-medal" aria-hidden="true">🥇</span> <span class="mvp-title">MVP '+esc(p.mvp.join(' '))+'</span></div>':'')+((EDITOR||kind!=='notice')?'<small>'+esc(date(p.created_at))+(p.version>1?' · 수정됨':'')+'</small>':'')+'</div></a>').join(''));
        offset+=x.items.length;button.hidden=!x.hasMore;
      }catch(e){if(token===routeToken){message(e.message,true);button.hidden=false;button.textContent='다시 불러오기';}}finally{button.disabled=false;}
    }
    $('more').onclick=more;await more();
  }
  function winBtn(key,side,result,locked){
    return '<button type="button" class="win-pick'+(result===side?' picked':'')+'" data-result-key="'+key+'" data-winner="'+side+'" aria-pressed="'+(result===side)+'"'+(locked?' disabled':'')+' aria-label="이 팀 승리">승</button>';
  }
  function matchStateControl(d,r,ri,mi,key,state){
    const labels={waiting:'대기중',playing:'대진중',finished:'대진종료',void:'무효'};
    const court=(mi+1)+'번 대진',round=esc(r.round)+'라운드';
    let next=null,action='확인';
    if(state==='waiting'){next='playing';action='대진중으로 변경';}
    else if(state==='playing'){next=r.method==='random'?'finished':'waiting';action=next==='finished'?'대진종료로 변경':'실수로 시작한 대진을 대기중으로 되돌리기';}
    else if(state==='finished'&&r.method==='random'&&!d.settledAt){next='waiting';action='대기중으로 되돌리기';}
    const aria=round+' '+court+', 현재 '+labels[state]+(next?', 누르면 '+action:'');
    return next?'<button type="button" class="match-state state-'+state+'" data-progress-key="'+key+'" data-progress-next="'+next+'" data-progress-round="'+ri+'" data-progress-match="'+mi+'" aria-label="'+aria+'" title="'+action+'">'+labels[state]+'</button>':'<span class="match-state state-'+state+'" aria-label="'+aria+'">'+labels[state]+'</span>';
  }
  function scheduleHTML(d,editing=false,showResults=false,roster=people){
    const results=d.results||{};
    const cell=(m,mi,ri,si)=>editing
      ? '<select aria-label="'+(ri+1)+'라운드 '+(mi+1)+'대진 '+(si+1)+'번째 참가자" data-r="'+ri+'" data-m="'+mi+'" data-s="'+si+'">'+scheduleTools.availableNames(d,ri).map(p=>'<option'+(p===m[si]?' selected':'')+'>'+esc(p)+'</option>').join('')+'</select>'
      : '<span class="player">'+nameHTML(m[si])+'</span>';
    const team=(m,mi,ri,a,b)=>'<div class="team">'+cell(m,mi,ri,a)+'<span class="team-amp">·</span>'+cell(m,mi,ri,b)+'</div>';
    const isVoid=m=>Array.isArray(d.absent)&&d.absent.length>0&&m.some(n=>d.absent.includes(n));
    const multi=!editing&&d.schedule.length>1;
    const vr=multi?Math.min(Math.max(1,viewRound),d.schedule.length):0;
    const roundDone=ri=>d.schedule[ri].method==='random'||d.schedule[ri].g.every((m,mi)=>{if(isVoid(m))return true;const v=results[ri+'-'+mi];return v==='a'||v==='b';});
    const tabs=multi?'<div class="round-tabs" role="tablist" aria-label="라운드 선택">'+d.schedule.map((r,ri)=>'<button type="button" class="round-tab'+((ri+1)===vr?' on':'')+(!d.settledAt&&!roundDone(ri)?' incomplete':'')+'" data-round-tab="'+(ri+1)+'" aria-selected="'+((ri+1)===vr)+'">'+esc(r.round)+'R</button>').join('')+'</div>':'';
    const absentSet=Array.isArray(d.absent)?d.absent:[];
    const absentPanel=editing?'<div class="absent-panel"><div class="absent-title">불참자 지정</div><p class="absent-hint">불참으로 표시하면 그 사람이 들어간 경기는 무효(점수 미반영)가 되고, 출석 점수도 받지 않아요. 다시 누르면 해제됩니다.</p><div class="absent-chips">'+d.names.map(n=>'<button type="button" class="absent-toggle'+(absentSet.includes(n)?' on':'')+'" data-absent-name="'+esc(n)+'" aria-pressed="'+absentSet.includes(n)+'">'+nameHTML(n)+'</button>').join('')+'</div></div>':'';
    const partnerSummary=scheduleTools.partnerSummary(d.schedule)||{};
    const repeatedPartnerPairs=new Set((partnerSummary.pairs||[]).map(pair=>JSON.stringify([...(pair.names||[])].sort())));
    const partnerNote=editing?'<p class="edit-info partner-summary">'+(partnerSummary.duplicateTeams?'팀 파트너 중복 '+partnerSummary.duplicateTeams+'건이 남았습니다. 동일의 고정 4인 묶음·팀은 유지하며, 인접은 점수순 4인 박스·박스별 한 경기 최대 2명·가까운 박스 우선 제약을 지킨 뒤에도 참가 인원·라운드 수에 따라 반복이 남을 수 있습니다.':'팀 파트너 중복이 없습니다. 동일은 점수순 고정 4인 묶음과 회차별 팀 조합을 유지하고, 인접은 점수순 4인 박스·박스별 최대 2명·가까운 박스 우선 제약 안에서 생성합니다.')+' 박스가 홀수 개면 마지막 세 박스를 함께 섞습니다. 중복 정도가 같으면 팀 점수 균형을 맞춥니다.</p>':'';
    return tabs+absentPanel+partnerNote+d.schedule.map((r,ri)=>{
      const scored=r.method!=='random',methodLabel={same:'동일',balanced:'인접',random:'랜덤'}[r.method]||'인접';
      const waiting=Array.isArray(r.late)?r.late:[];
      const empty=r.g.length===0?'<p class="round-empty">참여 가능한 인원이 4명 미만이라 이 라운드에는 대진을 만들 수 없어요.</p>':'';
      const adjacentFourNote=editing&&r.method==='balanced'&&r.g.length===1?'<p class="edit-info adjacent-four-note">출전 인원이 4명뿐이라 다른 박스와 섞지 않고 예외 편성했습니다.</p>':'';
      return '<section class="round" data-round-panel="'+(ri+1)+'"'+(multi&&(ri+1)!==vr?' hidden':'')+'><div class="round-head"><span class="round-badge">'+esc(r.round)+'R</span><h3>'+esc(r.round)+' 라운드</h3><span class="round-tag">'+methodLabel+(scored?'':' · 점수 미반영')+'</span></div>'+empty+adjacentFourNote+'<div class="matches">'+r.g.map((m,mi)=>{
        const key=ri+'-'+mi,result=results[key],voidM=isVoid(m),state=scheduleTools.matchState(d,ri,mi);
        const showWin=scored&&!voidM&&(showResults||result),locked=Boolean(d.settledAt)&&!editing;
        const twrap=(a,b,side)=>'<div class="team-wrap wrap-'+side+((!voidM&&result===side)?' win':'')+'">'+team(m,mi,ri,a,b)+'</div>';
        const mid=(scored&&!voidM)?'<div class="vs-cluster">'+(showWin?winBtn(key,'a',result,locked):'')+'<b class="vs">VS</b>'+(showWin?winBtn(key,'b',result,locked):'')+'</div>':'<b class="vs">VS</b>';
        const gap=scored?scheduleTools.scoreGap(m,d,roster):null;
        const gapWarning=!scored?'':gap===null?'<div class="seed-gap-unavailable" role="note">시드 점수를 확인할 수 없어 점수 차이를 계산하지 못했습니다.</div>':gap>=30?'<div class="seed-gap-warning" role="note"><span aria-hidden="true">⚠️</span><span>상당한 시드 점수 차이가 존재하는 대진 입니다.</span></div>':'';
        const partnerWarning=scored&&[m.slice(0,2),m.slice(2,4)].some(pair=>repeatedPartnerPairs.has(JSON.stringify([...pair].sort())))?'<div class="partner-duplicate-warning" role="note"><span aria-hidden="true">⚠️</span><span>파트너가 중복된 대진입니다.</span></div>':'';
        let note='';
        if(voidM)note='<div class="match-result"><span class="random-note void-note">불참자가 있어 무효 경기예요. 점수에 반영되지 않아요.</span></div>';
        else if(!scored)note='<div class="match-result"><span class="random-note">랜덤 경기예요. 승패는 점수에 반영되지 않아요.</span></div>';
        else if(showWin&&!result&&!locked)note='<div class="match-hint">이긴 팀의 <b>승</b>을 눌러주세요</div>';
        return '<div class="match '+(editing?'edit-match':'state-'+state)+((!voidM&&result)?' has-result result-'+result:'')+((scored&&!voidM)?'':' random-match')+(voidM?' void-match':'')+'">'+(editing?'':matchStateControl(d,r,ri,mi,key,state))+'<div class="court">'+(mi+1)+'번 대진'+(editing?'<button type="button" class="del-court" data-del-court="'+ri+'-'+mi+'" aria-label="'+(mi+1)+'번 대진 삭제" title="이 대진 삭제">✕</button>':'')+'</div><div class="teams">'+twrap(0,1,'a')+mid+twrap(2,3,'b')+'</div>'+gapWarning+partnerWarning+note+'</div>';
      }).join('')+'</div>'+(editing?'<button type="button" class="add-court" data-add-court="'+ri+'">＋ 코트 추가</button>':'')+'<div class="rest" id="rest-'+ri+'">휴식: '+esc((r.rest||[]).join(', ')||'없음')+'</div>'+(waiting.length?'<div class="late-wait">늦참 대기: '+esc(waiting.join(', '))+'</div>':'')+'</section>';
    }).join('');
  }
  async function detail(id,token){
    const request=++detailRead,current=()=>request===detailRead&&token===routeToken&&!draft;
    const {data:d}=await api('/api/posts/'+encodeURIComponent(id));if(!current())return;
    let roster=[];
    if(d.kind==='schedule'){
      try{roster=await getPeople(true);}catch(e){}
      if(!current())return;
    }
    const dVoid=m=>Array.isArray(d.absent)&&d.absent.length>0&&m.some(n=>d.absent.includes(n));
    const allScoredDone=d.kind==='schedule'&&d.schedule.every((r,ri)=>r.method==='random'||r.g.every((m,mi)=>{if(dVoid(m))return true;const v=d.results&&d.results[ri+'-'+mi];return v==='a'||v==='b';}));
    const editable=EDITOR&&!(d.kind==='schedule'&&d.settledAt),canEmergencySubstitute=Boolean(EDITOR&&d.kind==='schedule'&&!d.settledAt&&Number(d.version)>0);
    const actions=editable?'<div class="detail-actions"><button id="editPost">수정하기</button>'+(canEmergencySubstitute?'<button id="emergencySubstitute" class="emergency-substitute">긴급교체</button>':'')+'<button id="deletePost" class="danger">삭제</button></div>':((EDITOR&&d.kind==='schedule'&&d.settledAt)?'<div class="detail-actions"><button id="unsettlePost" class="danger">마감 취소</button></div>':'');
    const incompleteRounds=(d.kind==='schedule'&&!d.settledAt)?d.schedule.map((r,ri)=>({n:r.round,done:r.method==='random'||r.g.every((m,mi)=>{if(dVoid(m))return true;const v=d.results&&d.results[ri+'-'+mi];return v==='a'||v==='b';})})).filter(x=>!x.done).map(x=>x.n):[];
    const endBtn=(EDITOR&&d.kind==='schedule'&&!d.settledAt)?(allScoredDone?'<div class="end-match-wrap"><button id="endMatch" class="primary end-match">대진 마감</button></div>':'<div class="end-note">아직 승패를 기록하지 않은 대진이 있어요. 라운드 버튼에 점이 있는 <b>'+incompleteRounds.join(', ')+'라운드</b>의 결과를 모두 입력하면 <b>대진 마감</b> 버튼이 나타나요.</div>'):'';
    app.innerHTML=crumb(d.kind)+'<article class="panel detail"><div class="bar"><div>'+(d.kind==='notice'?'<span class="post-label">공지사항</span>':'')+'<h1>'+esc(d.preTitle||d.title)+'</h1>'+((EDITOR||d.kind!=='notice')?'<p class="muted">등록 '+esc(date(d.createdAt))+(d.version>1?' · 수정 '+esc(date(d.updatedAt)):'')+'</p>':'')+(d.settledAt?'<span class="settled-badge">점수 반영 완료</span>':'')+'</div>'+actions+'</div>'+(d.kind==='notice'?'<div class="notice-body">'+noticeHTML(d.body)+'</div>':'<div class="schedule-meta"><span class="chip">참가 '+d.names.length+'명</span><span class="chip">'+d.courts+'코트</span><span class="chip">'+d.rounds+'라운드</span></div>'+scheduleHTML(d,false,!d.settledAt,roster)+endBtn)+'</article>';
    if(d.kind==='schedule'&&!d.settledAt){
      app.querySelectorAll('.win-pick:not([disabled])').forEach(btn=>btn.onclick=()=>recordResult(d,btn,token));
      bindProgressControls(d,token);
    }
    if(EDITOR&&$('editPost'))$('editPost').onclick=()=>d.kind==='notice'?editNotice(d):editSchedule(d,roster);
    if(canEmergencySubstitute&&$('emergencySubstitute'))$('emergencySubstitute').onclick=()=>openEmergencySubstitute(d,token);
    if(EDITOR&&$('deletePost'))$('deletePost').onclick=async()=>{if(!confirm((d.kind==='schedule'?'이 대진표':'이 공지')+'를 삭제할까요? 삭제하면 되돌릴 수 없습니다.'))return;try{await api('/api/posts/'+encodeURIComponent(d.id),{method:'DELETE',headers:{'x-kokkiri-editor':EDITOR}});}catch(e){return message(e.message,true);}location.hash='#'+d.kind;};
    if($('endMatch'))$('endMatch').onclick=()=>endMatch(d,token);
    if($('unsettlePost'))$('unsettlePost').onclick=()=>unsettlePost(d,token);
    const rtabs=app.querySelector('.round-tabs');if(rtabs)rtabs.onclick=e=>{const b=e.target.closest('.round-tab');if(!b)return;viewRound=+b.dataset.roundTab;app.querySelectorAll('.round-tab').forEach(x=>{const on=x===b;x.classList.toggle('on',on);x.setAttribute('aria-selected',String(on));});app.querySelectorAll('[data-round-panel]').forEach(p=>{p.hidden=(+p.dataset.roundPanel)!==viewRound;});};
    startDetailPoll(d,token);
  }
  async function openEmergencySubstitute(d,token){
    if(!EDITOR||emergencySubstituteOpening||!currentDetail(d.id,token)||d.settledAt||Number(d.version)<1)return;
    emergencySubstituteOpening=true;
    const shownVersion=Number(d.version),shownId=d.id;
    let currentPeople;
    try{currentPeople=await getPeople(true);}catch(error){emergencySubstituteOpening=false;if(currentDetail(shownId,token))message(error.message||'최신 시드현황을 불러오지 못했습니다.',true);return;}
    if(!currentDetail(shownId,token)||d.settledAt||Number(d.version)!==shownVersion){emergencySubstituteOpening=false;return;}
    const activeNames=new Set(currentPeople.filter(person=>(person.type==='member'||person.type==='guest')&&!person.hidden&&!person.adhoc).map(person=>person.name));
    dialog.innerHTML='<form id="emergencySubstituteForm"><div class="dialog-head"><h2 id="pickerTitle">긴급교체</h2><button type="button" id="closeEmergencySubstitute" aria-label="닫기">×</button></div><p class="emergency-note">기록된 승패 결과와 대진 진행 상태는 교체 멤버에게 그대로 이어집니다. 이 교체는 선택한 라운드·코트의 한 자리만 바꾸며, 다른 코트와 기존 기록은 유지됩니다.</p><div class="two emergency-target"><label>라운드<input id="substituteRound" type="number" min="1" max="'+d.schedule.length+'" step="1" value="'+Math.min(Math.max(1,viewRound),d.schedule.length)+'" required></label><label>코트<input id="substituteCourt" type="number" min="1" step="1" value="1" required></label></div><label>기존 멤버<input id="substituteOldName" maxlength="100" autocomplete="off" required></label><label>교체 멤버<input id="substituteNewName" maxlength="100" autocomplete="off" required></label><p class="emergency-hint">교체 멤버 이름은 시드현황에 등록된 현재 회원 또는 게스트 이름과 정확히 같아야 합니다. 없는 이름은 먼저 시드현황에 등록해주세요.</p><p id="emergencySubstituteError" class="login-error" role="alert"></p><div class="sticky-actions"><button type="submit" id="confirmEmergencySubstitute" class="primary">교체 확인</button><button type="button" id="cancelEmergencySubstitute">취소</button></div></form>';
    const form=$('emergencySubstituteForm'),roundInput=$('substituteRound'),courtInput=$('substituteCourt'),oldInput=$('substituteOldName'),newInput=$('substituteNewName'),submit=$('confirmEmergencySubstitute'),errorOutput=$('emergencySubstituteError');
    let working=false,composing=false;
    const screenCurrent=()=>currentDetail(shownId,token),active=()=>screenCurrent()&&dialog.open&&dialog.querySelector('#emergencySubstituteForm')===form;
    const close=()=>{if(!working)dialog.close();};
    $('closeEmergencySubstitute').onclick=close;$('cancelEmergencySubstitute').onclick=close;
    dialog.oncancel=event=>{if(working)event.preventDefault();};
    form.addEventListener('compositionstart',()=>{composing=true;});form.addEventListener('compositionend',()=>{composing=false;});
    form.onsubmit=async event=>{
      event.preventDefault();if(working||composing||event.isComposing||!active())return;
      const round=Number(roundInput.value),court=Number(courtInput.value),oldName=oldInput.value.trim(),newName=newInput.value.trim();
      const match=Number.isInteger(round)&&round>=1&&round<=d.schedule.length&&Number.isInteger(court)&&court>=1?d.schedule[round-1]?.g?.[court-1]:null;
      if(!match){errorOutput.textContent='라운드와 코트 번호를 다시 확인해주세요.';return;}
      if(!oldName||!match.includes(oldName)){errorOutput.textContent='기존 멤버 이름은 선택한 코트의 참가자 이름과 정확히 같아야 합니다.';return;}
      if(!newName||!activeNames.has(newName)){errorOutput.textContent='교체 멤버는 시드현황에 등록된 현재 회원 또는 게스트 이름과 정확히 같아야 합니다. 없는 이름은 먼저 시드현황에 등록해주세요.';return;}
      if(newName===oldName){errorOutput.textContent='기존 멤버와 다른 교체 멤버를 입력해주세요.';return;}
      const target={round,court,oldName,newName};
      working=true;submit.disabled=true;submit.textContent='교체 중…';errorOutput.textContent='';
      try{
        await api('/api/posts/'+encodeURIComponent(shownId)+'/substitute',{method:'POST',headers:{'content-type':'application/json','x-kokkiri-editor':EDITOR},body:JSON.stringify({version:shownVersion,...target})});
        if(!active())return;
        dialog.oncancel=null;dialog.close();message('긴급교체를 저장했어요. 최신 대진표를 다시 불러옵니다.');await refreshDetail(d,token);
      }catch(error){
        if(!active())return;
        if(error.status===409){dialog.oncancel=null;dialog.close();message('다른 변경이 있어 최신 대진표를 불러왔어요. 내용을 확인한 뒤 긴급교체를 다시 확인해주세요.',true);await refreshDetail(d,token);return;}
        errorOutput.textContent=error.message||'긴급교체를 저장하지 못했습니다.';
      }finally{if(active()){working=false;submit.disabled=false;submit.textContent='교체 확인';}}
    };
    emergencySubstituteOpening=false;dialog.showModal();oldInput.focus();
  }
  function changed(){dirty=true;draft.operation=crypto.randomUUID();}
  function startDraft(d){++routeToken;stopPoll();draft=structuredClone(d);draft.operation=crypto.randomUUID();dirty=false;}
  async function addBalancedCourt(ri){
    if(!draft||saving||addingCourt)return;
    const d=draft,r=d.schedule[ri],token=routeToken,operation=d.operation;
    if(!r)return;
    if(r.g.length>=20)return alert('한 라운드에는 최대 20개의 대진을 만들 수 있어요.');
    const pool=[...(r.rest||[]),...scheduleTools.availableNames(d,ri)],four=[...new Set(pool)].slice(0,4);
    if(four.length<4)return alert('코트를 추가하려면 이 라운드에 참여 가능한 인원이 4명 이상 필요해요.');
    addingCourt=true;
    const active=()=>draft===d&&routeToken===token;
    try{
      let match=four,latest=editRoster;
      if(r.method!=='random'){
        latest=await getPeople(true);
        if(!active()||saving)return;
        if(d.operation!==operation)throw Error('대진 내용이 바뀌었습니다. 코트 추가를 다시 눌러주세요.');
        const byId=new Map(latest.map(p=>[p.id,p])),byName=new Map(latest.map(p=>[p.name,p]));
        const player=name=>{const index=d.names.indexOf(name),id=d.participantIds?.[index],p=id?byId.get(id):byName.get(name);return {id:id||name,name,points:p?Number(p.points):0};};
        const previous=d.schedule.filter(round=>round.method!=='random').flatMap(round=>round.g.map(group=>group.map(player)));
        const sameIndex=d.schedule.slice(0,ri).filter(round=>round.method==='same').length;
        match=scheduleTools.balanceFour(four.map(player),r.method||'balanced',previous,sameIndex).map(p=>p.name);
      }
      if(!active()||saving)return;
      editRoster=latest;r.g.push(match);scheduleTools.refreshRound(d,ri);changed();$('editMatches').innerHTML=scheduleHTML(d,true,true,editRoster);
    }catch(error){if(active())message(error.message||'최신 점수를 불러오지 못했습니다. 코트 추가를 다시 눌러주세요.',true);}
    finally{addingCourt=false;}
  }
  function editSchedule(d,roster=people){
    stopPoll();startDraft(d);draft.results=draft.results||{};draft.absent=Array.isArray(draft.absent)?draft.absent:[];
    editRoster=roster;
    app.innerHTML=crumb('schedule')+'<section class="panel detail"><h1>'+(d.version?'대진표 수정':'대진표 저장')+'</h1><label>대진 제목<input id="editTitle" maxlength="120" placeholder="비워두면 오늘 날짜와 시간이 제목이 됩니다" value="'+esc(d.title)+'"></label><div class="edit-info">선수 자리는 드롭다운으로 바꿀 수 있어요. 승패 기록과 대진 마감(점수 확정)는 저장한 뒤 대진표 화면에서 합니다. 랜덤 라운드는 승패를 기록하지 않아요.</div><div class="sticky-actions"><button id="changeParticipants">참가자·코트 변경</button><button id="savePost" class="primary">'+(d.version?'대진·승패 저장':'대진 저장')+'</button><button id="cancelEdit">취소</button></div><div id="editMatches">'+scheduleHTML(draft,true,true,editRoster)+'</div></section>';
    $('editTitle').oninput=()=>{draft.title=$('editTitle').value;changed();};
    $('editMatches').onclick=e=>{
      const abs=e.target.closest('[data-absent-name]');
      if(abs){const name=abs.dataset.absentName;const i=draft.absent.indexOf(name);if(i>=0)draft.absent.splice(i,1);else draft.absent.push(name);changed();$('editMatches').innerHTML=scheduleHTML(draft,true,true,editRoster);return;}
      const add=e.target.closest('[data-add-court]');
      if(add){void addBalancedCourt(+add.dataset.addCourt);return;}
      const del=e.target.closest('[data-del-court]');
      if(del){const parts=del.dataset.delCourt.split('-'),ri=+parts[0],mi=+parts[1],r=draft.schedule[ri];if(r.g.length<=1)return alert('한 라운드에는 최소 1개의 대진이 있어야 해요.');if(!confirm((mi+1)+'번 대진을 삭제할까요?'))return;r.g.splice(mi,1);const nr={};for(const k in draft.results){const kp=k.split('-'),kr=+kp[0],km=+kp[1];if(kr!==ri){nr[k]=draft.results[k];continue;}if(km===mi)continue;nr[kr+'-'+(km>mi?km-1:km)]=draft.results[k];}draft.results=nr;scheduleTools.refreshRound(draft,ri);changed();$('editMatches').innerHTML=scheduleHTML(draft,true,true,editRoster);return;}
      const button=e.target.closest('[data-result-key]');if(!button)return;
      draft.results[button.dataset.resultKey]=button.dataset.winner;changed();$('editMatches').innerHTML=scheduleHTML(draft,true,true,editRoster);
    };
    $('editMatches').onchange=e=>{
      const select=e.target;if(!select.matches('select'))return;
      const ri=+select.dataset.r,mi=+select.dataset.m,si=+select.dataset.s,next=select.value;
      try{scheduleTools.replacePlayer(draft,ri,mi,si,next);changed();$('editMatches').innerHTML=scheduleHTML(draft,true,true,editRoster);}
      catch(error){alert(error.message||'선수 자리를 바꾸지 못했어요.');$('editMatches').innerHTML=scheduleHTML(draft,true,true,editRoster);}
    };
    $('changeParticipants').onclick=()=>openPicker(draft);
    $('savePost').onclick=save;
    $('cancelEdit').onclick=cancelEdit;
  }
  function editNotice(d){stopPoll();startDraft(d);app.innerHTML=crumb('notice')+'<section class="panel detail"><h1>'+(d.version?'공지 수정':'공지 쓰기')+'</h1><label>제목<input id="editTitle" maxlength="120" value="'+esc(d.title)+'" placeholder="비워두면 오늘 날짜와 시간"></label><label>내용<textarea id="noticeBody" maxlength="20000">'+esc(d.body)+'</textarea></label><p class="edit-info">줄 앞에 1. 2. 를 붙이면 큰 제목, [소제목]은 작은 제목, ▶ 나 - 로 시작하면 목록으로 보기 좋게 표시됩니다. 🔵 로 시작하면 강조 메모가 됩니다. 🔴 로 시작하면 큰 빨간 제목이 됩니다.</p><div class="sticky-actions"><button id="savePost" class="primary">저장하기</button><button id="cancelEdit">취소</button></div></section>';$('editTitle').oninput=()=>{draft.title=$('editTitle').value;changed();};$('noticeBody').oninput=()=>{draft.body=$('noticeBody').value;changed();};$('savePost').onclick=save;$('cancelEdit').onclick=cancelEdit;}
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
  function applyMatchState(d,matchEl,ri,mi,state){
    if(!matchEl)return;
    matchEl.classList.remove('state-waiting','state-playing','state-finished','state-void');matchEl.classList.add('state-'+state);
    const key=ri+'-'+mi,r=d.schedule[ri],current=matchEl.querySelector('.match-state');
    if(current)current.outerHTML=matchStateControl(d,r,ri,mi,key,state);
  }
  function bindProgressControls(d,token,root=app){root.querySelectorAll('[data-progress-next]').forEach(btn=>btn.onclick=()=>recordProgress(d,btn,token));}
  function currentDetail(id,token){return token===routeToken&&!draft&&location.hash==='#post/'+encodeURIComponent(id);}
  function startDetailPoll(d,token,forceRefresh=false){
    if(!currentDetail(d.id,token))return;
    stopPoll();
    if(d.kind!=='schedule'||d.settledAt)return;
    let pending=false;
    const timer=setInterval(async()=>{
      if(!currentDetail(d.id,token)){clearInterval(timer);if(pollTimer===timer)pollTimer=null;return;}
      if(pending||recordingResult||saving||dialog.open)return;
      pending=true;
      try{
        if(forceRefresh){await detail(d.id,token);return;}
        const fresh=(await api('/api/posts/'+encodeURIComponent(d.id))).data;
        if(currentDetail(d.id,token)&&!recordingResult&&!saving&&(fresh.version!==d.version||Boolean(fresh.settledAt)!==Boolean(d.settledAt)))await detail(d.id,token);
      }catch(e){/* Keep polling after a transient read failure. */}
      finally{pending=false;}
    },5000);
    pollTimer=timer;
  }
  async function refreshDetail(d,token){
    if(!currentDetail(d.id,token))return;
    stopPoll();
    try{await detail(d.id,token);}
    catch(e){if(currentDetail(d.id,token)){message('최신 화면을 불러오지 못했어요. 잠시 후 자동으로 다시 확인합니다.',true);startDetailPoll(d,token,true);}}
  }
  async function recordProgress(d,btn,token){
    if(saving||recordingResult||!currentDetail(d.id,token))return;
    const key=btn.dataset.progressKey,ri=+btn.dataset.progressRound,mi=+btn.dataset.progressMatch,next=btn.dataset.progressNext,matchEl=btn.closest('.match');
    const oldProgress=d.matchProgress?.[key],previous=scheduleTools.matchState(d,ri,mi);
    saving=true;
    d.matchProgress={...(d.matchProgress||{})};if(next==='waiting')delete d.matchProgress[key];else d.matchProgress[key]=next;
    applyMatchState(d,matchEl,ri,mi,next);
    try{
      let resp;
      try{resp=await api('/api/posts/'+encodeURIComponent(d.id)+'/progress',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({key,state:next,version:d.version})});}
      catch(e){
        if(oldProgress===undefined)delete d.matchProgress[key];else d.matchProgress[key]=oldProgress;
        if(currentDetail(d.id,token)){applyMatchState(d,matchEl,ri,mi,previous);bindProgressControls(d,token,matchEl);message(e.message||'대진 진행 상태를 저장하지 못했어요.',true);if(/다른 기기/.test(e.message||''))await refreshDetail(d,token);}
        return;
      }
      if(resp?.data&&typeof resp.data.version==='number')d.version=resp.data.version;
      if(currentDetail(d.id,token))bindProgressControls(d,token,matchEl);
      await refreshDetail(d,token);
    }finally{saving=false;}
  }
  async function recordResult(d,btn,token){
    if(saving||recordingResult||!currentDetail(d.id,token))return;
    const key=btn.dataset.resultKey,winner=btn.dataset.winner,matchEl=btn.closest('.match');
    const prev=d.results?.[key];if(prev===winner)return;
    const [ri,mi]=key.split('-').map(Number),oldProgress=d.matchProgress?.[key];
    recordingResult=true;
    applyWin(matchEl,winner);
    d.results={...(d.results||{}),[key]:winner};
    applyMatchState(d,matchEl,ri,mi,'finished');
    try{
      let resp;
      try{resp=await saveResult(d.id,key,winner);}
      catch(e){
        if(prev)d.results[key]=prev;else delete d.results[key];
        if(oldProgress===undefined)delete d.matchProgress?.[key];else{d.matchProgress=d.matchProgress||{};d.matchProgress[key]=oldProgress;}
        if(currentDetail(d.id,token)){applyWin(matchEl,prev||null);applyMatchState(d,matchEl,ri,mi,scheduleTools.matchState(d,ri,mi));bindProgressControls(d,token,matchEl);message(e.message||'승패를 저장하지 못했어요.',true);if(/다른 기기/.test(e.message||''))await refreshDetail(d,token);}
        return;
      }
      if(resp?.data&&typeof resp.data.version==='number')d.version=resp.data.version;
      delete d.matchProgress?.[key];
      await refreshDetail(d,token);
    }
    finally{recordingResult=false;}
  }
  function applyWin(matchEl,w){if(!matchEl)return;matchEl.classList.remove('result-a','result-b');if(w)matchEl.classList.add('has-result','result-'+w);else matchEl.classList.remove('has-result');const wraps=matchEl.querySelectorAll('.team-wrap');if(wraps[0])wraps[0].classList.toggle('win',w==='a');if(wraps[1])wraps[1].classList.toggle('win',w==='b');matchEl.querySelectorAll('.win-pick').forEach(b=>{const on=b.dataset.winner===w;b.classList.toggle('picked',on);b.setAttribute('aria-pressed',String(on));});if(w){const h=matchEl.querySelector('.match-hint');if(h)h.remove();}}
  async function saveResult(id,key,winner){return api('/api/posts/'+encodeURIComponent(id)+'/result',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({key,winner})});}
  async function endMatch(d,token){
    if(saving||ending||!currentDetail(d.id,token))return;ending=true;
    try{
      if(!(await confirmDialog('정말 이 대진을 마감할까요? 점수가 반영되고, 시드현황의 순위·점수 변동과 출석·승패 표시가 이 대진의 결과로 바뀝니다. (마감 후에도 되돌릴 수 있어요.)')))return;
      if(!currentDetail(d.id,token))return;saving=true;message('점수를 반영하는 중…');
      try{const response=await api('/api/posts/'+encodeURIComponent(d.id)+'/settle',{method:'POST',headers:{'content-type':'application/json','x-kokkiri-editor':EDITOR},body:JSON.stringify({version:d.version,operation:crypto.randomUUID()})});if(Number(response?.data?.version)!==d.version+1)throw Error('최신 대진표를 다시 확인한 뒤 마감을 눌러주세요.');if(!currentDetail(d.id,token))return;message('점수 반영이 완료되었습니다. 시드현황에 새 순위가 반영됩니다.');routeToken++;detail(d.id,routeToken);window.scrollTo(0,0);}
      catch(e){if(currentDetail(d.id,token)){message(e.message,true);if(/다른 기기|최신|충돌/.test(e.message||''))await refreshDetail(d,token);}}
      finally{saving=false;}
    }finally{ending=false;}
  }
  async function unsettlePost(d,token){
    if(saving||unsettling||!currentDetail(d.id,token))return;unsettling=true;
    try{
      if(!(await confirmDialog('이 대진의 마감을 취소할까요? 반영됐던 출석·승패 점수가 되돌려지고, 다시 기록·수정할 수 있게 됩니다.')))return;
      if(!currentDetail(d.id,token))return;saving=true;
      try{const response=await api('/api/posts/'+encodeURIComponent(d.id)+'/unsettle',{method:'POST',headers:{'content-type':'application/json','x-kokkiri-editor':EDITOR},body:JSON.stringify({version:d.version})});if(Number(response?.data?.version)!==d.version+1)throw Error('최신 대진표를 다시 확인한 뒤 마감 취소를 눌러주세요.');if(!currentDetail(d.id,token))return;message('마감을 취소했어요. 다시 기록할 수 있습니다.');routeToken++;detail(d.id,routeToken);window.scrollTo(0,0);}
      catch(e){if(currentDetail(d.id,token)){message(e.message,true);if(/다른 기기|최신|충돌/.test(e.message||''))await refreshDetail(d,token);}}
      finally{saving=false;}
    }finally{unsettling=false;}
  }
  function confirmDialog(msg){return new Promise(resolve=>{let done=false;const onCancel=e=>{e.preventDefault();finish(false);},onClose=()=>finish(false),finish=v=>{if(done)return;done=true;dialog.removeEventListener('cancel',onCancel);dialog.removeEventListener('close',onClose);if(dialog.open)try{dialog.close();}catch(e){}resolve(v);};dialog.innerHTML='<div class="confirm-box"><p class="confirm-msg">'+esc(msg)+'</p><div class="confirm-actions"><button id="confirmNo">아니오</button><button id="confirmYes" class="primary">예</button></div></div>';$('confirmYes').onclick=()=>finish(true);$('confirmNo').onclick=()=>finish(false);dialog.addEventListener('cancel',onCancel);dialog.addEventListener('close',onClose);dialog.showModal();});}
  async function openPicker(existing){
    if(!EDITOR)return;
    const token=routeToken;
    let latestPeople;
    try{latestPeople=await getPeople(true);}catch(e){if(token===routeToken)message(e.message,true);return;}
    if(token!==routeToken)return;
    const pickerPeople=latestPeople.slice();
    const pickerNameOf=p=>pickerPeople.some(q=>q.name===p.name&&q.id!==p.id)?p.name+' ('+(p.type==='member'?'회원':'게스트')+')':p.name;
    if(existing&&Array.isArray(existing.participantIds)&&Array.isArray(existing.names))existing.participantIds.forEach((pid,i)=>{const nm=existing.names[i];if(pid&&typeof nm==='string'&&nm.trim()&&!pickerPeople.some(p=>p.id===pid))pickerPeople.push({id:pid,name:nm,type:'guest',seed:'미정',points:0,adhoc:true});});
    let active='member',selected=new Set(existing?.participantIds?.length?existing.participantIds:pickerPeople.filter(p=>existing?.names.includes(pickerNameOf(p))).map(p=>p.id));
    let methods=Array.isArray(existing?.schedule)?existing.schedule.map(x=>x.method||'random'):Array.from({length:Number(existing?.rounds)||4},()=>'random');
    const lateRounds=Object.assign(Object.create(null),existing?.lateRounds||{});
    const lateRegistration=new Set(Array.isArray(existing?.lateRegistration)?existing.lateRegistration:[]);
    const lateOpen=new Set(Object.keys(lateRounds).concat([...lateRegistration]));
    dialog.innerHTML='<div class="dialog-head"><h2 id="pickerTitle">'+(existing?'참가자·코트 변경':'새 대진 만들기')+'</h2><button id="closePicker" aria-label="닫기">×</button></div><label>대진 제목<input id="newTitle" maxlength="120" value="'+esc(existing?.title||'')+'" placeholder="비워두면 오늘 날짜와 시간이 제목이 됩니다"></label><div class="two"><label>코트 수<input id="courts" type="number" min="1" max="20" value="'+(existing?.courts||3)+'"></label><label>라운드 수<input id="rounds" type="number" min="1" max="20" value="'+(existing?.rounds||4)+'"></label></div><div id="roundMethods" class="round-methods"></div><div class="tabs"><button id="memberTab" aria-pressed="true">회원</button><button id="guestTab" aria-pressed="false">게스트</button></div><label>이름 검색<input id="searchPeople" type="search" placeholder="이름으로 찾기"></label><div class="add-guest"><input id="newGuestName" maxlength="100" placeholder="새로 온 게스트 이름"><button type="button" id="addGuest">추가하기</button></div><p id="selectedCount" aria-live="polite"></p><div class="people-grid picker-list" id="choices"></div><div class="sticky-actions"><button id="selectAll">현재 목록 전체 선택</button><button id="clearAll">전체 선택 해제</button></div><p class="seed-note">라운드마다 매칭 방식을 고르면 시드 점수를 반영해 대진이 만들어집니다. 동일은 휴식·늦참을 뺀 뒤 점수순 4명씩 고정으로 묶고, 동일 라운드 회차마다 1·4 vs 2·3 → 1·3 vs 2·4 → 1·2 vs 3·4 팀 조합을 순환합니다. 동일의 고정 묶음·팀은 중복 후처리로 바꾸지 않습니다. 인접은 휴식·늦참을 뺀 뒤 점수 내림차순 4명씩 박스로 묶고, 한 경기에서 각 박스는 최대 2명만 사용하며 가까운 박스부터 우선 혼합합니다. 인접한 두 박스 8명은 1·2·5·6 / 3·4·7·8 방식으로 섞고, 출전 인원이 4명뿐인 라운드는 다른 박스와 섞지 않고 예외 편성합니다. 인접은 박스·근접 제약을 지키며 파트너 중복을 줄이고, 조건상 남는 팀 동반 반복은 그대로 안내합니다. 휴식·늦참과 랜덤은 바꾸지 않습니다. 늦참 2는 1·2R 제외 후 3R부터 참여합니다. 휴식은 신청늦음→게스트→운영진 각 1회, 이후 일반회원 중 덜 쉰 사람을 무작위로 배정합니다.</p><p id="pickerError" class="login-error" role="alert"></p><button id="generate" class="primary">'+(existing?'선택한 참가자로 대진 다시 만들기':'선택한 참가자로 대진 만들기')+'</button>';
    const visible=()=>pickerPeople.filter(p=>p.type===active&&p.name.includes($('searchPeople').value.trim()));
    const count=()=>{$('selectedCount').textContent='선택 '+selected.size+'명 · 회원 '+pickerPeople.filter(p=>p.type==='member'&&selected.has(p.id)).length+'명 / 게스트 '+pickerPeople.filter(p=>p.type==='guest'&&selected.has(p.id)).length+'명';};
    function render(){for(const type of ['member','guest'])$(type+'Tab').setAttribute('aria-pressed',String(active===type));$('choices').innerHTML=visible().map(p=>{const name=pickerNameOf(p),open=lateOpen.has(name),round=Number(lateRounds[name])||0,registered=lateRegistration.has(name);return '<label class="person"><input type="checkbox" value="'+esc(p.id)+'"'+(selected.has(p.id)?' checked':'')+'><span>'+nameHTML(name)+'</span><small>'+seedHTML(p.seed||'미정')+'</small><button type="button" class="late-btn'+(open?' on':'')+'" data-late-name="'+esc(name)+'" aria-expanded="'+open+'" aria-label="'+esc(name)+' 늦참 설정 '+(open?'접기':'펼치기')+'">늦참'+(round?' '+round+'R 제외':'')+(registered?' · 신청늦음':'')+'</button>'+(open?'<div class="late-options" role="group" aria-label="'+esc(name)+' 늦참 설정"><span>앞 라운드 제외</span>'+[1,2,3,4,5].map(n=>'<button type="button" class="late-round'+(round===n?' on':'')+'" data-late-round="'+n+'" data-late-name="'+esc(name)+'" aria-pressed="'+(round===n)+'" aria-label="'+esc(name)+' 앞 '+n+'라운드 제외">'+n+'</button>').join('')+'<button type="button" class="late-registration'+(registered?' on':'')+'" data-late-registration="'+esc(name)+'" aria-pressed="'+registered+'">신청늦음</button></div>':'')+'</label>';}).join('')||'<p>검색 결과가 없습니다.</p>';count();}
    const methodLabels=[['same','동일'],['balanced','인접'],['random','랜덤']];
    function renderMethods(){
      const n=Math.max(1,Math.min(20,Number($('rounds').value)||1));
      if(methods.length<n)while(methods.length<n)methods.push('random');
      if(methods.length>n)methods=methods.slice(0,n);
      $('roundMethods').innerHTML='<div class="rm-title">라운드별 매칭 방식</div>'+methods.map((mth,i)=>'<div class="rm-row"><span class="rm-round">'+(i+1)+'R</span><div class="rm-opts" role="group" aria-label="'+(i+1)+'라운드 매칭 방식">'+methodLabels.map(([v,l])=>'<button type="button" class="rm-btn'+(mth===v?' on':'')+'" data-r="'+i+'" data-v="'+v+'" aria-pressed="'+(mth===v)+'">'+l+'</button>').join('')+'</div></div>').join('');
    }
    $('choices').onchange=e=>{if(e.target.checked)selected.add(e.target.value);else selected.delete(e.target.value);count();};
    $('choices').addEventListener('click',e=>{const b=e.target.closest('.late-btn');if(b){e.preventDefault();const name=b.dataset.lateName;if(lateOpen.has(name))lateOpen.delete(name);else lateOpen.add(name);render();return;}const num=e.target.closest('[data-late-round]');if(num){e.preventDefault();const name=num.dataset.lateName,n=+num.dataset.lateRound;if((Number(lateRounds[name])||0)===n)delete lateRounds[name];else{lateRounds[name]=n;$('pickerError').textContent=n>=Number($('rounds').value)?'이 참가자는 전체 라운드에 참여하지 않아 출석 점수도 받지 않아요.':'';}render();return;}const reg=e.target.closest('[data-late-registration]');if(reg){e.preventDefault();const name=reg.dataset.lateRegistration;if(lateRegistration.has(name))lateRegistration.delete(name);else lateRegistration.add(name);render();}});
    $('roundMethods').onclick=e=>{const b=e.target.closest('.rm-btn');if(!b)return;methods[+b.dataset.r]=b.dataset.v;renderMethods();};
    $('rounds').oninput=renderMethods;
    $('memberTab').onclick=()=>{active='member';render();};$('guestTab').onclick=()=>{active='guest';render();};$('searchPeople').oninput=render;$('selectAll').onclick=()=>{visible().forEach(p=>selected.add(p.id));render();};$('clearAll').onclick=()=>{selected.clear();render();};$('closePicker').onclick=()=>dialog.close();
    $('addGuest').onclick=()=>{const inp=$('newGuestName'),name=inp.value.trim();if(!name)return alert('게스트 이름을 입력해주세요.');if(pickerPeople.some(p=>p.name===name))return alert('같은 이름이 이미 목록에 있어요. 이름을 다르게 적어주세요.');const g={id:crypto.randomUUID(),name,type:'guest',seed:'미정',points:0,adhoc:true};pickerPeople.push(g);selected.add(g.id);inp.value='';active='guest';$('searchPeople').value='';render();inp.focus();};
    $('newGuestName').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();$('addGuest').click();}};
    let generating=false;
    $('generate').onclick=async()=>{
      if(generating)return;
      const c=Number($('courts').value),r=Number($('rounds').value),picked=pickerPeople.filter(p=>selected.has(p.id));
      if(picked.length<4)return alert('참가자 4명 이상을 선택해주세요.');
      if(!Number.isInteger(c)||c<1||c>20||!Number.isInteger(r)||r<1||r>20)return alert('코트와 라운드는 1~20 사이 정수로 입력해주세요.');
      if(existing&&!confirm('기존 대진 구성을 새로 만듭니다. 저장하기 전까지 게시된 대진은 그대로 유지됩니다. 계속할까요?'))return;
      const button=$('generate'),active=()=>dialog.open&&$('generate')===button&&token===routeToken;
      generating=true;button.disabled=true;const buttonText=button.textContent;button.textContent='최신 점수 확인 중…';
      try{
      const current=new Map((await getPeople(true)).map(p=>[p.id,p]));
      if(!active())return;
      if(picked.length!==selected.size||picked.some(p=>!selected.has(p.id))||c!==Number($('courts').value)||r!==Number($('rounds').value))throw Error('참가자나 코트 설정이 바뀌었습니다. 대진 만들기를 다시 눌러주세요.');
      const roster=picked.map(p=>{const name=pickerNameOf(p),fresh=current.get(p.id);if(!fresh&&!p.adhoc||fresh&&(fresh.name!==p.name||fresh.type!==p.type))throw Error('회원 명단이 변경되었습니다. 참가자 선택창을 다시 열어주세요.');const points=Number((fresh||p).points);if(!Number.isFinite(points))throw Error(name+'님의 시드 점수를 확인해주세요.');return {id:p.id,name,type:p.type,points,operator:fresh?Boolean(fresh.is_operator):OPERATORS.has(p.name),lateRounds:Number(lateRounds[name])||0,lateRegistration:lateRegistration.has(name)};});
      const schedule=scheduleTools.generate(roster,c,r,methods);
      const names=roster.map(x=>x.name),savedLateRounds=Object.fromEntries(roster.filter(x=>x.lateRounds).map(x=>[x.name,x.lateRounds])),savedLateRegistration=roster.filter(x=>x.lateRegistration).map(x=>x.name),d={id:existing?.id||crypto.randomUUID(),kind:'schedule',version:existing?.version||0,title:$('newTitle').value.trim()||stamp(),names,participantIds:picked.map(p=>p.id),courts:c,rounds:r,schedule,lateRounds:savedLateRounds,lateRegistration:savedLateRegistration,results:{},absent:Array.isArray(existing?.absent)?existing.absent:[]};
      dialog.close();editSchedule(d);dirty=true;window.scrollTo(0,0);
      }catch(error){if(active())$('pickerError').textContent=error.message||'최신 점수를 불러오지 못했습니다. 다시 시도해주세요.';}
      finally{generating=false;if($('generate')===button){button.disabled=false;button.textContent=buttonText;}}
    };render();renderMethods();dialog.showModal();
  }
  async function seeds(token){
    let type='member',editing=false;const checked=new Set();
    async function load(){await getPeople(true);const rd=await api('/api/rankings');if(token!==routeToken)return null;return rd;}
    let rankingData=await load();if(!rankingData)return;let ranking=rankingData.items;syncOperators(ranking);
    const ud=(rankingData.updatedDate||'2026-09-10').split('-'),updatedText=(+ud[0])+'년 '+(+ud[1])+'월 '+(+ud[2])+'일';
    function movement(row){if(Number(row.rank_protected)===1)return '<span class="rank-protected">보호적용</span>';const d=Number(row.rank_movement)||0;if(!d)return '<span class="muted">-</span>';return d>0?'<span class="rank-movement">▲ '+d+'</span>':'<span class="rank-down">▼ '+(-d)+'</span>';}
    function pointsMove(row){if(row.previous_points==null||row.previous_points===row.points)return '';const d=row.points-row.previous_points;return d>0?'<span class="pts-delta rank-movement">▲'+d+'</span>':'<span class="pts-delta rank-down">▼'+(-d)+'</span>';}
    function manageButtons(type,id,version){if(!editing)return '';return '<span class="seed-actions"><button type="button" class="person-manage" data-person-action="edit" data-person-type="'+esc(type)+'" data-person-id="'+esc(id)+'" data-person-version="'+esc(version??1)+'">수정</button><button type="button" class="person-manage" data-person-action="history" data-person-type="'+esc(type)+'" data-person-id="'+esc(id)+'">이력</button></span>';}
    function chk(){const ck=$('seedChecked');if(ck)ck.textContent=checked.size?checked.size+'명 선택됨':'';}
    function render(){
      $('seedMembers').setAttribute('aria-pressed',String(type==='member'));$('seedGuests').setAttribute('aria-pressed',String(type==='guest'));
      const promoteBtn=$('seedPromote');if(promoteBtn)promoteBtn.hidden=(type!=='guest');
      const term=$('seedSearch').value.trim();
      const cbHead=editing?'<th></th>':'';
      const cb=id=>editing?'<td><input type="checkbox" class="seed-cb" data-id="'+esc(id)+'"'+(checked.has(id)?' checked':'')+'></td>':'';
      if(type==='member'){
        const list=ranking.filter(row=>row.name.includes(term));$('seedCount').textContent='회원 '+list.length+'명';
        const opBtn=row=>ADMIN?'<button type="button" class="op-toggle'+(row.is_operator?' on':'')+'" data-mid="'+esc(row.member_id)+'" data-on="'+(row.is_operator?1:0)+'">'+(row.is_operator?'운영진 해제':'운영진 임명')+'</button>':'';
        const rows=list.map(row=>'<tr>'+cb(row.member_id)+'<td>'+row.rank+'</td><td>'+movement(row)+'</td><td>'+nameHTML(row.name)+crown(row.name)+opBtn(row)+manageButtons('member',row.member_id,row.edit_version)+'</td><td><span class="seed-badge">'+seedHTML(row.seed)+'</span></td><td><span class="pts-cell">'+row.points+'</span>'+pointsMove(row)+'</td><td>'+row.attendance+'</td><td>'+row.wins+'</td><td>'+row.losses+'</td></tr>').join('');
        $('seedList').innerHTML=rows?'<div class="panel ranking-table-wrap"><table class="ranking-table"><thead><tr>'+cbHead+'<th>순위</th><th>변동</th><th>회원</th><th>시드</th><th>점수</th><th>출석</th><th>승</th><th>패</th></tr></thead><tbody>'+rows+'</tbody></table></div>':'<p>검색 결과가 없습니다.</p>';
      }else{
        const ranked=people.filter(p=>p.type==='guest'&&!p.adhoc).map((p,i)=>({...p,i})).sort((a,b)=>{const ap=Number(a.points)||0,bp=Number(b.points)||0;if(bp!==ap)return bp-ap;if(ap===20){const ag= a.floor_protected_at?1:0,bg=b.floor_protected_at?1:0;if(ag!==bg)return ag-bg;if(ag)return String(a.floor_protected_at).localeCompare(String(b.floor_protected_at));}return a.i-b.i;}).map((p,idx)=>({...p,rank:idx+1}));
        const list=ranked.filter(p=>p.name.includes(term));$('seedCount').textContent='게스트 '+list.length+'명';
        const rows=list.map(p=>'<tr>'+cb(p.id)+'<td>'+p.rank+'</td><td>'+movement(p)+'</td><td>'+nameHTML(p.name)+manageButtons('guest',p.id,p.edit_version)+'</td><td><span class="seed-badge">'+seedHTML(p.seed||'미정')+'</span></td><td><span class="pts-cell">'+(typeof p.points==='number'?p.points:'-')+'</span>'+pointsMove(p)+'</td><td>'+(p.attendance??0)+'</td><td>'+(p.wins??0)+'</td><td>'+(p.losses??0)+'</td></tr>').join('');
        $('seedList').innerHTML=rows?'<p class="seed-note">게스트도 정모 출석 +1, 승 +1, 패 -1로 누적되며, 현재 정보는 DB에서 관리됩니다.</p><div class="panel ranking-table-wrap"><table class="ranking-table"><thead><tr>'+cbHead+'<th>순위</th><th>변동</th><th>게스트</th><th>시드</th><th>점수</th><th>출석</th><th>승</th><th>패</th></tr></thead><tbody>'+rows+'</tbody></table></div>':'<p>검색 결과가 없습니다.</p>';
      }
      chk();
    }
    function paint(){
      const adminPanel=ADMIN?'<div class="admin-panel"><div class="admin-head">홈페이지 관리자</div><p class="admin-note">아래 회원 표에서 <b>운영진 임명/해제</b>로 왕관을 달거나 뗄 수 있어요. 공지·대진·시드 백업은 매주 자동 저장되고 1개월간 보관됩니다.</p><div class="sticky-actions"><button id="backupNow" class="primary">지금 백업</button></div><div id="backupList" class="backup-list">불러오는 중…</div></div>':'';
      app.innerHTML=crumb()+'<div class="bar"><div><h1>시드현황</h1></div>'+(EDITOR?'<button id="seedEdit"'+(editing?' class="primary"':'')+'>'+(editing?'완료':'수정하기')+'</button>':'')+'</div><p class="seed-note"><strong>'+updatedText+' 최신화된 시드현황표입니다</strong><br>정모 출석 +1, 승 +1, 패 -1을 누적해 시드를 자동 계산합니다<br><small>정모 승패 대상 회원만 순위 변동이 표시되고, 최저 20점은 보호될 수 있어요.</small></p>'+adminPanel+(editing?'<div class="sticky-actions"><button id="seedAdd" class="primary">+ 추가하기</button><button id="seedPromote">회원으로 이관</button><button id="seedDelete" class="danger">선택 삭제</button><span class="muted" id="seedChecked"></span></div>':'')+'<div class="tabs"><button id="seedMembers" aria-pressed="true">회원 랭킹</button><button id="seedGuests" aria-pressed="false">게스트</button></div><label>이름 검색<input id="seedSearch" type="search" placeholder="이름으로 찾기"></label><p class="muted" id="seedCount"></p><div id="seedList"></div>';
      $('seedMembers').onclick=()=>{type='member';checked.clear();render();};$('seedGuests').onclick=()=>{type='guest';checked.clear();render();};$('seedSearch').oninput=render;
      if(EDITOR)$('seedEdit').onclick=()=>{editing=!editing;checked.clear();paint();};
      if(ADMIN){$('backupNow').onclick=doBackup;$('backupList').addEventListener('click',e=>{const d=e.target.closest('.backup-dl');if(d)downloadBackup(d.dataset.id);});renderBackups();$('seedList').addEventListener('click',e=>{const t=e.target.closest('.op-toggle');if(t)toggleOperator(t.dataset.mid,t.dataset.on==='1'?0:1);});}
      if(editing){$('seedList').addEventListener('change',e=>{const c=e.target.closest('.seed-cb');if(!c)return;if(c.checked)checked.add(c.dataset.id);else checked.delete(c.dataset.id);chk();});$('seedList').addEventListener('click',e=>{const b=e.target.closest('.person-manage');if(!b)return;const source=(type==='member'?ranking:people).find(p=>(p.member_id||p.id)===b.dataset.personId)||{};const person={type:b.dataset.personType,id:b.dataset.personId,edit_version:Number(b.dataset.personVersion)||1,name:source.name||'',points:Number(source.points)||20};if(b.dataset.personAction==='edit')editPerson(person);else showHistory(person);});$('seedAdd').onclick=addPerson;$('seedDelete').onclick=deleteSelected;$('seedPromote').onclick=promoteSelected;}
      render();
    }
    async function refresh(){people=[];const rd=await load();if(!rd)return;rankingData=rd;ranking=rd.items;checked.clear();paint();}
    async function deleteSelected(){
      if(!checked.size)return alert('삭제할 사람을 체크해주세요.');
      if(!confirm(checked.size+'명을 시드현황에서 삭제할까요? 대진 만들기 목록에서도 빠집니다.'))return;
      try{await api('/api/people/hide',{method:'POST',headers:{'content-type':'application/json','x-kokkiri-editor':EDITOR},body:JSON.stringify({ids:[...checked]})});message('삭제했어요.');await refresh();}catch(e){message(e.message,true);}
    }
    async function promoteSelected(){
      if(type!=='guest')return alert('게스트 탭에서 이관할 게스트를 체크해주세요.');
      if(!checked.size)return alert('회원으로 이관할 게스트를 체크해주세요.');
      if(!confirm(checked.size+'명을 회원으로 이관할까요? 점수·출석·승·패 기록을 그대로 회원 명단으로 옮깁니다.'))return;
      try{await api('/api/people/promote',{method:'POST',headers:{'content-type':'application/json','x-kokkiri-editor':EDITOR},body:JSON.stringify({ids:[...checked]})});message('회원으로 이관했어요.');await refresh();}catch(e){message(e.message,true);}
    }
    async function toggleOperator(mid,on){
      try{await api('/api/operator-role',{method:'POST',headers:{'content-type':'application/json','x-kokkiri-admin':ADMIN},body:JSON.stringify({memberId:mid,on})});message(on?'운영진으로 임명했어요.':'운영진에서 해제했어요.');await refresh();}catch(e){message(e.message,true);}
    }
    async function renderBackups(){
      const box=$('backupList');if(!box)return;
      try{const {items}=await api('/api/backups',{headers:{'x-kokkiri-admin':ADMIN}});
        box.innerHTML=items.length?items.map(b=>'<div class="backup-row"><span>'+esc(date(b.created_at))+' · '+(b.kind==='auto'?'자동':'수동')+' · '+Math.max(1,Math.round((b.size||0)/1024))+'KB</span><button type="button" class="backup-dl" data-id="'+esc(b.id)+'">다운로드</button></div>').join(''):'<p class="muted">아직 저장된 백업이 없어요. \'지금 백업\'을 눌러 만들 수 있어요.</p>';
      }catch(e){box.innerHTML='<p class="muted">'+esc(e.message)+'</p>';}
    }
    async function doBackup(){const b=$('backupNow');if(!b)return;b.disabled=true;b.textContent='백업 중…';try{await api('/api/backups',{method:'POST',headers:{'x-kokkiri-admin':ADMIN}});message('공지·대진·시드를 백업했어요.');await renderBackups();}catch(e){message(e.message,true);}finally{b.disabled=false;b.textContent='지금 백업';}}
    async function downloadBackup(id){try{const r=await fetch('/api/backups/'+encodeURIComponent(id),{headers:{'x-kokkiri-admin':ADMIN}});if(!r.ok)throw Error('백업을 받지 못했어요.');const blob=await r.blob();const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=id+'.json';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);}catch(e){message(e.message,true);}}
    function editPerson(person){
      const kind=person.type==='member'?'회원':'게스트',oldPoints=Number(person.points)||20;
      dialog.innerHTML='<form id="personEditForm"><div class="dialog-head"><h2 id="pickerTitle">'+kind+' 정보 수정</h2><button type="button" id="closePersonEdit" aria-label="닫기">×</button></div><p class="edit-info">현재 이름과 점수만 수정합니다. 기존 대진표의 이름과 과거 정산 기록은 그대로 보존됩니다.</p><label>닉네임<input id="personEditName" maxlength="100" value="'+esc(person.name)+'" required></label><label>시드 점수<input id="personEditPoints" type="number" min="20" max="1000" value="'+oldPoints+'" required></label><label>수정 사유 <span class="muted">(필수)</span><textarea id="personEditReason" maxlength="300" placeholder="예: 최신 시드 관리표 반영" required></textarea></label><p id="personEditError" class="login-error" role="alert"></p><div class="sticky-actions"><button type="submit" id="personEditSubmit" class="primary">저장</button><button type="button" id="cancelPersonEdit">취소</button></div></form>';
      let working=false;
      const form=$('personEditForm'),nameInput=$('personEditName'),pointsInput=$('personEditPoints'),reasonInput=$('personEditReason'),submit=$('personEditSubmit'),errorOutput=$('personEditError');
      const active=()=>dialog.open&&dialog.querySelector('#personEditForm')===form;
      const close=()=>{if(!working)dialog.close();};$('closePersonEdit').onclick=close;$('cancelPersonEdit').onclick=close;
      dialog.oncancel=e=>{if(working)e.preventDefault();};
      form.onsubmit=async e=>{e.preventDefault();if(working)return;const name=nameInput.value.trim(),points=Number(pointsInput.value),reason=reasonInput.value.trim();if(!name||!Number.isInteger(points)||points<20||points>1000||!reason){errorOutput.textContent='이름·점수·수정 사유를 모두 확인해주세요.';return;}working=true;submit.disabled=true;submit.textContent='저장 중…';errorOutput.textContent='';try{await api('/api/people/update',{method:'POST',headers:{'content-type':'application/json','x-kokkiri-editor':EDITOR},body:JSON.stringify({id:person.id,type:person.type,name,points,reason,expectedVersion:person.edit_version})});if(!active())return;working=false;dialog.oncancel=null;dialog.close();message(name+' 정보를 수정했어요.');await refresh();}catch(error){if(active()){errorOutput.textContent=error.message;working=false;submit.disabled=false;submit.textContent='저장';}}};
      dialog.showModal();nameInput.focus();nameInput.select();
    }
    async function showHistory(person){
      const kind=person.type==='member'?'회원':'게스트';
      dialog.innerHTML='<div class="dialog-head"><h2 id="pickerTitle">'+esc(person.name)+' · 변경 이력</h2><button type="button" id="closePersonHistory" aria-label="닫기">×</button></div><p class="muted">운영진만 볼 수 있는 기록입니다.</p><div id="personHistoryBody"><p>불러오는 중…</p></div><div class="sticky-actions"><button type="button" id="cancelPersonHistory">닫기</button></div>';
      const historyBody=$('personHistoryBody');
      const active=()=>dialog.open&&dialog.querySelector('#personHistoryBody')===historyBody;
      $('closePersonHistory').onclick=()=>dialog.close();$('cancelPersonHistory').onclick=()=>dialog.close();dialog.showModal();
      try{const {items}=await api('/api/people/history?type='+encodeURIComponent(person.type)+'&id='+encodeURIComponent(person.id),{headers:{'x-kokkiri-editor':EDITOR}});if(!active())return;const actionName={create:'추가',update:'수정',hide:'숨김',promote:'회원 이관'};const body=items.length?'<ul class="history-list">'+items.map(h=>{const names=h.before_name&&h.after_name&&h.before_name!==h.after_name?esc(h.before_name)+' → '+esc(h.after_name):esc(h.after_name||h.before_name||'-');const pts=h.before_points!=null&&h.after_points!=null&&h.before_points!==h.after_points?' · '+h.before_points+'점 → '+h.after_points+'점':'';return '<li><span class="history-meta">'+esc(date(h.created_at))+' · '+esc(actionName[h.action]||h.action)+'</span><span>'+names+pts+'</span><span class="history-reason">사유: '+esc(h.reason)+'</span></li>';}).join('')+'</ul>':'<p class="muted">아직 기록이 없습니다.</p>';historyBody.innerHTML=body;}catch(error){if(active())historyBody.innerHTML='<p class="login-error" role="alert">'+esc(error.message)+'</p>';}
    }
    function addPerson(){
      dialog.innerHTML='<div class="dialog-head"><h2 id="pickerTitle">사람 추가</h2><button id="closeAdd" aria-label="닫기">×</button></div><label>닉네임<input id="addName" maxlength="100" placeholder="닉네임"></label><label>시드 점수<input id="addPoints" type="number" min="20" max="1000" placeholder="예: 90"></label><div class="tabs"><button type="button" id="addTypeM" aria-pressed="true">회원</button><button type="button" id="addTypeG" aria-pressed="false">게스트</button></div><button id="addConfirm" class="primary">확인</button>';
      let atype='member',working=false;
      const nameInput=$('addName'),pointsInput=$('addPoints'),submit=$('addConfirm');
      const active=()=>dialog.open&&dialog.querySelector('#addConfirm')===submit;
      const setType=t=>{atype=t;$('addTypeM').setAttribute('aria-pressed',String(t==='member'));$('addTypeG').setAttribute('aria-pressed',String(t==='guest'));};
      const close=()=>{if(!working)dialog.close();};
      $('addTypeM').onclick=()=>setType('member');$('addTypeG').onclick=()=>setType('guest');$('closeAdd').onclick=close;dialog.oncancel=e=>{if(working)e.preventDefault();};
      submit.onclick=async()=>{if(working)return;const name=nameInput.value.trim(),points=Number(pointsInput.value);if(!name)return alert('닉네임을 입력해주세요.');if(!Number.isInteger(points)||points<20||points>1000)return alert('시드 점수는 20~1000 사이 숫자로 입력해주세요.');working=true;submit.disabled=true;submit.textContent='추가 중…';try{await api('/api/people',{method:'POST',headers:{'content-type':'application/json','x-kokkiri-editor':EDITOR},body:JSON.stringify({name,type:atype,points})});if(!active())return;working=false;dialog.oncancel=null;dialog.close();type=atype;message(name+' 추가했어요.');await refresh();}catch(e){if(active()){message(e.message,true);working=false;submit.disabled=false;submit.textContent='확인';}}};
      dialog.showModal();
    }
    paint();
  }
  async function route(){
    const token=++routeToken,hash=location.hash||'#home';lastHash=hash;draft=null;viewRound=1;stopPoll();app.innerHTML='<p class="empty">불러오는 중…</p>';
    try{if(hash==='#schedule'||hash==='#notice')await board(hash.slice(1),token);else if(hash==='#seed')await seeds(token);else if(hash==='#live'&&liveView)await liveView.open(token);else if(hash.startsWith('#post/')){let id=hash.slice(6);try{id=decodeURIComponent(id);}catch(e){}await detail(id,token);}else home();}catch(e){if(token===routeToken){app.innerHTML=crumb()+'<div class="panel error-box">'+esc(e.message)+'<p><button id="retry">다시 시도</button></p></div>';$('retry').onclick=route;}}
  }
  window.addEventListener('hashchange',()=>{if(saving){history.replaceState(null,'',lastHash);return;}if(dirty&&!confirm('저장하지 않은 변경 내용이 있습니다. 이동할까요?')){history.replaceState(null,'',lastHash);return;}dirty=false;dialog.close();route();window.scrollTo(0,0);});
  document.addEventListener('click',e=>{const a=e.target.closest('a');if(a&&draft&&a.getAttribute('href')===(location.hash||'#home')){e.preventDefault();if(saving)return;if(dirty&&!confirm('저장하지 않은 변경 내용이 있습니다. 이동할까요?'))return;dirty=false;route();}});
  window.addEventListener('beforeunload',e=>{if(dirty||saving){e.preventDefault();e.returnValue='';}});
  route();
}
