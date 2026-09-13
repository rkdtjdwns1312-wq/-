import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import worker from './dist/server/index.js';
import { client } from './dist/server/boards-client.js';
const db=new DatabaseSync(':memory:');
for(const name of ['0000_initial_schedule','0001_boards','0002_operator_login_limits','0003_rankings','0004_seed_posts_from_codex_site','0005_clean_member_names','0006_people_manage','0007_jeongmo_2026_09_12','0008_points_movement_and_legacy_cleanup'])db.exec(readFileSync(new URL('./drizzle/'+name+'.sql',import.meta.url),'utf8'));
const DB={prepare(sql){let params=[];const statement=db.prepare(sql);return {bind(...values){params=values;return this;},async first(){return statement.get(...params)||null;},async run(){return {meta:statement.run(...params)};},async all(){return {results:statement.all(...params)};}};},async batch(statements){return Promise.all(statements.map(statement=>statement.run()));}};
const env={DB,EDITOR_KEY:'test-editor-key',OPERATOR_PASSWORD:'test-password'};
const origin='http://localhost:4173';
const login=(password,headers={})=>worker.fetch(new Request(origin+'/api/operator-login',{method:'POST',headers:{origin,'content-type':'application/json','cf-connecting-ip':'test-client',...headers},body:JSON.stringify({password})}),env);
new Function('return ('+client.toString()+')');
assert.ok(client.toString().includes('id="addGuest"')&&client.toString().includes('adhoc'),'openPicker에 즉석 게스트 추가 기능이 있어야 합니다');
assert.ok(client.toString().includes('id="deletePost"'),'상세 화면에 삭제 버튼이 있어야 합니다');
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
const guestPeople=peopleData.people.filter(p=>p.type==='guest');assert.equal(guestPeople.length,35);assert.ok(guestPeople.every(p=>Number.isInteger(p.points)));assert.equal(guestPeople.find(p=>p.name==='몽구').points,125);assert.equal(guestPeople.find(p=>p.name==='우니').points,17);
// 요청 045: 회원 명단의 (부재)·(서울) 표기 제거
assert.ok(rankingData.items.every(r=>!/\((?:서울|부재)\)/.test(r.name)),'회원 랭킹 이름에 (부재)/(서울)가 없어야 합니다');
assert.equal(rankingData.items.find(r=>r.name==='덕자').points,60);assert.equal(rankingData.items.find(r=>r.name==='우민').points,40);
assert.ok(!rankingData.items.some(r=>r.name==='덕자(부재)'||r.name==='우민(부재)'));
for(const nm of ['민석','민수','호구','우주','윤후'])assert.ok(guestPeople.some(p=>p.name===nm),nm+' 게스트 이름이 정리되어야 합니다');
// 겹치는 이름은 지역 표기를 남긴다(회색 작은 글씨로 렌더링): 회원 철 vs 게스트 철, 게스트 선호 2명
assert.ok(guestPeople.some(p=>p.name==='철(서울)'),'겹치는 철은 지역 표기 유지');
assert.ok(guestPeople.some(p=>p.name==='선호(서울)')&&guestPeople.some(p=>p.name==='선호'),'겹치는 선호는 둘 다 존재');
const memberPeople=peopleData.people.filter(p=>p.type==='member');assert.ok(memberPeople.every(p=>Number.isInteger(p.points)));assert.equal(memberPeople.find(p=>p.name==='호잇').points,123);
// 요청 060: 시드현황 사람 추가/삭제(회원·게스트)
const addP=(name,type,points,key=env.EDITOR_KEY)=>worker.fetch(new Request(origin+'/api/people',{method:'POST',headers:{'content-type':'application/json',...(key?{'x-kokkiri-editor':key}:{})},body:JSON.stringify({name,type,points})}),env);
assert.equal((await addP('추가회원','member',55,null)).status,403);
const addM=await addP('추가회원','member',55);assert.equal(addM.status,200);const addMId=(await addM.json()).data.id;
const rkA=await (await worker.fetch(new Request(origin+'/api/rankings'),env)).json();assert.equal(rkA.items.length,62);assert.ok(rkA.items.some(r=>r.name==='추가회원'&&r.seed==='D+'));
assert.equal((await addP('추가회원','member',10)).status,409);
const addG=await addP('추가게스트','guest',30);assert.equal(addG.status,200);const addGId=(await addG.json()).data.id;
const ppA=(await (await worker.fetch(new Request(origin+'/api/people'),env)).json()).people;assert.ok(ppA.some(p=>p.name==='추가게스트'&&p.type==='guest'&&p.seed==='E+'));assert.equal(ppA.filter(p=>p.type==='guest').length,36);
assert.equal((await worker.fetch(new Request(origin+'/api/people/hide',{method:'POST',headers:{'content-type':'application/json','x-kokkiri-editor':env.EDITOR_KEY},body:JSON.stringify({ids:[addMId,addGId]})}),env)).status,200);
const rkB=await (await worker.fetch(new Request(origin+'/api/rankings'),env)).json();assert.equal(rkB.items.length,61);assert.ok(!rkB.items.some(r=>r.name==='추가회원'));
assert.ok(rkB.items.map(r=>r.rank).every((v,i)=>v===i+1),'삭제 후에도 회원 순위가 1..N 연속이어야 합니다');
const ppB=(await (await worker.fetch(new Request(origin+'/api/people'),env)).json()).people;assert.equal(ppB.filter(p=>p.type==='guest').length,35);assert.equal(ppB.filter(p=>p.type==='member').length,61);
assert.equal((await worker.fetch(new Request(origin+'/api/people/hide',{method:'POST'}),env)).status,403);
const schedule={id:'ranking-test',kind:'schedule',version:0,title:'점수 계산 테스트',names:['시오','구구','구름','백구'],participantIds:['member-10','member-17','member-16','member-18'],courts:1,rounds:1,schedule:[{round:1,g:[['시오','구구','구름','백구']],rest:[]}],results:{}};
const put=(version,data)=>worker.fetch(new Request(origin+'/api/posts/ranking-test',{method:'PUT',headers:{'content-type':'application/json','x-kokkiri-editor':env.EDITOR_KEY},body:JSON.stringify({kind:'schedule',version,operation:crypto.randomUUID(),data})}),env);
assert.equal((await put(0,schedule)).status,200);schedule.version=1;schedule.results={'0-0':'a'};const saved=await put(1,schedule);assert.equal(saved.status,200);const savedData=(await saved.json()).data;const settled=await worker.fetch(new Request(origin+'/api/posts/ranking-test/settle',{method:'POST',headers:{'content-type':'application/json','x-kokkiri-editor':env.EDITOR_KEY},body:JSON.stringify({version:savedData.version,operation:'settle-test'})}),env);assert.equal(settled.status,200);const settledData=(await settled.json()).data;assert.equal(settledData.settledAt!==undefined,true);const afterRankings=await (await worker.fetch(new Request(origin+'/api/rankings'),env)).json();const after=afterRankings.items;assert.equal(afterRankings.updatedDate,new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Seoul'}));assert.equal(after.find(row=>row.name==='시오').points,101);assert.equal(after.find(row=>row.name==='구구').points,90);assert.equal(after.find(row=>row.name==='구름').points,89);assert.equal(after.find(row=>row.name==='백구').points,88);assert.equal(after.find(row=>row.name==='시오').previous_points,99);assert.equal(after.find(row=>row.name==='시오').points-after.find(row=>row.name==='시오').previous_points,2);assert.equal(db.prepare('SELECT COUNT(*) AS count FROM ranking_events').get().count,4);assert.equal((await worker.fetch(new Request(origin+'/api/posts/ranking-test/settle',{method:'POST',headers:{'content-type':'application/json','x-kokkiri-editor':env.EDITOR_KEY},body:JSON.stringify({version:settledData.version,operation:'settle-again'})}),env)).status,200);
assert.equal((await put(settledData.version,{...schedule,version:settledData.version,settledAt:settledData.settledAt})).status,409);
const delSchedule={...schedule,id:'delete-test',version:0,settledAt:null,results:{}};
assert.equal((await worker.fetch(new Request(origin+'/api/posts/delete-test',{method:'PUT',headers:{'content-type':'application/json','x-kokkiri-editor':env.EDITOR_KEY},body:JSON.stringify({kind:'schedule',version:0,operation:crypto.randomUUID(),data:delSchedule})}),env)).status,200);
assert.equal((await worker.fetch(new Request(origin+'/api/posts/delete-test',{method:'DELETE'}),env)).status,403);
assert.equal((await worker.fetch(new Request(origin+'/api/posts/delete-test',{method:'DELETE',headers:{'x-kokkiri-editor':env.EDITOR_KEY}}),env)).status,200);
assert.equal((await worker.fetch(new Request(origin+'/api/posts/delete-test'),env)).status,404);
assert.equal((await worker.fetch(new Request(origin+'/api/posts/ranking-test',{method:'DELETE',headers:{'x-kokkiri-editor':env.EDITOR_KEY}}),env)).status,409);
// 요청 065: legacy-schedule는 삭제(마이그레이션 0008) 후 목록/상세를 조회해도 되살아나지 않는다(preserveLegacy 제거)
assert.equal((await worker.fetch(new Request(origin+'/api/posts/legacy-schedule'),env)).status,404);
assert.ok(!((await (await worker.fetch(new Request(origin+'/api/posts?kind=schedule'),env)).json()).items.some(p=>p.id==='legacy-schedule')));
// 요청 037·038·039: 라운드 방식 저장, 회원(공개) 결과 기록, 랜덤 라운드 제외 정산, MVP
const wave2={id:'wave2-test',kind:'schedule',version:0,title:'웨이브2 테스트',names:['시오','구구','구름','백구'],participantIds:['member-10','member-17','member-16','member-18'],courts:1,rounds:2,schedule:[{round:1,method:'balanced',g:[['시오','구구','구름','백구']],rest:[]},{round:2,method:'random',g:[['시오','구구','구름','백구']],rest:[]}],results:{}};
const putW2=(version,data)=>worker.fetch(new Request(origin+'/api/posts/wave2-test',{method:'PUT',headers:{'content-type':'application/json','x-kokkiri-editor':env.EDITOR_KEY},body:JSON.stringify({kind:'schedule',version,operation:crypto.randomUUID(),data})}),env);
const postResult=body=>worker.fetch(new Request(origin+'/api/posts/wave2-test/result',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),env);
const getW2=async()=>(await (await worker.fetch(new Request(origin+'/api/posts/wave2-test'),env)).json()).data;
assert.equal((await putW2(0,wave2)).status,200);
// 요청 047: 새 대진 생성 시 출석/승/패는 0으로 초기화되고 점수는 누적 유지된다
const afterCreate=(await (await worker.fetch(new Request(origin+'/api/rankings'),env)).json()).items,sioAC=afterCreate.find(r=>r.name==='시오');
assert.equal(sioAC.attendance,0);assert.equal(sioAC.wins,0);assert.equal(sioAC.losses,0);assert.equal(sioAC.points,101);
// 요청 066: 새 대진 시작 시 점수 변동 표시(previous_points)와 순위 변동(previous_rank)도 초기화되어 화살표가 사라진다
assert.equal(sioAC.previous_points,sioAC.points);assert.equal(sioAC.previous_rank,sioAC.rank);
const w2got=await getW2();assert.equal(w2got.schedule[0].method,'balanced');assert.equal(w2got.schedule[1].method,'random');
assert.equal((await postResult({key:'1-0',winner:'a'})).status,400);
assert.equal((await postResult({key:'0-0',winner:'x'})).status,400);
assert.equal((await postResult({key:'0-0',winner:'a'})).status,200);
const beforeW=(await (await worker.fetch(new Request(origin+'/api/rankings'),env)).json()).items,bp=n=>beforeW.find(r=>r.name===n).points;
const sB=bp('시오'),gB=bp('구구'),rB=bp('구름'),bB=bp('백구');
const w2v=(await getW2()).version;
const w2settled=await worker.fetch(new Request(origin+'/api/posts/wave2-test/settle',{method:'POST',headers:{'content-type':'application/json','x-kokkiri-editor':env.EDITOR_KEY},body:JSON.stringify({version:w2v,operation:'settle-wave2'})}),env);
assert.equal(w2settled.status,200);const w2data=(await w2settled.json()).data;
const afterW=(await (await worker.fetch(new Request(origin+'/api/rankings'),env)).json()).items,ap=n=>afterW.find(r=>r.name===n).points;
assert.equal(ap('시오')-sB,2);assert.equal(ap('구구')-gB,2);assert.equal(ap('구름')-rB,0);assert.equal(ap('백구')-bB,0);
assert.deepEqual([...w2data.mvp].sort(),['구구','시오']);
assert.ok(w2data.title.includes('MVP')&&w2data.title.includes('시오')&&w2data.title.includes('구구'));
assert.ok(w2data.settledAt);
const mvpApi=await (await worker.fetch(new Request(origin+'/api/mvp'),env)).json();
assert.equal(mvpApi.id,'wave2-test');assert.deepEqual([...mvpApi.mvp].sort(),['구구','시오']);assert.ok(mvpApi.settledAt);
assert.equal((await postResult({key:'0-0',winner:'b'})).status,409);
// 요청 053: 마감 취소(가장 최근 마감 되돌리기)
assert.equal((await worker.fetch(new Request(origin+'/api/posts/wave2-test/unsettle',{method:'POST'}),env)).status,403);
const beforeUn=(await (await worker.fetch(new Request(origin+'/api/rankings'),env)).json()).items,upBp=n=>beforeUn.find(r=>r.name===n).points;
assert.equal((await worker.fetch(new Request(origin+'/api/posts/wave2-test/unsettle',{method:'POST',headers:{'x-kokkiri-editor':env.EDITOR_KEY}}),env)).status,200);
const w2after=await getW2();assert.equal(w2after.settledAt,null);assert.deepEqual(w2after.mvp,[]);assert.ok(!(w2after.title||'').includes('MVP'));
const afterUn=(await (await worker.fetch(new Request(origin+'/api/rankings'),env)).json()).items,unAp=n=>afterUn.find(r=>r.name===n).points;
assert.equal(upBp('시오')-unAp('시오'),2);assert.equal(upBp('구구')-unAp('구구'),2);
assert.equal((await worker.fetch(new Request(origin+'/api/posts/wave2-test/unsettle',{method:'POST',headers:{'x-kokkiri-editor':env.EDITOR_KEY}}),env)).status,400);
assert.equal((await worker.fetch(new Request(origin+'/api/posts/test',{method:'PUT',body:'{}'}),env)).status,403);
assert.equal((await worker.fetch(new Request(origin+'/operate-'+env.EDITOR_KEY),env)).status,200);
assert.equal((await worker.fetch(new Request(origin+'/api/operator-login',{method:'GET'}),env)).status,405);
assert.equal((await worker.fetch(new Request(origin+'/api/operator-login',{method:'POST',headers:{origin},body:'{}'}),{})).status,503);
// 요청 053: 마감 취소(unsettle) — 최근 마감 대진의 정산을 되돌려 점수·출석·승패 원복, settledAt 해제
const uSched={id:'unsettle-test',kind:'schedule',version:0,title:'마감취소 테스트',names:['시오','구구','구름','백구'],participantIds:['member-10','member-17','member-16','member-18'],courts:1,rounds:1,schedule:[{round:1,method:'balanced',g:[['시오','구구','구름','백구']],rest:[]}],results:{}};
assert.equal((await worker.fetch(new Request(origin+'/api/posts/unsettle-test',{method:'PUT',headers:{'content-type':'application/json','x-kokkiri-editor':env.EDITOR_KEY},body:JSON.stringify({kind:'schedule',version:0,operation:crypto.randomUUID(),data:uSched})}),env)).status,200);
const uPre=(await (await worker.fetch(new Request(origin+'/api/rankings'),env)).json()).items.find(r=>r.name==='시오').points;
await worker.fetch(new Request(origin+'/api/posts/unsettle-test/result',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({key:'0-0',winner:'a'})}),env);
const uv=(await (await worker.fetch(new Request(origin+'/api/posts/unsettle-test'),env)).json()).data.version;
assert.equal((await worker.fetch(new Request(origin+'/api/posts/unsettle-test/settle',{method:'POST',headers:{'content-type':'application/json','x-kokkiri-editor':env.EDITOR_KEY},body:JSON.stringify({version:uv,operation:'u-settle'})}),env)).status,200);
const uSet=(await (await worker.fetch(new Request(origin+'/api/rankings'),env)).json()).items.find(r=>r.name==='시오');assert.equal(uSet.points,uPre+2);assert.equal(uSet.attendance,1);assert.equal(uSet.wins,1);
assert.equal((await worker.fetch(new Request(origin+'/api/posts/unsettle-test/unsettle',{method:'POST'}),env)).status,403);
assert.equal((await worker.fetch(new Request(origin+'/api/posts/unsettle-test/unsettle',{method:'POST',headers:{'x-kokkiri-editor':env.EDITOR_KEY}}),env)).status,200);
const uRev=(await (await worker.fetch(new Request(origin+'/api/rankings'),env)).json()).items.find(r=>r.name==='시오');assert.equal(uRev.points,uPre);assert.equal(uRev.attendance,0);assert.equal(uRev.wins,0);
assert.equal((await (await worker.fetch(new Request(origin+'/api/posts/unsettle-test'),env)).json()).data.settledAt,null);
// 요청 062: 코트 추가(라운드 내 경기 수 가변·중복 배치) — 시오·구구·구름·백구가 한 라운드에 두 경기
const putV=(id,v,d)=>worker.fetch(new Request(origin+'/api/posts/'+id,{method:'PUT',headers:{'content-type':'application/json','x-kokkiri-editor':env.EDITOR_KEY},body:JSON.stringify({kind:'schedule',version:v,operation:crypto.randomUUID(),data:d})}),env);
const vt={id:'court-test',kind:'schedule',version:0,title:'코트추가 테스트',names:['시오','구구','구름','백구'],participantIds:['member-10','member-17','member-16','member-18'],courts:1,rounds:1,schedule:[{round:1,method:'balanced',g:[['시오','구구','구름','백구'],['시오','구름','구구','백구']],rest:[]}],results:{'0-0':'a','0-1':'a'}};
assert.equal((await putV('court-test',0,vt)).status,200);
const cB=(await (await worker.fetch(new Request(origin+'/api/rankings'),env)).json()).items,cbp=n=>cB.find(r=>r.name===n).points;const cb={s:cbp('시오'),g:cbp('구구'),r:cbp('구름'),b:cbp('백구')};
assert.equal((await worker.fetch(new Request(origin+'/api/posts/court-test/settle',{method:'POST',headers:{'content-type':'application/json','x-kokkiri-editor':env.EDITOR_KEY},body:JSON.stringify({version:1,operation:'settle-court'})}),env)).status,200);
const cA=(await (await worker.fetch(new Request(origin+'/api/rankings'),env)).json()).items,cap2=n=>cA.find(r=>r.name===n).points;
assert.equal(cap2('시오')-cb.s,3);assert.equal(cap2('구구')-cb.g,1);assert.equal(cap2('구름')-cb.r,1);assert.equal(cap2('백구')-cb.b,-1);
// 요청 061: 불참(무효 경기) — 백구 불참 → 백구 낀 경기 무효, 백구 출석 0, 시오는 출석만
const ab={id:'absent-test',kind:'schedule',version:0,title:'불참 테스트',names:['호잇','뚜기','주밤','로토','시오','구구','구름','백구'],participantIds:['member-4','member-5','member-6','member-7','member-10','member-17','member-16','member-18'],courts:2,rounds:1,schedule:[{round:1,method:'balanced',g:[['호잇','뚜기','주밤','로토'],['시오','구구','구름','백구']],rest:[]}],results:{'0-0':'a','0-1':'a'},absent:['백구']};
assert.equal((await putV('absent-test',0,ab)).status,200);
assert.equal((await worker.fetch(new Request(origin+'/api/posts/absent-test/result',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({key:'0-1',winner:'a'})}),env)).status,400);
const aB=(await (await worker.fetch(new Request(origin+'/api/rankings'),env)).json()).items,abp=n=>aB.find(r=>r.name===n).points;const abv={h:abp('호잇'),t:abp('뚜기'),j:abp('주밤'),l:abp('로토'),s:abp('시오'),b:abp('백구')};
assert.equal((await worker.fetch(new Request(origin+'/api/posts/absent-test/settle',{method:'POST',headers:{'content-type':'application/json','x-kokkiri-editor':env.EDITOR_KEY},body:JSON.stringify({version:1,operation:'settle-abs'})}),env)).status,200);
const aA=(await (await worker.fetch(new Request(origin+'/api/rankings'),env)).json()).items,aap=n=>aA.find(r=>r.name===n).points;
assert.equal(aap('호잇')-abv.h,2);assert.equal(aap('뚜기')-abv.t,2);assert.equal(aap('주밤')-abv.j,0);assert.equal(aap('로토')-abv.l,0);assert.equal(aap('시오')-abv.s,1);assert.equal(aap('백구')-abv.b,0);
// 요청 063: 9월 12일 토요일 정모 대진표(마이그레이션 게시) 로드·정산 검증
const jm=(await (await worker.fetch(new Request(origin+'/api/posts/jeongmo-2026-09-12'),env)).json()).data;
assert.equal(jm.title,'9월 12일 토요일 정모');assert.equal(jm.names.length,28);assert.equal(jm.schedule.length,5);assert.deepEqual(jm.absent,['텐텐']);assert.equal(jm.schedule[4].g.length,8);
const jmGuests=(await (await worker.fetch(new Request(origin+'/api/people'),env)).json()).people.filter(p=>p.type==='guest'&&['아식스','제냐','허니'].includes(p.name));assert.equal(jmGuests.length,3);assert.equal(jmGuests.find(p=>p.name==='아식스').seed,'A');
const jmB=(await (await worker.fetch(new Request(origin+'/api/rankings'),env)).json()).items,jbp=n=>{const r=jmB.find(x=>x.name===n);return r?r.points:null;};
const rotoB=jbp('로토'),chilB=jbp('곽동칠');
const jmSettle=await worker.fetch(new Request(origin+'/api/posts/jeongmo-2026-09-12/settle',{method:'POST',headers:{'content-type':'application/json','x-kokkiri-editor':env.EDITOR_KEY},body:JSON.stringify({version:jm.version,operation:'settle-jeongmo'})}),env);
assert.equal(jmSettle.status,200);const jmData=(await jmSettle.json()).data;
const jmA=(await (await worker.fetch(new Request(origin+'/api/rankings'),env)).json()).items,jap=n=>jmA.find(x=>x.name===n).points;
assert.equal(jap('로토')-rotoB,5);assert.equal(jap('곽동칠')-chilB,-3);
assert.deepEqual([...jmData.mvp].sort(),['동이','로토','소고기','시오','슝슝이','야키'].sort());
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
