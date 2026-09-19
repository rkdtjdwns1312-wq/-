const iso=value=>{const d=new Date(value);return Number.isNaN(d.getTime())?null:d;};
const num=value=>value==null?null:(Number.isFinite(Number(value))?Number(value):null);

export function scoreHistoryModel(data){
  const range=data?.range||{},from=iso(range.from),to=iso(range.to);
  const points=(Array.isArray(data?.points)?data.points:[]).filter(p=>iso(p?.at)&&num(p?.points)!==null).sort((a,b)=>String(a.at).localeCompare(String(b.at)));
  return {from,to,points,carry:data?.carry&&num(data.carry.points)!==null?data.carry:null,hasOlder:Boolean(data?.hasOlder),nextBefore:typeof data?.nextBefore==='string'?data.nextBefore:'',recordedFrom:typeof data?.recordedFrom==='string'?data.recordedFrom:''};
}

export function createScoreHistory({dialog,api,esc=s=>String(s),isAllowed=()=>true,notify=()=>{}}={}){
  // boards.js embeds this factory with toString(), so every runtime helper stays inside it.
  const DAY=86400000;
  const sourceLabel={initial:'처음 기록',settlement:'정모 정산',manual:'수동 수정',snapshot:'보관 기록',change:'점수 변경',current:'현재 점수',baseline:'기준 점수'};
  const iso=value=>{const d=new Date(value);return Number.isNaN(d.getTime())?null:d;};
  const dateKst=value=>new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'long',day:'numeric'}).format(new Date(value));
  const stampKst=value=>new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(value));
  const num=value=>value==null?null:(Number.isFinite(Number(value))?Number(value):null);
  const model=data=>{const range=data?.range||{},from=iso(range.from),to=iso(range.to),points=(Array.isArray(data?.points)?data.points:[]).filter(p=>iso(p?.at)&&num(p?.points)!==null).sort((a,b)=>String(a.at).localeCompare(String(b.at)));return {from,to,points,carry:data?.carry&&num(data.carry.points)!==null?data.carry:null,hasOlder:Boolean(data?.hasOlder),nextBefore:typeof data?.nextBefore==='string'?data.nextBefore:'',recordedFrom:typeof data?.recordedFrom==='string'?data.recordedFrom:''};};
  let stopped=false,request=0,owner=0,state=null,selected=null,loadingOlder=false,chartWidth=600,resizeObserver=null,observedScroller=null;
  const safe=value=>esc(String(value??''));
  const current=()=>!stopped&&dialog?.open&&dialog.querySelector?.('[data-score-history-owner="'+owner+'"]');
  function closeOwned(){if(!current())return;request++;state=null;selected=null;loadingOlder=false;resizeObserver?.disconnect();resizeObserver=null;observedScroller=null;dialog.close?.();}
  const kindLabel=kind=>sourceLabel[kind]||'점수 기록';
  const pointText=p=>{const before=num(p.before),after=num(p.points),delta=before===null?'변동 기준 없음':(after-before>0?'+'+(after-before):String(after-before));return stampKst(p.at)+' · '+after+'점 · '+(before===null?delta:delta+'점')+' · '+kindLabel(p.kind);};
  function domain(){
    const values=state.segments.flatMap(segment=>[...segment.points.map(p=>num(p.points)),num(segment.carry?.points)]).filter(value=>value!==null);
    const lo=Math.min(...values),hi=Math.max(...values),pad=Math.max(1,Math.ceil((hi-lo)*.12));
    return {min:lo-pad,max:hi+pad};
  }
  const position=()=>{const node=dialog?.querySelector?.('.score-history-scroll');return node?{left:node.scrollLeft||0,width:node.scrollWidth||0,viewport:node.clientWidth||chartWidth}:null;};
  function chart(segment,index,scale,width){
    const from=segment.from?.getTime(),to=segment.to?.getTime(),span=Math.max(1,(to||0)-(from||0));
    const values=[...segment.points.map(p=>num(p.points)),num(segment.carry?.points)].filter(v=>v!==null);
    if(!values.length)return '<section class="score-history-segment" data-score-history-segment="'+index+'"><h3>'+safe(dateKst(segment.from))+' ~ '+safe(dateKst(segment.to))+'</h3><p class="score-history-empty">이 기간에 표시할 점수 기록이 없습니다.</p></section>';
    const {min,max}=scale,left=38,right=Math.max(left+120,width-12),top=25,bottom=170;
    const x=p=>left+Math.max(0,Math.min(1,(iso(p.at).getTime()-from)/span))*(right-left);
    const y=v=>top+(max-v)/(max-min)*(bottom-top);
    const tickDays=width<390?[0,47,93,140]:[0,28,56,84,112,140];
    const ticks=tickDays.map(days=>{const px=left+days/140*(right-left),at=new Date(from+days*DAY),anchor=days===0?'start':days===140?'end':'middle';return '<line class="score-history-grid" x1="'+px+'" y1="'+top+'" x2="'+px+'" y2="'+bottom+'"/><text class="score-history-axis-label" x="'+px+'" y="205" text-anchor="'+anchor+'">'+safe(new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric'}).format(at))+'</text>';}).join('');
    let path='',lastValue=null;if(segment.carry){lastValue=num(segment.carry.points);path+='M '+left+' '+y(lastValue)+' ';}for(const p of segment.points){lastValue=num(p.points);path+=(path?'L ':'M ')+x(p)+' '+y(lastValue)+' ';}if(lastValue!==null)path+='L '+right+' '+y(lastValue)+' ';
    const dots=segment.points.map((p,i)=>'<circle class="score-history-point'+(selected?.id===p.id?' selected':'')+'" data-score-history-point="'+safe(p.id)+'" data-score-history-segment="'+index+'" cx="'+x(p)+'" cy="'+y(num(p.points))+'" r="6" tabindex="0" role="button" aria-label="'+safe(pointText(p))+'"/>').join('');
    const labels='<text class="score-history-axis-label" x="'+(left-5)+'" y="'+(top+4)+'" text-anchor="end">'+max+'</text><text class="score-history-axis-label" x="'+(left-5)+'" y="'+bottom+'" text-anchor="end">'+min+'</text>';
    return '<section class="score-history-segment" data-score-history-segment="'+index+'"><h3>'+safe(dateKst(segment.from))+' ~ '+safe(dateKst(segment.to))+'</h3><svg class="score-history-svg" viewBox="0 0 '+width+' 225" preserveAspectRatio="xMinYMin meet" role="img" aria-label="점수 변화 그래프">'+ticks+labels+(path?'<path class="score-history-line" d="'+path+'"/>':'')+dots+'</svg></section>';
  }
  function draw(savedPosition=null){
    if(!current()||!state)return;
    const detailsOpen=Boolean(dialog.querySelector('.score-history-details')?.open);
    const restore=savedPosition||null,person=state.person||{},all=state.segments.flatMap(s=>s.points),carried=state.segments.filter(s=>s.carry).map(s=>s.carry),scale=domain();
    const popup=selected?'<div class="score-history-popup" role="status">'+safe(pointText(selected))+'</div>':'<div class="score-history-popup" role="status">그래프의 점을 누르면 해당 기록을 볼 수 있어요.</div>';
    const noData=!all.length&&!carried.length?'<p class="score-history-empty">표시할 점수 기록이 없습니다.</p>':'';
    const note=state.recordedFrom?'<p class="score-history-note">보관된 기록부터 표시합니다. 없는 과거 기록은 복원할 수 없습니다.</p>':'';
    const carriedText=carried.map(p=>'<li>구간 시작 기준 '+safe(num(p.points))+'점</li>').join('');
    dialog.innerHTML='<div data-score-history-owner="'+owner+'" class="score-history-dialog"><div class="dialog-head"><h2 id="pickerTitle">'+safe(person.name||'점수')+' · 점수 변화</h2><button type="button" data-score-history-close aria-label="닫기">×</button></div><p class="score-history-summary">최근 20주 점수 변화를 확인합니다.</p>'+popup+noData+'<div class="score-history-scroll" tabindex="0" aria-label="점수 변화 기간. 왼쪽으로 이동하면 이전 20주 기록을 불러옵니다."><div class="score-history-track">'+state.segments.map((segment,index)=>chart(segment,index,scale,chartWidth)).join('')+'</div></div>'+note+'<details class="score-history-details"'+(detailsOpen?' open':'')+'><summary>기록을 글로 보기</summary><ul>'+carriedText+all.map(p=>'<li>'+safe(pointText(p))+'</li>').join('')+'</ul></details><div class="score-history-actions"><button type="button" data-score-history-older'+(!state.hasOlder||loadingOlder?' disabled':'')+'>이전 20주 보기</button><button type="button" class="score-history-return" data-score-history-return>최근 20주로</button><button type="button" data-score-history-close>닫기</button></div></div>';
    const root=current();if(!root)return;
    const freshScroller=dialog.querySelector('.score-history-scroll');
    const olderButton=root.querySelector('[data-score-history-older]');
    const syncNavigation=()=>{olderButton.disabled=loadingOlder||(!state.hasOlder&&freshScroller.scrollLeft<=24);};
    root.querySelectorAll('[data-score-history-close]').forEach(b=>b.onclick=closeOwned);
    root.querySelector('[data-score-history-return]').onclick=()=>{freshScroller.scrollLeft=Math.max(0,freshScroller.scrollWidth-freshScroller.clientWidth);syncNavigation();};
    olderButton.onclick=()=>{const viewport=freshScroller.clientWidth||chartWidth;if(freshScroller.scrollLeft>24){freshScroller.scrollLeft=Math.max(0,freshScroller.scrollLeft-viewport);syncNavigation();}else loadOlder(null);};
    const choose=e=>{const node=e.target.closest?.('[data-score-history-point]');if(!node)return;const segment=state.segments[Number(node.dataset.scoreHistorySegment)],point=segment?.points.find(p=>String(p.id)===node.dataset.scoreHistoryPoint);if(point){selected=point;draw(position());}};
    root.addEventListener('click',choose);root.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.matches?.('[data-score-history-point]')){e.preventDefault();choose(e);}});
    let armed=true,touchX=null;const olderAtLeft=()=>{syncNavigation();if(armed&&freshScroller.scrollLeft<=24){armed=false;loadOlder(position());}};
    freshScroller.addEventListener('scroll',olderAtLeft);freshScroller.addEventListener('wheel',event=>{if(freshScroller.scrollLeft<=24&&(event.deltaX<0||(event.shiftKey&&event.deltaY<0))){event.preventDefault?.();olderAtLeft();}});freshScroller.addEventListener('touchstart',event=>{touchX=event.touches?.[0]?.clientX??null;},{passive:true});freshScroller.addEventListener('touchend',event=>{const end=event.changedTouches?.[0]?.clientX;if(touchX!==null&&end>touchX+20)olderAtLeft();touchX=null;},{passive:true});
    const measured=Math.max(240,Math.round(freshScroller.clientWidth||freshScroller.getBoundingClientRect?.().width||chartWidth));
    if(measured!==chartWidth){chartWidth=measured;queueMicrotask(()=>{if(current()&&dialog.querySelector('.score-history-scroll')===freshScroller)draw(restore||position());});}
    if(typeof ResizeObserver==='function'&&observedScroller!==freshScroller){resizeObserver?.disconnect();observedScroller=freshScroller;resizeObserver=new ResizeObserver(()=>{if(!current()||dialog.querySelector('.score-history-scroll')!==freshScroller)return;const width=Math.max(240,Math.round(freshScroller.clientWidth||freshScroller.getBoundingClientRect?.().width||chartWidth));if(width!==chartWidth){chartWidth=width;draw(position());}});resizeObserver.observe(freshScroller);}
    syncNavigation();
    if(restore)queueMicrotask(()=>{const node=dialog.querySelector('.score-history-scroll');if(current()&&node===freshScroller){const oldViewport=restore.viewport||node.clientWidth,newViewport=node.clientWidth||oldViewport;node.scrollLeft=(restore.left/oldViewport+Math.max(0,node.scrollWidth/newViewport-restore.width/oldViewport))*newViewport;syncNavigation();}});
  }
  async function loadOlder(savedPosition=position()){
    if(loadingOlder||!state?.hasOlder||!state.nextBefore||!current())return;
    loadingOlder=true;const token=++request;
    try{const data=await api('/api/people/points-history?type='+encodeURIComponent(state.type)+'&id='+encodeURIComponent(state.id)+'&before='+encodeURIComponent(state.nextBefore));if(token!==request||!current()||!isAllowed())return;const next=model(data);state.segments.unshift(next);state.hasOlder=next.hasOlder;state.nextBefore=next.nextBefore;state.recordedFrom=state.recordedFrom||next.recordedFrom;}
    catch(error){if(token===request&&current())notify(error?.message||'점수 기록을 불러오지 못했습니다.',true);}
    finally{if(token===request){loadingOlder=false;if(current())draw(savedPosition);}}
  }
  function loadingMarkup(text,error=false){return '<div data-score-history-owner="'+owner+'" class="score-history-dialog"><div class="dialog-head"><h2 id="pickerTitle">점수 변화</h2><button type="button" data-score-history-close aria-label="닫기">×</button></div><p class="score-history-empty"'+(error?' role="alert"':'')+'>'+safe(text)+'</p><div class="sticky-actions"><button type="button" data-score-history-close>닫기</button></div></div>';}
  function bindLoadingClose(){dialog.querySelectorAll?.('[data-score-history-close]').forEach(button=>button.onclick=closeOwned);}
  async function open(type,id){
    if(!isAllowed()){notify('회원권한이 필요합니다.',true);return;}
    if(type!=='member'&&type!=='guest')return;
    stopped=false;state=null;selected=null;loadingOlder=false;chartWidth=600;resizeObserver?.disconnect();resizeObserver=null;observedScroller=null;const token=++request;owner++;const myOwner=owner;
    dialog.innerHTML=loadingMarkup('점수 기록을 불러오는 중…');dialog.showModal?.();bindLoadingClose();
    try{const data=await api('/api/people/points-history?type='+encodeURIComponent(type)+'&id='+encodeURIComponent(id));if(token!==request||owner!==myOwner||!current()||!isAllowed())return;const first=model(data);state={type,id,person:data?.person||{},segments:[first],hasOlder:first.hasOlder,nextBefore:first.nextBefore,recordedFrom:first.recordedFrom};draw();}
    catch(error){if(token===request&&owner===myOwner&&current()){dialog.innerHTML=loadingMarkup(error?.message||'점수 기록을 불러오지 못했습니다.',true);bindLoadingClose();}}
  }
  function stop(){const owns=dialog?.open&&dialog.querySelector?.('[data-score-history-owner="'+owner+'"]');stopped=true;request++;state=null;selected=null;loadingOlder=false;resizeObserver?.disconnect();resizeObserver=null;observedScroller=null;if(owns){dialog.close?.();dialog.innerHTML='';}}
  return {open,stop};
}
