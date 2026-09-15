// This factory is also serialized into the browser. Keep it self-contained.
export function createScheduleTools(){
  const missed=(d,name)=>Object.hasOwn(d.lateRounds||{},name)?Number(d.lateRounds[name])||0:0;
  // The picker sends numbers, but keep direct/server callers consistent when
  // a numeric database value is represented as a string.
  const pts=p=>{const value=Number(p.points);return Number.isFinite(value)?value:0;};
  const pair=(a,b)=>JSON.stringify([a.id,b.id].sort());
  const addPartnerCounts=(pairCount,match)=>{for(const [a,b] of [[match[0],match[1]],[match[2],match[3]]]){
    const key=pair(a,b);pairCount.set(key,(pairCount.get(key)||0)+1);
  }};
  function chooseFour(roster4,method,pairCount){
    const splits=[[0,1,2,3],[0,2,1,3],[0,3,1,2]];
    const choices=splits.map(indices=>{const players=indices.map(i=>roster4[i]);return {
      players,
      gap:method==='random'?0:Math.abs(pts(players[0])+pts(players[1])-pts(players[2])-pts(players[3])),
      repeats:(pairCount.get(pair(players[0],players[1]))||0)+(pairCount.get(pair(players[2],players[3]))||0)
    };}).sort((a,b)=>a.gap-b.gap||a.repeats-b.repeats);
    return choices[0].players;
  }
  function balanceFour(roster4,method,previousMatches=[]){
    if(!Array.isArray(roster4)||roster4.length!==4||roster4.some(p=>!p||typeof p.id!=='string'||!p.id||typeof p.name!=='string'||!p.name)||new Set(roster4.map(p=>p.id)).size!==4||new Set(roster4.map(p=>p.name)).size!==4)throw Error('4명 대진 참가자 정보를 확인해주세요.');
    if(!['same','balanced','random'].includes(method))throw Error('라운드 방식을 확인해주세요.');
    if(!Array.isArray(previousMatches)||previousMatches.some(match=>!Array.isArray(match)||match.length!==4||match.some(p=>!p||typeof p.id!=='string'||!p.id||typeof p.name!=='string'||!p.name)||new Set(match.map(p=>p.id)).size!==4||new Set(match.map(p=>p.name)).size!==4))throw Error('이전 대진 정보를 확인해주세요.');
    const pairCount=new Map();
    previousMatches.forEach(match=>addPartnerCounts(pairCount,match));
    return chooseFour(roster4,method,pairCount);
  }
  function availableNames(d,ri){return d.names.filter(name=>missed(d,name)<=ri);}
  function refreshRound(d,ri){
    const r=d.schedule[ri],available=availableNames(d,ri),playing=new Set(r.g.flat());
    r.rest=available.filter(name=>!playing.has(name));
    r.late=d.names.filter(name=>missed(d,name)>ri);
    return r;
  }
  function replacePlayer(d,ri,mi,si,next){
    const match=d.schedule[ri].g[mi];
    if(next===match[si])return;
    if(!availableNames(d,ri).includes(next))throw Error('이 라운드에 아직 도착하지 않은 참가자는 넣을 수 없어요.');
    if(match.some((name,i)=>i!==si&&name===next))throw Error('같은 경기에는 한 사람을 두 번 넣을 수 없어요. 다른 경기의 중복 출전은 가능해요.');
    match[si]=next;
    if(d.results)delete d.results[ri+'-'+mi];
    if(d.matchProgress)delete d.matchProgress[ri+'-'+mi];
    refreshRound(d,ri);
  }
  function generate(roster,courts,rounds,methods){
    if(!Array.isArray(roster)||roster.length<4||roster.length>200||roster.some(p=>!p||typeof p.id!=='string'||!p.id||typeof p.name!=='string'||!p.name)||new Set(roster.map(p=>p.id)).size!==roster.length||new Set(roster.map(p=>p.name)).size!==roster.length)throw Error('참가자 명단을 확인해주세요.');
    if(!Number.isInteger(courts)||courts<1||courts>20||!Number.isInteger(rounds)||rounds<1||rounds>20)throw Error('코트와 라운드 수를 확인해주세요.');
    if(!Array.isArray(methods))throw Error('라운드 방식을 확인해주세요.');
    for(const p of roster){const late=p.lateRounds??0;if(!Number.isInteger(late)||late<0||late>5)throw Error('늦참은 0~5라운드 사이로 지정해주세요.');}
    const shuffle=a=>{a=[...a];for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;};
    const priority=p=>p.lateRegistration?0:p.type==='guest'?1:p.operator?2:3;
    const restCount=new Map(roster.map(p=>[p.id,0])),pairCount=new Map();
    const out=[];
    for(let ri=0;ri<rounds;ri++){
      const available=roster.filter(p=>(Number(p.lateRounds)||0)<=ri);
      const late=roster.filter(p=>(Number(p.lateRounds)||0)>ri).map(p=>p.name);
      const cap=Math.min(courts,Math.floor(available.length/4)),restSlots=available.length-cap*4;
      // Each priority participant rests once; ordinary members may rest again,
      // choosing the least-rested first with a shuffled tie break.
      const candidates=shuffle(available).filter(p=>priority(p)===3||restCount.get(p.id)===0)
        .sort((a,b)=>priority(a)-priority(b)||(restCount.get(a.id)-restCount.get(b.id)));
      if(candidates.length<restSlots)throw Error((ri+1)+'라운드: 신청늦음·게스트·운영진의 휴식 1회 제한으로 대진을 채울 수 없어요. 코트 수를 늘리거나 참가자·라운드 수를 조정해주세요.');
      const resting=candidates.slice(0,restSlots),restIds=new Set(resting.map(p=>p.id));
      resting.forEach(p=>restCount.set(p.id,restCount.get(p.id)+1));
      const playing=available.filter(p=>!restIds.has(p.id)),method=methods[ri]||'random',groups=[];
      if(!['same','balanced','random'].includes(method))throw Error('라운드 방식을 확인해주세요.');
      if(method==='random'){
        const sorted=shuffle(playing);for(let i=0;i<sorted.length;i+=4)groups.push(sorted.slice(i,i+4));
      }else{
        const sorted=shuffle(playing).sort((a,b)=>pts(b)-pts(a));
        for(let i=0;i<sorted.length;){
          if(method==='balanced'&&sorted.length-i>=8){
            groups.push([sorted[i],sorted[i+1],sorted[i+4],sorted[i+5]],[sorted[i+2],sorted[i+3],sorted[i+6],sorted[i+7]]);i+=8;
          }else{groups.push(sorted.slice(i,i+4));i+=4;}
        }
      }
      const g=groups.map(group=>{
        const s=chooseFour(group,method,pairCount);
        addPartnerCounts(pairCount,s);
        return s.map(p=>p.name);
      });
      out.push({round:ri+1,method,g,rest:resting.map(p=>p.name),late});
    }
    return out;
  }
  function matchState(d,ri,mi){
    const match=d.schedule?.[ri]?.g?.[mi],key=ri+'-'+mi;
    if(!match)return 'waiting';
    if(match.some(name=>(d.absent||[]).includes(name)))return 'void';
    if(d.settledAt||['a','b'].includes(d.results?.[key]))return 'finished';
    const state=d.matchProgress?.[key];
    return state==='playing'?'playing':state==='finished'&&d.schedule[ri].method==='random'?'finished':'waiting';
  }
  function cleanProgress(d){
    const out={};
    if(!d.matchProgress||typeof d.matchProgress!=='object'||Array.isArray(d.matchProgress))return out;
    for(const [key,state] of Object.entries(d.matchProgress)){
      if(!/^(0|[1-9]\d{0,2})-(0|[1-9]\d{0,2})$/.test(key))continue;
      const [ri,mi]=key.split('-').map(Number),match=d.schedule?.[ri]?.g?.[mi];
      if(!match||d.settledAt||['a','b'].includes(d.results?.[key])||match.some(n=>(d.absent||[]).includes(n)))continue;
      if(state==='playing'||(state==='finished'&&d.schedule[ri].method==='random'))out[key]=state;
    }
    return out;
  }
  return {availableNames,refreshRound,replacePlayer,balanceFour,generate,matchState,cleanProgress};
}
