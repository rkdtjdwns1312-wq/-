import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import worker from './dist/server/index.js';
import { client } from './dist/server/boards-client.js';
const db=new DatabaseSync(':memory:');
for(const name of ['0000_initial_schedule','0001_boards','0002_operator_login_limits'])db.exec(readFileSync(new URL('./drizzle/'+name+'.sql',import.meta.url),'utf8'));
const DB={prepare(sql){let params=[];const statement=db.prepare(sql);return {bind(...values){params=values;return this;},async first(){return statement.get(...params)||null;},async run(){return {meta:statement.run(...params)};},async all(){return {results:statement.all(...params)};}};}};
const env={DB,EDITOR_KEY:'test-editor-key',OPERATOR_PASSWORD:'test-password'};
const origin='http://localhost:4173';
const login=(password,headers={})=>worker.fetch(new Request(origin+'/api/operator-login',{method:'POST',headers:{origin,'content-type':'application/json','cf-connecting-ip':'test-client',...headers},body:JSON.stringify({password})}),env);
new Function('return ('+client.toString()+')');
assert.equal((await login('wrong')).status,401);
const accepted=await login('test-password');assert.equal(accepted.status,200);assert.equal((await accepted.json()).redirect,'/operate-test-editor-key');
assert.equal((await login('test-password',{origin:'https://untrusted.example'})).status,403);
for(let i=0;i<5;i++)assert.equal((await login('wrong')).status,401);
assert.equal((await login('test-password')).status,429);
db.exec('UPDATE operator_login_limits SET expires_at=0');
assert.equal((await login('test-password')).status,200);
const html=await (await worker.fetch(new Request(origin),env)).text();
assert.ok(html.includes('운영진권한'));assert.ok(!html.includes(env.OPERATOR_PASSWORD));assert.ok(!html.includes(env.EDITOR_KEY));
assert.ok(html.includes('콕끼리 Since 2026.05.08. 우리가 함께한지 <strong id="daysTogether">-</strong>일'));
assert.ok(html.includes('.days-together strong{color:#03a84e'));
assert.ok(html.includes('Intl.DateTimeFormat'));
assert.equal((await worker.fetch(new Request(origin+'/api/posts/test',{method:'PUT',body:'{}'}),env)).status,403);
assert.equal((await worker.fetch(new Request(origin+'/operate-'+env.EDITOR_KEY),env)).status,200);
assert.equal((await worker.fetch(new Request(origin+'/api/operator-login',{method:'GET'}),env)).status,405);
assert.equal((await worker.fetch(new Request(origin+'/api/operator-login',{method:'POST',headers:{origin},body:'{}'}),{})).status,503);
console.log('PASS: correct/incorrect passwords, 5-attempt limit, expiry, origin checks, missing configuration, public secret isolation, existing operator route and unauthenticated write rejection.');
if(process.argv.includes('--serve')){
  env.OPERATOR_PASSWORD=process.env.OPERATOR_PASSWORD||'test-password';
  createServer(async(req,res)=>{
    try{const chunks=[];for await(const chunk of req)chunks.push(chunk);
      const r=await worker.fetch(new Request(origin+req.url,{method:req.method,headers:req.headers,...(['GET','HEAD'].includes(req.method)?{}:{body:Buffer.concat(chunks)})}),env);
      res.writeHead(r.status,Object.fromEntries(r.headers));res.end(Buffer.from(await r.arrayBuffer()));
    }catch{res.writeHead(500);res.end('Preview unavailable');}
  }).listen(4173,'127.0.0.1',()=>console.log('Local URL: http://localhost:4173'));
}
