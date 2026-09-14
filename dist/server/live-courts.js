const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const blank=()=>({names:['','','',''],state:'waiting'});
const unpack=row=>{const data=row?JSON.parse(row.payload):{courts:[],queue:[]};return {...data,isOpen:data.isOpen===true,version:row?.version||0,updatedAt:row?.updated_at||null};};
const visible=(data,editor)=>data.isOpen||editor?data:{...data,courts:[],queue:[]};
const conflict=()=>json({error:'다른 사람이 먼저 변경했어요. 최신 코트를 확인한 뒤 다시 입력해주세요.',conflict:true},409);

// This endpoint never reads or writes scoring, attendance or settlement tables.
export async function liveCourts(request,env){
  if(!['GET','POST'].includes(request.method))return json({error:'허용되지 않은 요청입니다.'},405);
  if(!env.DB)return json({error:'현재 코트를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.'},503);
  const editor=Boolean(env.EDITOR_KEY&&request.headers.get('x-kokkiri-editor')===env.EDITOR_KEY);
  try{
    if(request.method==='GET')return json({data:visible(unpack(await env.DB.prepare('SELECT * FROM live_courts WHERE id=1').first()),editor)});
    const raw=await request.text();if(raw.length>2000)return json({error:'입력 내용이 너무 큽니다.'},413);
    let input;try{input=JSON.parse(raw);}catch{return json({error:'입력 내용을 확인해주세요.'},400);}
    if(!input||!Number.isInteger(input.version)||input.version<0||!['create','open','close','join','leave','end'].includes(input.action))return json({error:'입력 내용을 확인해주세요.'},400);
    if(['create','open','close'].includes(input.action)&&!editor)return json({error:'코트 생성과 실시간대진 열기·종료는 운영진만 할 수 있습니다.'},403);
    const row=await env.DB.prepare('SELECT * FROM live_courts WHERE id=1').first(),current=unpack(row);
    if(input.version!==current.version)return conflict();
    let courts=current.courts,queue=current.queue,isOpen=current.isOpen;
    if(input.action==='open'||input.action==='close'){
      isOpen=input.action==='open';
      if(current.isOpen===isOpen)return json({data:current});
    }else if(input.action==='create'){
      if(!Number.isInteger(input.count)||input.count<1||input.count>20)return json({error:'코트 수는 1~20개로 입력해주세요.'},400);
      courts=Array.from({length:input.count},blank);
      queue=[];
    }else{
      if(!isOpen)return json({error:'실시간대진이 종료되어 입장하거나 변경할 수 없습니다. 운영진이 다시 열면 이용해주세요.',closed:true},409);
      if(input.court==='queue'){
        if(!courts.length)return json({error:'운영진이 코트를 연 뒤 참가해주세요.'},400);
        if(input.action==='join'){
          if(typeof input.name!=='string'||!input.name.trim()||input.name.trim().length>40||/[\u0000-\u001f\u007f]/.test(input.name))return json({error:'이름은 줄바꿈 없이 1~40자로 입력해주세요.'},400);
          const name=input.name.trim();
          if(courts.some(c=>c.names.includes(name)))return json({error:'현재 게임중인 회원입니다. 등록할 수 없습니다.'},409);
          if(queue.some(g=>g.names.includes(name)))return json({error:'이미 다음 대진에 등록된 이름입니다.'},409);
          if(!queue.length&&courts.some(c=>c.state==='waiting'&&c.names.includes('')))return json({error:'빈자리가 있는 코트에 먼저 들어가주세요.'},409);
          let group=queue.find(g=>g.names.includes(''));
          if(!group){if(queue.length>=100)return json({error:'대기 인원이 많습니다. 잠시 후 다시 참가해주세요.'},409);group={names:['','','','']};queue.push(group);}
          group.names[group.names.indexOf('')]=name;
        }else if(input.action==='leave'){
          if(!Number.isInteger(input.group)||!queue[input.group]||!Number.isInteger(input.slot)||input.slot<0||input.slot>3||!queue[input.group].names[input.slot])return json({error:'대기중인 이름을 확인해주세요.'},400);
          queue[input.group].names[input.slot]='';
          queue=queue.filter(g=>g.names.some(Boolean));
        }else return json({error:'대기 명단에서 사용할 수 없는 기능입니다.'},400);
      }else{
      if(!Number.isInteger(input.court)||!courts[input.court])return json({error:'코트를 먼저 생성하거나 최신 화면을 확인해주세요.'},400);
      const court=courts[input.court],full=()=>court.names.every(Boolean)&&new Set(court.names).size===4;
      if(input.action==='join'){
        if(typeof input.name!=='string')return json({error:'이름을 입력해주세요.'},400);
        const name=input.name.trim();
        if(!name||name.length>40||/[\u0000-\u001f\u007f]/.test(name))return json({error:'이름은 줄바꿈 없이 1~40자로 입력해주세요.'},400);
        if(courts.some(c=>c.names.includes(name)))return json({error:'현재 게임중인 회원입니다. 등록할 수 없습니다.'},409);
        if(queue.some(g=>g.names.includes(name)))return json({error:'이미 다음 대진에 등록된 이름입니다.'},409);
        if(court.state!=='waiting')return json({error:'대기중인 코트에만 들어갈 수 있습니다.'},409);
        const slot=court.names.indexOf('');if(slot<0)return json({error:'코트가 가득 찼습니다. 다른 코트를 선택해주세요.'},409);
        court.names[slot]=name;
      }else if(input.action==='leave'){
        if(court.state!=='waiting')return json({error:'대기중일 때만 참가를 취소할 수 있습니다.'},409);
        if(!Number.isInteger(input.slot)||input.slot<0||input.slot>3||!court.names[input.slot])return json({error:'등록된 이름칸을 확인해주세요.'},400);
        court.names[input.slot]='';
      }else if(input.action==='end'){
        if(!full())return json({error:'네 명이 들어간 코트에서 대진을 종료해주세요.'},409);
        courts[input.court]=queue.length?{names:queue.shift().names,state:'waiting'}:blank();
      }
      }
    }
    for(const court of courts)court.state=court.names.every(Boolean)?'playing':'waiting';
    const at=new Date().toISOString(),payload=JSON.stringify({courts,queue,isOpen});
    const result=row
      ?await env.DB.prepare('UPDATE live_courts SET payload=?,version=version+1,updated_at=? WHERE id=1 AND version=?').bind(payload,at,input.version).run()
      :await env.DB.prepare('INSERT OR IGNORE INTO live_courts (id,payload,version,updated_at) VALUES (1,?,1,?)').bind(payload,at).run();
    if(!result.meta.changes)return conflict();
    return json({data:visible({courts,queue,isOpen,version:current.version+1,updatedAt:at},editor)});
  }catch(error){console.error('Live courts request failed',error);return json({error:'현재 코트를 저장하지 못했습니다. 잠시 후 다시 시도해주세요.'},503);}
}
