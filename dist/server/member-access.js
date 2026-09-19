const encoder=new TextEncoder();
export const MEMBER_COOKIE='__Host-kokkiri_member';
const lifetime=7*24*60*60*1000;
const message='회원만 볼 수 있는 메뉴입니다';
const json=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...headers}});
const denied=()=>json({error:message,code:'MEMBERS_ONLY'},401);
const operator=(request,env)=>Boolean(env.EDITOR_KEY&&request.headers.get('x-kokkiri-editor')===env.EDITOR_KEY);
const sameOrigin=request=>request.headers.get('origin')===new URL(request.url).origin;
const jsonType=request=>(request.headers.get('content-type')||'').split(';')[0].trim().toLowerCase()==='application/json';
const cookieHeader=(value,maxAge)=>MEMBER_COOKIE+'='+value+'; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age='+maxAge;
const hex=bytes=>Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
async function mac(key,text){
  const secret=await crypto.subtle.importKey('raw',encoder.encode(key),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return hex(await crypto.subtle.sign('HMAC',secret,encoder.encode('kokkiri-member-v1:'+text)));
}
async function verifyMac(key,text,signature){
  const secret=await crypto.subtle.importKey('raw',encoder.encode(key),{name:'HMAC',hash:'SHA-256'},false,['verify']);
  return crypto.subtle.verify('HMAC',secret,Uint8Array.from(signature.match(/../g),b=>parseInt(b,16)),encoder.encode('kokkiri-member-v1:'+text));
}
async function passwordVerifier(key,salt,password){
  const material=await crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveBits']);
  // Workers supports at most 100,000 PBKDF2 iterations; pepper the derived value separately.
  const derived=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',iterations:100000,salt:encoder.encode('kokkiri-member-password-v1:'+salt)},material,256);
  return mac(key,'password:'+salt+':'+hex(derived));
}
function equal(a,b){if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;}
const config=env=>env.DB.prepare('SELECT version,salt,verifier FROM member_access_config WHERE id=1').first();
const configured=row=>Boolean(row&&Number.isSafeInteger(row.version)&&row.version>0&&/^[a-f0-9-]{36}$/.test(row.salt)&&/^[a-f0-9]{64}$/.test(row.verifier));
function cookie(request){
  const values=(request.headers.get('cookie')||'').split(';').map(s=>s.trim()).filter(s=>s.startsWith(MEMBER_COOKIE+'='));
  return values.length===1?values[0].slice(MEMBER_COOKIE.length+1):'';
}
export async function hasMemberAccess(request,env){
  if(operator(request,env))return true;
  if(!env.EDITOR_KEY||!env.DB)return false;
  const value=cookie(request),parts=value.split('.');
  if(value.length>256||parts.length!==5||parts[0]!=='v1'||!/^\d{1,10}$/.test(parts[1])||!/^\d{13}$/.test(parts[2])||!/^[a-f0-9]{32}$/.test(parts[3])||!/^[a-f0-9]{64}$/.test(parts[4]))return false;
  const expires=Number(parts[2]),version=Number(parts[1]);
  if(version<1||expires<=Date.now()||expires>Date.now()+lifetime+60000)return false;
  try{
    if(!await verifyMac(env.EDITOR_KEY,'session:'+parts.slice(0,4).join('.'),parts[4]))return false;
    const row=await config(env);return configured(row)&&row.version===version;
  }catch{return false;}
}
export async function requireMember(request,env){
  if(!await hasMemberAccess(request,env))return denied();
  if(!['GET','HEAD'].includes(request.method)&&!sameOrigin(request))return json({error:'홈페이지에서 다시 시도해주세요.'},403);
  if(!['GET','HEAD'].includes(request.method)&&!jsonType(request))return json({error:'JSON 형식으로 요청해주세요.'},415);
  return null;
}
async function input(request){
  if(!jsonType(request))return {error:json({error:'JSON 형식으로 요청해주세요.'},415)};
  if(Number(request.headers.get('content-length'))>1024)return {error:json({error:'입력 내용이 너무 큽니다.'},413)};
  const raw=await request.text();if(raw.length>1024)return {error:json({error:'입력 내용이 너무 큽니다.'},413)};
  try{return {data:JSON.parse(raw)};}catch{return {error:json({error:'입력 내용을 확인해주세요.'},400)};}
}
async function issueCookie(env,version){
  const base=['v1',version,Date.now()+lifetime,crypto.randomUUID().replaceAll('-','')].join('.');
  return cookieHeader(base+'.'+await mac(env.EDITOR_KEY,'session:'+base),lifetime/1000);
}
export async function memberAccessEndpoint(request,env){
  const path=new URL(request.url).pathname;
  if(path==='/api/member-session'){
    if(request.method!=='GET')return json({error:'허용되지 않은 요청입니다.'},405);
    return json({member:await hasMemberAccess(request,env)});
  }
  if(path==='/api/member-access/config'){
    if(!operator(request,env))return json({error:'운영진만 설정할 수 있습니다.'},403);
    if(!['GET','POST'].includes(request.method))return json({error:'허용되지 않은 요청입니다.'},405);
    if(request.method==='POST'&&!sameOrigin(request))return json({error:'홈페이지에서 다시 시도해주세요.'},403);
    try{
      const row=await config(env);
      if(request.method==='GET')return json({configured:configured(row),version:row?.version||0});
      const parsed=await input(request);if(parsed.error)return parsed.error;
      const {password,version}=parsed.data||{};
      if(typeof password!=='string'||password.length<6||password.length>128||/[\u0000-\u001f\u007f]/.test(password)||!Number.isSafeInteger(version)||version<0)return json({error:'암호와 설정 버전을 확인해주세요.'},400);
      const salt=crypto.randomUUID(),verifier=await passwordVerifier(env.EDITOR_KEY,salt,password);
      const saved=await env.DB.prepare('UPDATE member_access_config SET version=version+1,salt=?,verifier=?,updated_at=? WHERE id=1 AND version=?').bind(salt,verifier,new Date().toISOString(),version).run();
      if(!saved.meta.changes)return json({error:'설정이 변경되었습니다. 최신 설정을 확인해주세요.'},409);
      return json({configured:true,version:version+1});
    }catch{return json({error:'회원 입장 설정을 저장하지 못했습니다.'},503);}
  }
  if(request.method!=='POST')return json({error:'허용되지 않은 요청입니다.'},405);
  if(!sameOrigin(request))return json({error:'홈페이지에서 다시 시도해주세요.'},403);
  if(!jsonType(request))return json({error:'JSON 형식으로 요청해주세요.'},415);
  if(path==='/api/member-logout')return json({member:false},200,{'set-cookie':cookieHeader('',0)});
  if(!env.EDITOR_KEY||!env.DB)return json({error:'회원 입장을 준비 중입니다. 운영진에게 문의해주세요.'},503);
  try{
    const parsed=await input(request);if(parsed.error)return parsed.error;
    const password=parsed.data?.password;
    if(typeof password!=='string'||!password||password.length>128)return json({error:'회원전용 비밀번호를 입력해주세요.'},400);
    const row=await config(env);if(!configured(row))return json({error:'회원 입장을 준비 중입니다. 운영진에게 문의해주세요.'},503);
    const now=Date.now(),window=15*60*1000;
    await env.DB.prepare('DELETE FROM member_login_limits WHERE expires_at<=?').bind(now).run();
    const bucket=await mac(env.EDITOR_KEY,'limit:'+(request.headers.get('cf-connecting-ip')||'unknown'));
    const attempts=await env.DB.prepare(`INSERT INTO member_login_limits (bucket,attempts,expires_at) VALUES (?,1,?)
      ON CONFLICT(bucket) DO UPDATE SET attempts=CASE WHEN expires_at<=? THEN 1 ELSE MIN(attempts+1,6) END,
      expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END RETURNING attempts,expires_at`).bind(bucket,now+window,now,now).first();
    if(attempts.attempts>5)return json({error:'시도 횟수를 초과했습니다. 15분 후 다시 시도해주세요.'},429,{'retry-after':String(Math.max(1,Math.ceil((attempts.expires_at-now)/1000)))});
    if(!equal(await passwordVerifier(env.EDITOR_KEY,row.salt,password),row.verifier))return json({error:'비밀번호가 올바르지 않습니다.'},401);
    const latest=await config(env);if(latest.version!==row.version)return json({error:'입장 암호가 변경되었습니다. 다시 시도해주세요.'},409);
    // Do not erase another concurrent attempt made after this successful request reserved its slot.
    await env.DB.prepare('DELETE FROM member_login_limits WHERE bucket=? AND attempts=? AND expires_at=?').bind(bucket,attempts.attempts,attempts.expires_at).run();
    return json({member:true},200,{'set-cookie':await issueCookie(env,row.version)});
  }catch{return json({error:'회원 입장에 연결하지 못했습니다. 잠시 후 다시 시도해주세요.'},503);}
}
