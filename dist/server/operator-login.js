const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
async function digest(value){return new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));}
export async function operatorLogin(request,env){
  if(request.method!=='POST')return reply({error:'허용되지 않은 요청입니다.'},405);
  const origin=request.headers.get('origin');
  if(origin!==new URL(request.url).origin)return reply({error:'홈페이지에서 다시 시도해주세요.'},403);
  if(!env.OPERATOR_PASSWORD||!env.EDITOR_KEY||!env.DB)return reply({error:'운영진 연결을 준비 중입니다. 잠시 후 다시 시도해주세요.'},503);
  try{
    if(Number(request.headers.get('content-length'))>1024)return reply({error:'입력 내용을 확인해주세요.'},413);
    const raw=await request.text();
    if(raw.length>1024)return reply({error:'입력 내용을 확인해주세요.'},413);
    let data;try{data=JSON.parse(raw);}catch{return reply({error:'입력 내용을 확인해주세요.'},400);}
    if(typeof data?.password!=='string'||data.password.length>128)return reply({error:'비밀번호를 입력해주세요.'},400);
    const now=Date.now(),window=15*60*1000;
    // Persist the attempt limit across Worker instances; do not retain raw IPs.
    const address=request.headers.get('cf-connecting-ip')||'unknown';
    const bucket=Array.from(await digest(env.EDITOR_KEY+':'+address),b=>b.toString(16).padStart(2,'0')).join('');
    const row=await env.DB.prepare(`INSERT INTO operator_login_limits (bucket,attempts,expires_at) VALUES (?,1,?)
      ON CONFLICT(bucket) DO UPDATE SET
      attempts=CASE WHEN expires_at<=? THEN 1 ELSE MIN(attempts+1,6) END,
      expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END
      RETURNING attempts`).bind(bucket,now+window,now,now).first();
    if(row.attempts>5)return reply({error:'시도 횟수를 초과했습니다. 15분 후 다시 시도해주세요.'},429);
    const [actual,expected]=await Promise.all([digest(data.password),digest(env.OPERATOR_PASSWORD)]);
    let different=0;for(let i=0;i<actual.length;i++)different|=actual[i]^expected[i];
    if(different)return reply({error:'비밀번호가 올바르지 않습니다.'},401);
    await env.DB.prepare('DELETE FROM operator_login_limits WHERE bucket=?').bind(bucket).run();
    return reply({redirect:'/operate-'+env.EDITOR_KEY});
  }catch{return reply({error:'연결하지 못했습니다. 잠시 후 다시 시도해주세요.'},503);}
}
