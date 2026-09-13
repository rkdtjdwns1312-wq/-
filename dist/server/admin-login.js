// 요청 073: 홈페이지 관리자 로그인. 운영진 로그인과 같은 방식(비밀번호 → 비밀 주소 redirect).
// 관리자 비밀 주소 키는 EDITOR_KEY + ADMIN_PASSWORD에서 서버가 파생한다(새로 등록할 비밀값은 ADMIN_PASSWORD 하나).
const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
async function digest(value){return new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));}
const hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
// 관리자 비밀 주소 키(운영진이 EDITOR_KEY를 알아도 ADMIN_PASSWORD 없이는 파생 불가).
export async function adminKeyFor(env){
  if(!env.EDITOR_KEY||!env.ADMIN_PASSWORD)return '';
  return hex(await digest(env.EDITOR_KEY+':'+env.ADMIN_PASSWORD+':kokkiri-admin'));
}
export async function adminLogin(request,env){
  if(request.method!=='POST')return reply({error:'허용되지 않은 요청입니다.'},405);
  const origin=request.headers.get('origin');
  if(origin!==new URL(request.url).origin)return reply({error:'홈페이지에서 다시 시도해주세요.'},403);
  if(!env.ADMIN_PASSWORD||!env.EDITOR_KEY||!env.DB)return reply({error:'관리자 연결을 준비 중입니다. 잠시 후 다시 시도해주세요.'},503);
  try{
    if(Number(request.headers.get('content-length'))>1024)return reply({error:'입력 내용을 확인해주세요.'},413);
    const raw=await request.text();
    if(raw.length>1024)return reply({error:'입력 내용을 확인해주세요.'},413);
    let data;try{data=JSON.parse(raw);}catch{return reply({error:'입력 내용을 확인해주세요.'},400);}
    if(typeof data?.password!=='string'||data.password.length>128)return reply({error:'비밀번호를 입력해주세요.'},400);
    const now=Date.now(),window=15*60*1000;
    const address=request.headers.get('cf-connecting-ip')||'unknown';
    const bucket=hex(await digest('admin:'+env.EDITOR_KEY+':'+address));
    const row=await env.DB.prepare(`INSERT INTO operator_login_limits (bucket,attempts,expires_at) VALUES (?,1,?)
      ON CONFLICT(bucket) DO UPDATE SET
      attempts=CASE WHEN expires_at<=? THEN 1 ELSE MIN(attempts+1,6) END,
      expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END
      RETURNING attempts`).bind(bucket,now+window,now,now).first();
    if(row.attempts>5)return reply({error:'시도 횟수를 초과했습니다. 15분 후 다시 시도해주세요.'},429);
    const [actual,expected]=await Promise.all([digest(data.password),digest(env.ADMIN_PASSWORD)]);
    let different=0;for(let i=0;i<actual.length;i++)different|=actual[i]^expected[i];
    if(different)return reply({error:'비밀번호가 올바르지 않습니다.'},401);
    await env.DB.prepare('DELETE FROM operator_login_limits WHERE bucket=?').bind(bucket).run();
    return reply({redirect:'/administrate-'+await adminKeyFor(env)});
  }catch{return reply({error:'연결하지 못했습니다. 잠시 후 다시 시도해주세요.'},503);}
}
