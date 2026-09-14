// This factory is also serialized into the browser. Keep it self-contained.
export function createScheduleTools(){
  const missed=(d,name)=>Object.hasOwn(d.lateRounds||{},name)?Number(d.lateRounds[name])||0:0;
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
    const shuffle=a=>{a=[...a];for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;};
    const pts=p=>Number.isFinite(p.points)?p.points:0;
    const priority=p=>p.lateRegistration?0:p.type==='guest'?1:p.operator?2:3;
    const restCount=new Map(roster.map(p=>[p.id,0])),pairCount=new Map();
    const pair=(a,b)=>JSON.stringify([a.id,b.id].sort());
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
        // same/adjacent always mix stronger and weaker players across teams.
        const splits=method==='random'?[[0,1,2,3],[0,2,1,3],[0,3,1,2]]:[[0,3,1,2],[0,2,1,3]];
        const choices=splits.map(sp=>{
          const s=sp.map(i=>group[i]);
          return {s,gap:method==='random'?0:Math.abs(pts(s[0])+pts(s[1])-pts(s[2])-pts(s[3])),repeats:(pairCount.get(pair(s[0],s[1]))||0)+(pairCount.get(pair(s[2],s[3]))||0)};
        }).sort((a,b)=>a.gap-b.gap||a.repeats-b.repeats);
        const s=choices[0].s;
        for(const [a,b] of [[s[0],s[1]],[s[2],s[3]]])pairCount.set(pair(a,b),(pairCount.get(pair(a,b))||0)+1);
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
  return {availableNames,refreshRound,replacePlayer,generate,matchState,cleanProgress};
}
