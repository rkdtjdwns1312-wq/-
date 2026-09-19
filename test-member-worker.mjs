// Existing feature regression fixtures act as logged-in MEMBERS, never operators.
// Auth boundary tests and the browser preview must import the raw worker instead.
import assert from 'node:assert/strict';
import rawWorker from './dist/server/index.js';
const sessions=new WeakMap();
export const testMemberPassword='test-member-password';
async function session(env,origin){
  let pending=sessions.get(env.DB);
  if(!pending){
    pending=(async()=>{
      const headers={origin,'content-type':'application/json','x-kokkiri-editor':env.EDITOR_KEY};
      const configured=await rawWorker.fetch(new Request(origin+'/api/member-access/config',{method:'POST',headers,body:JSON.stringify({password:testMemberPassword,version:0})}),env);
      assert.equal(configured.status,200,'fixture member password configuration');
      delete headers['x-kokkiri-editor'];
      const response=await rawWorker.fetch(new Request(origin+'/api/member-login',{method:'POST',headers,body:JSON.stringify({password:testMemberPassword})}),env);
      assert.equal(response.status,200,'fixture member login');
      return response.headers.get('set-cookie').split(';')[0];
    })();sessions.set(env.DB,pending);
  }
  return pending;
}
export default {
  ...rawWorker,
  async fetch(request,env){
    const url=new URL(request.url);
    if(!url.pathname.startsWith('/api/')||/\/api\/(?:member-|operator-login|admin-login)/.test(url.pathname)||!env.DB||!env.EDITOR_KEY)return rawWorker.fetch(request,env);
    const headers=new Headers(request.headers);
    if(!headers.has('cookie')&&!headers.has('x-kokkiri-editor'))headers.set('cookie',await session(env,url.origin));
    if(!['GET','HEAD'].includes(request.method)){
      if(!headers.has('origin'))headers.set('origin',url.origin);
      if(!headers.has('content-type'))headers.set('content-type','application/json');
    }
    return rawWorker.fetch(new Request(request,{headers}),env);
  }
};
