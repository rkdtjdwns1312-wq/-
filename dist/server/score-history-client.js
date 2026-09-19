const iso=value=>{const d=new Date(value);return Number.isNaN(d.getTime())?null:d;};
const num=value=>value==null?null:(Number.isFinite(Number(value))?Number(value):null);

export function scoreHistoryModel(data){
  const range=data?.range||{},from=iso(range.from),to=iso(range.to);
  const valid=p=>typeof p?.id==='string'&&p.id.length>0&&p.kind==='settlement'&&iso(p.at)&&num(p.points)!==null;
  const points=(Array.isArray(data?.points)?data.points:[]).filter(valid).sort((a,b)=>String(a.at).localeCompare(String(b.at))||String(a.id).localeCompare(String(b.id)));
  return {from,to,points,carry:valid(data?.carry)?data.carry:null,hasOlder:Boolean(data?.hasOlder),nextBefore:typeof data?.nextBefore==='string'?data.nextBefore:'',recordedFrom:typeof data?.recordedFrom==='string'&&iso(data.recordedFrom)?data.recordedFrom:''};
}

export function createScoreHistory({dialog,api,esc=s=>String(s),isAllowed=()=>true,notify=()=>{}}={}){
  // boards.js embeds this factory with toString(), so every runtime helper stays inside it.
  const DAY=86400000;
  const sourceLabel={settlement:'대진 마감'};
  const iso=value=>{const d=new Date(value);return Number.isNaN(d.getTime())?null:d;};
  const dateKst=value=>new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'long',day:'numeric'}).format(new Date(value));
  const stampKst=value=>new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(value));
  const kstDateParts=value=>{const date=iso(value);if(!date)return null;const part=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date),get=type=>Number(part.find(item=>item.type===type)?.value);return {year:get('year'),month:get('month'),day:get('day')};};
  const kstDay=value=>{const part=kstDateParts(value);return part?new Date(Date.UTC(part.year,part.month-1,part.day)-9*60*60*1000):null;};
  const dateMd=value=>{const part=kstDateParts(value);return part?part.month+'/'+part.day:'';};
  const num=value=>value==null?null:(Number.isFinite(Number(value))?Number(value):null);
  const model=data=>{const range=data?.range||{},from=iso(range.from),to=iso(range.to),valid=p=>typeof p?.id==='string'&&p.id.length>0&&p.kind==='settlement'&&iso(p.at)&&num(p.points)!==null,points=(Array.isArray(data?.points)?data.points:[]).filter(valid).sort((a,b)=>String(a.at).localeCompare(String(b.at))||String(a.id).localeCompare(String(b.id)));return {from,to,points,carry:valid(data?.carry)?data.carry:null,hasOlder:Boolean(data?.hasOlder),nextBefore:typeof data?.nextBefore==='string'?data.nextBefore:'',recordedFrom:typeof data?.recordedFrom==='string'&&iso(data.recordedFrom)?data.recordedFrom:''};};
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
  function visibleRange(segment){
    const recorded=kstDay(segment.recordedFrom||state?.recordedFrom),from=segment.from,to=segment.to;
    const actualFrom=recorded&&from&&recorded>from&&recorded<to?recorded:from;
    return {from:actualFrom||from,to,recorded,partial:Boolean(actualFrom&&from&&actualFrom>from)};
  }
  function weeklyTicks(range,width,left,right){
    const from=range.from?.getTime(),to=range.to?.getTime(),anchor=range.partial?range.from:range.recorded;
    if(!from||!to||!anchor)return [];
    const first=range.partial?anchor.getTime():anchor.getTime()+Math.max(0,Math.ceil((from-anchor.getTime())/(7*DAY)))*7*DAY;
    const ticks=[];for(let at=first;at<to&&ticks.length<20;at+=7*DAY)if(at>=from)ticks.push(at);
    const spacing=(right-left)/Math.max(1,ticks.length),labelMode=spacing<20?'vertical':spacing<42?'angled':'horizontal',fontSize=labelMode==='vertical'?(spacing<14?8:spacing<17?9:10):10;
    return ticks.map(at=>({at,px:left+(at-from)/Math.max(1,to-from)*(right-left),labelMode,fontSize}));
  }
  function chart(segment,index,scale,width){
    const range=visibleRange(segment),from=range.from?.getTime(),to=range.to?.getTime(),span=Math.max(1,(to||0)-(from||0));
    const values=[...segment.points.map(p=>num(p.points)),num(segment.carry?.points)].filter(v=>v!==null);
    const {min,max}=scale||{min:0,max:1},left=38,right=Math.max(left+120,width-12),top=25,bottom=158;
    const x=p=>left+Math.max(0,Math.min(1,(iso(p.at).getTime()-from)/span))*(right-left);
    const y=v=>top+(max-v)/(max-min)*(bottom-top);
    const ticks=weeklyTicks(range,width,left,right).map((tick,i,all)=>{const vertical=tick.labelMode==='vertical',anchor=vertical?'end':i===0?'start':i===all.length-1?'end':'middle',y=vertical?180:184,rotate=vertical?' transform="rotate(-90 '+tick.px+' '+y+')"':tick.labelMode==='angled'?' transform="rotate(-55 '+tick.px+' '+y+')"':'';return '<line class="score-history-grid" x1="'+tick.px+'" y1="'+top+'" x2="'+tick.px+'" y2="'+bottom+'"/><text class="score-history-axis-label score-history-week-label'+(vertical?' score-history-week-label-vertical':'')+'" x="'+tick.px+'" y="'+y+'" text-anchor="'+anchor+'" style="font-size:'+tick.fontSize+'px !important"'+rotate+'>'+safe(dateMd(tick.at))+'</text>';}).join('');
    let path='',lastValue=null;if(segment.carry){lastValue=num(segment.carry.points);path+='M '+left+' '+y(lastValue)+' ';}for(const p of segment.points){lastValue=num(p.points);path+=(path?'L ':'M ')+x(p)+' '+y(lastValue)+' ';}if(segment.carry&&!segment.points.length)path+='L '+right+' '+y(lastValue)+' ';
    const dots=segment.points.map((p,i)=>'<circle class="score-history-point'+(selected?.id===p.id?' selected':'')+'" data-score-history-point="'+safe(p.id)+'" data-score-history-segment="'+index+'" cx="'+x(p)+'" cy="'+y(num(p.points))+'" r="6" tabindex="0" role="button" aria-label="'+safe(pointText(p))+'"/>').join('');
    const labels=values.length?'<text class="score-history-axis-label" x="'+(left-5)+'" y="'+(top+4)+'" text-anchor="end">'+max+'</text><text class="score-history-axis-label" x="'+(left-5)+'" y="'+bottom+'" text-anchor="end">'+min+'</text>':'';
    const empty=values.length?'':'<text class="score-history-empty-label" x="'+((left+right)/2)+'" y="'+((top+bottom)/2)+'" text-anchor="middle">이 기간에 점수 기록이 없습니다.</text>';
    return '<section class="score-history-segment" data-score-history-segment="'+index+'"><h3>'+safe(dateKst(range.from))+' ~ '+safe(dateKst(segment.to))+'</h3><svg class="score-history-svg" viewBox="0 0 '+width+' 225" preserveAspectRatio="xMinYMin meet" role="img" aria-label="점수 변화 그래프">'+ticks+labels+empty+(path?'<path class="score-history-line" d="'+path+'"/>':'')+dots+'</svg></section>';
  }
  function draw(savedPosition=null){
    if(!current()||!state)return;
    const detailsOpen=Boolean(dialog.querySelector('.score-history-details')?.open);
    const restore=savedPosition||null,person=state.person||{},all=state.segments.flatMap(s=>s.points),carried=state.segments.filter(s=>s.carry).map(s=>s.carry),hasSettlements=Boolean(state.recordedFrom&&(all.length||carried.length)),scale=(all.length||carried.length)?domain():null,latest=state.segments[state.segments.length-1],latestRange=latest&&visibleRange(latest);
    const popup=selected?'<div class="score-history-popup" role="status">'+safe(pointText(selected))+'</div>':'<div class="score-history-popup" role="status">그래프의 점을 누르면 해당 기록을 볼 수 있어요.</div>';
    const currentScore=num(person.points),currentText=currentScore===null?'':'<p class="score-history-note">현재 점수: '+safe(currentScore)+'점 · 수동 조정 등으로 마지막 대진 마감 점수와 다를 수 있습니다.</p>';
    const noData=hasSettlements?'':'<p class="score-history-empty">아직 대진 마감 기록이 없습니다.</p>';
    const note=hasSettlements?'<p class="score-history-note">점은 실제 대진 마감 결과입니다. 조회·수동 조정 시각은 점으로 표시하지 않습니다.</p>':'';
    const summary=hasSettlements?(latestRange?.partial?'첫 대진 마감부터 누적 중인 실제 기간을 표시합니다.':'최근 20주 대진 마감 결과를 확인합니다.'):'대진을 마감하면 그 결과부터 점수 변화를 확인할 수 있어요.';
    const carriedText=carried.map(p=>'<li>이전 구간 대진 마감 결과 · '+safe(num(p.points))+'점</li>').join('');
    const graph=hasSettlements?'<div class="score-history-scroll" tabindex="0" aria-label="대진 마감 결과 기간. 왼쪽으로 이동하면 이전 20주 기록을 불러옵니다."><div class="score-history-track">'+state.segments.map((segment,index)=>chart(segment,index,scale,chartWidth)).join('')+'</div></div>'+note+'<details class="score-history-details"'+(detailsOpen?' open':'')+'><summary>기록을 글로 보기</summary><ul>'+carriedText+all.map(p=>'<li>'+safe(pointText(p))+'</li>').join('')+'</ul></details>':'';
    const navigation=hasSettlements?'<button type="button" data-score-history-older'+(!state.hasOlder||loadingOlder?' disabled':'')+'>이전 20주 보기</button><button type="button" class="score-history-return" data-score-history-return>최근 20주로</button>':'';
    dialog.innerHTML='<div data-score-history-owner="'+owner+'" class="score-history-dialog"><div class="dialog-head"><h2 id="pickerTitle">'+safe(person.name||'점수')+' · 점수 변화</h2><button type="button" data-score-history-close aria-label="닫기">×</button></div><p class="score-history-summary">'+summary+'</p>'+currentText+(hasSettlements?popup:'')+noData+graph+'<div class="score-history-actions">'+navigation+'<button type="button" data-score-history-close>닫기</button></div></div>';
    const root=current();if(!root)return;
    root.querySelectorAll('[data-score-history-close]').forEach(b=>b.onclick=closeOwned);
    const freshScroller=dialog.querySelector('.score-history-scroll');
    if(!freshScroller)return;
    const olderButton=root.querySelector('[data-score-history-older]');
    const syncNavigation=()=>{olderButton.disabled=loadingOlder||(!state.hasOlder&&freshScroller.scrollLeft<=24);};
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
    try{const data=await api('/api/people/points-history?type='+encodeURIComponent(state.type)+'&id='+encodeURIComponent(state.id)+'&before='+encodeURIComponent(state.nextBefore));if(token!==request||!current()||!isAllowed())return;const next={...model(data),isInitial:false};state.segments.unshift(next);state.hasOlder=next.hasOlder;state.nextBefore=next.nextBefore;state.recordedFrom=state.recordedFrom||next.recordedFrom;}
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
    try{const data=await api('/api/people/points-history?type='+encodeURIComponent(type)+'&id='+encodeURIComponent(id));if(token!==request||owner!==myOwner||!current()||!isAllowed())return;const first={...model(data),isInitial:true};state={type,id,person:data?.person||{},segments:[first],hasOlder:first.hasOlder,nextBefore:first.nextBefore,recordedFrom:first.recordedFrom};draw();}
    catch(error){if(token===request&&owner===myOwner&&current()){dialog.innerHTML=loadingMarkup(error?.message||'점수 기록을 불러오지 못했습니다.',true);bindLoadingClose();}}
  }
  function stop(){const owns=dialog?.open&&dialog.querySelector?.('[data-score-history-owner="'+owner+'"]');stopped=true;request++;state=null;selected=null;loadingOlder=false;resizeObserver?.disconnect();resizeObserver=null;observedScroller=null;if(owns){dialog.close?.();dialog.innerHTML='';}}
  return {open,stop};
}
