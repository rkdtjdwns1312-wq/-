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
      duplicates:Number((pairCount.get(pair(players[0],players[1]))||0)>0)+Number((pairCount.get(pair(players[2],players[3]))||0)>0),
      repeats:(pairCount.get(pair(players[0],players[1]))||0)+(pairCount.get(pair(players[2],players[3]))||0)
    };}).sort((a,b)=>method==='random'?0:a.duplicates-b.duplicates||a.repeats-b.repeats||a.gap-b.gap);
    return choices[0].players;
  }
  // Same-seed rounds keep score-neighbour quartets and rotate exactly three
  // prescribed teams. Equal scores keep input roster order (stable sort).
  function sameFour(roster4,sameIndex){
    const sorted=[...roster4].sort((a,b)=>pts(b)-pts(a));
    return [[0,3,1,2],[0,2,1,3],[0,1,2,3]][sameIndex%3].map(i=>sorted[i]);
  }
  // Pair neighbouring score boxes. If their count is odd, reserve the last
  // three boxes: each contributes two players to each of two different games.
  function adjacentLayout(sorted){
    const groups=[],pools=[];
    for(let i=0;i<sorted.length;){
      const take=sorted.length-i===12?12:Math.min(8,sorted.length-i);
      const pool=sorted.slice(i,i+take);pools.push(pool);
      const slots=take===12?[[0,1,4,5],[2,3,8,9],[6,7,10,11]]:
        take===8?[[0,1,4,5],[2,3,6,7]]:[[0,1,2,3]];
      for(const indices of slots)groups.push(indices.map(n=>pool[n]));
      i+=take;
    }
    return {groups,pools};
  }
  function balanceFour(roster4,method,previousMatches=[],sameIndex=0){
    if(!Array.isArray(roster4)||roster4.length!==4||roster4.some(p=>!p||typeof p.id!=='string'||!p.id||typeof p.name!=='string'||!p.name)||new Set(roster4.map(p=>p.id)).size!==4||new Set(roster4.map(p=>p.name)).size!==4)throw Error('4명 대진 참가자 정보를 확인해주세요.');
    if(!['same','balanced','random'].includes(method))throw Error('라운드 방식을 확인해주세요.');
    if(!Array.isArray(previousMatches)||previousMatches.some(match=>!Array.isArray(match)||match.length!==4||match.some(p=>!p||typeof p.id!=='string'||!p.id||typeof p.name!=='string'||!p.name)||new Set(match.map(p=>p.id)).size!==4||new Set(match.map(p=>p.name)).size!==4))throw Error('이전 대진 정보를 확인해주세요.');
    if(!Number.isInteger(sameIndex)||sameIndex<0)throw Error('동일 경기 순서를 확인해주세요.');
    if(method==='same')return sameFour(roster4,sameIndex);
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
  function partnerSummary(schedule){
    const counts=new Map();
    for(const round of schedule||[])if(round.method!=='random')for(const match of round.g||[]){
      if(match.length!==4)continue;
      for(const names of [match.slice(0,2),match.slice(2,4)]){
        const ordered=[...names].sort(),key=JSON.stringify(ordered);
        const item=counts.get(key)||{names:ordered,count:0};item.count++;counts.set(key,item);
      }
    }
    const pairs=[...counts.values()].filter(p=>p.count>1);
    return {duplicateTeams:pairs.reduce((n,p)=>n+p.count-1,0),pairs};
  }
  // This is a current-roster display aid, never a source of settlement points.
  // With explicit IDs, missing people must not be replaced by namesakes.
  function scoreGap(match,d,people){
    if(!Array.isArray(match)||match.length!==4||!Array.isArray(people))return null;
    const values=[];
    for(const name of match){
      const index=(d.names||[]).indexOf(name),id=d.participantIds?.[index];
      const found=people.filter(p=>id?p.id===id:p.name===name);
      if(found.length!==1||found[0].adhoc)return null;
      const value=found[0].points;
      if(!(typeof value==='number'||typeof value==='string'&&value.trim()!==''))return null;
      const points=Number(value);if(!Number.isFinite(points))return null;
      values.push(points);
    }
    return Math.max(...values)-Math.min(...values);
  }
  // Count the entire scored draft, including fixed same-seed partners, but only
  // repair adjacent rounds. Same-seed quartets and their rotation stay locked.
  // Bounded search keeps large (200-player/20-round) drafts responsive. Every
  // accepted change improves duplicates, repeat concentration, then team balance.
  function repairPartners(schedule,roster,adjacentPools){
    const byName=new Map(roster.map((p,i)=>[p.name,i])),size=roster.length;
    const counts=new Uint16Array(size*size),points=roster.map(pts),entries=[];
    const key=(a,b)=>Math.min(a,b)*size+Math.max(a,b);
    const keys=m=>[key(m[0],m[1]),key(m[2],m[3])];
    const add=(m,delta)=>{for(const k of keys(m))counts[k]+=delta;};
    const gap=m=>Math.abs(points[m[0]]+points[m[1]]-points[m[2]]-points[m[3]]);
    const splits=m=>[m,[m[0],m[2],m[1],m[3]],[m[0],m[3],m[1],m[2]]];
    const better=(a,b)=>a[0]<b[0]||a[0]===b[0]&&(a[1]<b[1]||a[1]===b[1]&&a[2]<b[2]);
    const cost=(a,b)=>{
      const edges=b?[...keys(a),...keys(b)]:keys(a);let duplicates=0,repeats=0;
      for(let i=0;i<edges.length;i++){
        let n=counts[edges[i]];for(let j=0;j<i;j++)if(edges[j]===edges[i])n++;
        duplicates+=Number(n>0);repeats+=n;
      }
      return [duplicates,repeats,gap(a)+(b?gap(b):0)];
    };
    for(const [ri,round] of schedule.entries())if(round.method!=='random'){
      const poolOf=new Map();
      // Each pool object is shared by its courts; exchanges must stay inside it.
      for(const pool of adjacentPools[ri]||[]){
        const rule={boxOf:new Map(pool.map((p,i)=>[byName.get(p.name),Math.floor(i/4)])),single:pool.length===4};
        for(const p of pool)poolOf.set(byName.get(p.name),rule);
      }
      for(const [mi,match] of round.g.entries()){
        const m=match.map(name=>byName.get(name));add(m,1);
        if(round.method==='balanced')entries.push({ri,mi,m,rule:poolOf.get(m[0])});
      }
    }
    if(!entries.length)return;
    const allowed=(m,rule)=>{
      const boxes=new Map();
      for(const p of m){
        const box=rule.boxOf.get(p);if(box===undefined)return false;
        const count=(boxes.get(box)||0)+1;
        if(!rule.single&&count>2)return false;
        boxes.set(box,count);
      }
      return true;
    };
    const repeated=e=>keys(e.m).some(k=>counts[k]>1);
    const sweep=()=>{
      let changed=false;
      for(const e of entries){
        add(e.m,-1);let best=e.m,bestCost=cost(best);
        for(const m of splits(e.m).slice(1)){const next=cost(m);if(better(next,bestCost)){best=m;bestCost=next;}}
        if(best!==e.m){e.m=best;changed=true;}add(e.m,1);
      }
      return changed;
    };
    for(let pass=0;pass<6&&sweep();pass++);
    // Two fixed quartets can need to change together to escape a greedy choice.
    let fixedBudget=24000;
    for(let pass=0;pass<2&&entries.some(repeated);pass++){
      let changed=false;
      for(let i=0;i<entries.length&&fixedBudget>0;i++)for(let j=i+1;j<entries.length&&fixedBudget>0;j++){
        const a=entries[i],b=entries[j];
        if((!repeated(a)&&!repeated(b))||a.m.filter(p=>b.m.includes(p)).length<2)continue;
        add(a.m,-1);add(b.m,-1);let bestA=a.m,bestB=b.m,bestCost=cost(a.m,b.m);
        for(const x of splits(a.m))for(const y of splits(b.m)){
          fixedBudget--;const next=cost(x,y);if(better(next,bestCost)){bestA=x;bestB=y;bestCost=next;}
        }
        if(bestA!==a.m||bestB!==b.m){a.m=bestA;b.m=bestB;changed=true;}add(a.m,1);add(b.m,1);
      }
      if(!changed)break;
      for(let pass=0;pass<3&&sweep();pass++);
    }
    // Only if fixed quartets still repeat, try all 315 team/match arrangements
    // for two courts in the SAME round and local 2/3-box pool. Never violate
    // the max-two-per-box limit to reduce partner repeats.
    let crossBudget=180000;
    for(let pass=0;pass<4&&crossBudget>0&&entries.some(repeated);pass++){
      let changed=false;
      for(let ri=0;ri<schedule.length&&crossBudget>0;ri++){
        const courts=entries.filter(e=>e.ri===ri);
        for(let distance=1;distance<courts.length&&crossBudget>0;distance++)for(let i=0;i+distance<courts.length&&crossBudget>0;i++){
          const a=courts[i],b=courts[i+distance];
          if(a.rule!==b.rule||(!repeated(a)&&!repeated(b)))continue;
          const pool=[...a.m,...b.m];
          add(a.m,-1);add(b.m,-1);
          const before=cost(a.m,b.m);let bestA=a.m,bestB=b.m,bestCost=before,bestMoves=0;
          for(let j=1;j<6&&crossBudget>0;j++)for(let k=j+1;k<7&&crossBudget>0;k++)for(let l=k+1;l<8&&crossBudget>0;l++){
            const indices=[0,j,k,l],left=indices.map(n=>pool[n]),right=pool.filter((_,n)=>!indices.includes(n));
            if(!allowed(left,a.rule)||!allowed(right,b.rule))continue;
            for(const x of splits(left))for(const y of splits(right)){
              crossBudget--;const next=cost(x,y);
              // Do not exchange courts solely to improve points or styling.
              if(next[0]>before[0]||next[0]===before[0]&&next[1]>=before[1])continue;
              const moves=x.filter(p=>!a.m.includes(p)).length+y.filter(p=>!b.m.includes(p)).length;
              if(better(next,bestCost)||next.every((v,n)=>v===bestCost[n])&&moves<bestMoves){bestA=x;bestB=y;bestCost=next;bestMoves=moves;}
            }
          }
          if(bestA!==a.m){a.m=bestA;b.m=bestB;changed=true;}add(a.m,1);add(b.m,1);
        }
      }
      if(!changed)break;
      for(let pass=0;pass<3&&sweep();pass++);
    }
    for(const e of entries)schedule[e.ri].g[e.mi]=e.m.map(i=>roster[i].name);
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
    const out=[],adjacentPools=[];let sameIndex=0;
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
        const sorted=[...playing].sort((a,b)=>pts(b)-pts(a));
        if(method==='balanced'){
          const layout=adjacentLayout(sorted);groups.push(...layout.groups);adjacentPools[ri]=layout.pools;
        }else for(let i=0;i<sorted.length;i+=4)groups.push(sorted.slice(i,i+4));
      }
      const g=groups.map(group=>{
        const s=method==='same'?sameFour(group,sameIndex):chooseFour(group,method,pairCount);
        if(method!=='random')addPartnerCounts(pairCount,s);
        return s.map(p=>p.name);
      });
      out.push({round:ri+1,method,g,rest:resting.map(p=>p.name),late});
      if(method==='same')sameIndex++;
    }
    repairPartners(out,roster,adjacentPools);
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
  return {availableNames,refreshRound,replacePlayer,balanceFour,partnerSummary,scoreGap,generate,matchState,cleanProgress};
}
