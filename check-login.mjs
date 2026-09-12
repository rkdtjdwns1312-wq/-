import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import worker from './dist/server/index.js';
import { client } from './dist/server/boards-client.js';
const db=new DatabaseSync(':memory:');
for(const name of ['0000_initial_schedule','0001_boards','0002_operator_login_limits','0003_rankings','0004_seed_posts_from_codex_site'])db.exec(readFileSync(new URL('./drizzle/'+name+'.sql',import.meta.url),'utf8'));
const DB={prepare(sql){let params=[];const statement=db.prepare(sql);return {bind(...values){params=values;return this;},async first(){return statement.get(...params)||null;},async run(){return {meta:statement.run(...params)};},async all(){return {results:statement.all(...params)};}};},async batch(statements){return Promise.all(statements.map(statement=>statement.run()));}};
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
const rankings=await worker.fetch(new Request(origin+'/api/rankings'),env);assert.equal(rankings.status,200);const rankingData=await rankings.json();assert.equal(rankingData.items.length,61);assert.equal(rankingData.source,'콕끼리 시드 관리표.xlsx');assert.equal(rankingData.sourceDate,'2026-09-10');assert.equal(rankingData.updatedDate,'2026-09-10');
const sio=rankingData.items.find(row=>row.name==='시오'),newMember=rankingData.items.find(row=>row.name==='호잇');assert.equal(sio.points,99);assert.equal(sio.seed,'B+');assert.equal(newMember.points,123);assert.equal(newMember.seed,'A+');
// 주밤(115)·로토(104): the sheet said A+, the operator confirmed A on 2026-09-12; seeds follow the points rule everywhere, including the roster shown to operators.
const jubam=rankingData.items.find(row=>row.name==='주밤'),roto=rankingData.items.find(row=>row.name==='로토');assert.equal(jubam.points,115);assert.equal(jubam.seed,'A');assert.equal(roto.points,104);assert.equal(roto.seed,'A');
const peopleData=await (await worker.fetch(new Request(origin+'/api/people'),env)).json();assert.equal(peopleData.people.find(p=>p.name==='주밤').seed,'A');assert.equal(peopleData.people.find(p=>p.name==='로토').seed,'A');
const guestPeople=peopleData.people.filter(p=>p.type==='guest');assert.equal(guestPeople.length,32);assert.ok(guestPeople.every(p=>Number.isInteger(p.points)));assert.equal(guestPeople.find(p=>p.name==='몽구').points,125);assert.equal(guestPeople.find(p=>p.name==='우니').points,17);
const memberPeople=peopleData.people.filter(p=>p.type==='member');assert.ok(memberPeople.every(p=>Number.isInteger(p.points)));assert.equal(memberPeople.find(p=>p.name==='호잇').points,123);
const schedule={id:'ranking-test',kind:'schedule',version:0,title:'점수 계산 테스트',names:['시오','구구','구름','백구'],participantIds:['member-10','member-17','member-16','member-18'],courts:1,rounds:1,schedule:[{round:1,g:[['시오','구구','구름','백구']],rest:[]}],results:{}};
const put=(version,data)=>worker.fetch(new Request(origin+'/api/posts/ranking-test',{method:'PUT',headers:{'content-type':'application/json','x-kokkiri-editor':env.EDITOR_KEY},body:JSON.stringify({kind:'schedule',version,operation:crypto.randomUUID(),data})}),env);
assert.equal((await put(0,schedule)).status,200);schedule.version=1;schedule.results={'0-0':'a'};const saved=await put(1,schedule);assert.equal(saved.status,200);const savedData=(await saved.json()).data;const settled=await worker.fetch(new Request(origin+'/api/posts/ranking-test/settle',{method:'POST',headers:{'content-type':'application/json','x-kokkiri-editor':env.EDITOR_KEY},body:JSON.stringify({version:savedData.version,operation:'settle-test'})}),env);assert.equal(settled.status,200);const settledData=(await settled.json()).data;assert.equal(settledData.settledAt!==undefined,true);const afterRankings=await (await worker.fetch(new Request(origin+'/api/rankings'),env)).json();const after=afterRankings.items;assert.equal(afterRankings.updatedDate,new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Seoul'}));assert.equal(after.find(row=>row.name==='시오').points,101);assert.equal(after.find(row=>row.name==='구구').points,90);assert.equal(after.find(row=>row.name==='구름').points,89);assert.equal(after.find(row=>row.name==='백구').points,88);assert.equal(db.prepare('SELECT COUNT(*) AS count FROM ranking_events').get().count,4);assert.equal((await worker.fetch(new Request(origin+'/api/posts/ranking-test/settle',{method:'POST',headers:{'content-type':'application/json','x-kokkiri-editor':env.EDITOR_KEY},body:JSON.stringify({version:settledData.version,operation:'settle-again'})}),env)).status,200);
assert.equal((await put(settledData.version,{...schedule,version:settledData.version,settledAt:settledData.settledAt})).status,409);
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
