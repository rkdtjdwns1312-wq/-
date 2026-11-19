const key=(type,id)=>(type==='member'?'m:':'g:')+id;
const typed=value=>({type:value[0]==='m'?'member':'guest',id:value.slice(2)});

export function createPersonLineage(memberRows,guestRows){
  const graph=new Map();
  const add=node=>{if(!graph.has(node))graph.set(node,new Set());};
  const connect=(a,b)=>{if(!a||!b)return;add(a);add(b);graph.get(a).add(b);graph.get(b).add(a);};
  for(const row of memberRows){add(key('member',row.member_id));if(row.promoted_guest_id)connect(key('member',row.member_id),key('guest',row.promoted_guest_id));}
  for(const row of guestRows){add(key('guest',row.guest_id));if(row.demoted_member_id)connect(key('guest',row.guest_id),key('member',row.demoted_member_id));}
  return {
    component(type,id){
      const start=key(type,id),seen=new Set([start]),queue=[start];
      for(let index=0;index<queue.length;index++)for(const next of graph.get(queue[index])||[])if(!seen.has(next)){seen.add(next);queue.push(next);}
      return [...seen].map(typed);
    }
  };
}

export async function readPersonLineage(db){
  const [members,guests]=await Promise.all([
    db.prepare('SELECT member_id,promoted_guest_id FROM ranking_members').all(),
    db.prepare('SELECT guest_id,demoted_member_id FROM guests').all()
  ]);
  return createPersonLineage(members.results||[],guests.results||[]);
}

export async function activePersonAliases(db,members,guests){
  const lineage=await readPersonLineage(db),memberAliases=new Map(),guestAliases=new Map();
  for(const row of members)for(const historical of lineage.component('member',row.member_id)){
    const aliases=historical.type==='member'?memberAliases:guestAliases;
    aliases.set(historical.id,{t:'m',id:row.member_id});
  }
  for(const row of guests)for(const historical of lineage.component('guest',row.guest_id)){
    const aliases=historical.type==='member'?memberAliases:guestAliases;
    aliases.set(historical.id,{t:'g',id:row.guest_id});
  }
  return {lineage,memberAliases,guestAliases,resolve(id){return memberAliases.get(id)||guestAliases.get(id)||null;}};
}
