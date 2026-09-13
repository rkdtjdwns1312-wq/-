import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import worker from './dist/server/index.js';

const migrationDir=new URL('./drizzle/',import.meta.url);
const migrations=readdirSync(migrationDir).filter(n=>n.endsWith('.sql')).sort();
function database(){
  const sqlite=new DatabaseSync(':memory:');
  const DB={prepare(sql){let params=[];const statement=sqlite.prepare(sql);return {
    bind(...values){params=values;return this;},async first(){return statement.get(...params)||null;},
    async run(){return {meta:statement.run(...params)};},async all(){return {results:statement.all(...params)};}
  };},async batch(statements){sqlite.exec('BEGIN');try{const out=[];for(const s of statements)out.push(await s.run());sqlite.exec('COMMIT');return out;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
  return {sqlite,DB};
}
function migrate(sqlite,names=migrations){for(const name of names)sqlite.exec(readFileSync(new URL(name,migrationDir),'utf8'));}

function verifyUpgrade(){
  const {sqlite}=database();
  try{
    migrate(sqlite,migrations.filter(n=>!n.startsWith('0011_')));
    const at='2026-09-13T01:00:00.000Z';
    sqlite.prepare('INSERT INTO ranking_settlements VALUES (?,?,?)').run('upgrade-settlement',at,'upgrade');
    const insert=sqlite.prepare('INSERT INTO ranking_members (member_id,name,points,seed,rank,previous_rank,previous_points,attendance,wins,losses,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
    insert.run('upgrade-up','복구 대상',35,'E+',2,2,30,1,4,0,at);
    insert.run('upgrade-floor','최저점 대상',17,'E-',3,3,20,1,0,4,at);
    insert.run('upgrade-idle','미참가',20,'E',4,4,20,0,0,0,at);
    insert.run('upgrade-reset','초기화됨',40,'D',1,1,40,1,1,0,'2026-09-13T02:00:00.000Z');
    const event=sqlite.prepare('INSERT INTO ranking_events (schedule_id,member_id,attendance_points,win_points,loss_points,total_points,points_before,points_after,rank_before,rank_after,seed_before,seed_after,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)');
    event.run('upgrade-settlement','upgrade-up',1,4,0,5,30,35,5,2,'E+','E+',at);
    event.run('upgrade-settlement','upgrade-floor',1,0,4,-3,20,17,3,4,'E','E-',at);
    event.run('upgrade-settlement','upgrade-reset',1,1,0,2,38,40,5,1,'E+','D',at);
    sqlite.prepare('INSERT INTO guests (guest_id,name,points,previous_points,created_at) VALUES (?,?,?,?,?)').run('upgrade-guest','기존 저점 게스트',17,17,at);
    migrate(sqlite,migrations.filter(n=>n.startsWith('0011_')));
    const up=sqlite.prepare('SELECT * FROM ranking_members WHERE member_id=?').get('upgrade-up');
    assert.equal(up.rank_movement,3,'이관으로 사라진 화살표를 정산 이력에서 복구');
    const floor=sqlite.prepare('SELECT * FROM ranking_members WHERE member_id=?').get('upgrade-floor');
    assert.equal(floor.points,20);assert.equal(floor.seed,'E');assert.equal(floor.rank_protected,1);assert.equal(floor.rank_movement,0);
    assert.ok(floor.rank>sqlite.prepare('SELECT rank FROM ranking_members WHERE member_id=?').get('upgrade-idle').rank);
    assert.equal(sqlite.prepare('SELECT rank_movement FROM ranking_members WHERE member_id=?').get('upgrade-reset').rank_movement,0,'초기화된 주간 화살표를 되살리지 않음');
    assert.equal(sqlite.prepare('SELECT points FROM guests WHERE guest_id=?').get('upgrade-guest').points,20);
    assert.equal(sqlite.prepare('SELECT points_after FROM ranking_events WHERE member_id=?').get('upgrade-floor').points_after,17,'과거 정산 원본 보존');
  }finally{sqlite.close();}
}

export async function runRankingProtectionChecks(){
  verifyUpgrade();
  const {sqlite,DB}=database();migrate(sqlite);
  const env={DB,EDITOR_KEY:'regression-fixture-key'},origin='https://local-ranking.test';
  async function request(path,method='GET',body){
    return worker.fetch(new Request(origin+path,{method,headers:{'content-type':'application/json','x-kokkiri-editor':env.EDITOR_KEY},...(body===undefined?{}:{body:JSON.stringify(body)})}),env);
  }
  async function data(path,method,body){const response=await request(path,method,body);const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));return result;}
  async function add(name,type,points){return (await data('/api/people','POST',{name,type,points})).data;}
  const rankings=async()=> (await data('/api/rankings')).items;
  const byName=(rows,name)=>{const row=rows.find(r=>r.name===name);assert.ok(row,name);return row;};
  async function settle(id){const current=(await data('/api/posts/'+id)).data;return data('/api/posts/'+id+'/settle','POST',{version:current.version,operation:crypto.randomUUID()});}
  try{
    assert.ok((await rankings()).every(r=>r.points>=20));
    assert.ok((await data('/api/people')).people.filter(p=>p.type==='guest').every(p=>p.points>=20));
    assert.equal((await request('/api/people','POST',{name:'불가점수',type:'guest',points:19})).status,400);
    const up=await add('회귀 상승','member',29),high=await add('회귀 상위','member',80),down=await add('회귀 하락','member',30);
    const floor=await add('회귀 보호','member',20),equal=await add('회귀 20도달','member',21),guest=await add('회귀 게스트보호','guest',20);
    const random=await add('회귀 랜덤만','member',25),absent=await add('회귀 불참','member',22);
    const idle=await add('회귀 미참가','member',31),peer=await add('회귀 20유지','member',20);
    const topGuest=await add('회귀 이관상위','guest',500);
    const participants=[up,high,down,floor,equal,guest,random,absent];
    const matches=[[up.name,high.name,down.name,floor.name],[up.name,high.name,equal.name,guest.name]];
    const schedule={title:'순위·보호 회귀',names:participants.map(p=>p.name),participantIds:participants.map(p=>p.id),courts:2,rounds:3,absent:[absent.name],
      schedule:[{round:1,method:'balanced',g:[...matches,[up.name,high.name,down.name,absent.name]]},{round:2,method:'same',g:matches},{round:3,method:'random',g:[[up.name,down.name,high.name,random.name]]}],
      results:{'0-0':'a','0-1':'a','1-0':'a','1-1':'a'}};
    const id='rank-protection-regression';
    await data('/api/posts/'+id,'PUT',{kind:'schedule',version:0,operation:crypto.randomUUID(),data:schedule});
    const before=await rankings();
    await settle(id);
    let after=await rankings();
    const rising=byName(after,up.name),dropping=byName(after,down.name),protectedRow=byName(after,floor.name);
    assert.ok(rising.rank_movement>0);assert.ok(dropping.rank_movement<0);
    assert.equal(rising.rank_movement,byName(before,up.name).rank-rising.rank);
    assert.equal(byName(after,idle.name).rank_movement,0,'순위가 밀려도 미참가자는 화살표 없음');
    assert.notEqual(byName(before,idle.name).rank,byName(after,idle.name).rank);
    assert.equal(byName(after,random.name).rank_movement,0,'랜덤만 참여하여 출석만 반영되면 화살표 없음');
    assert.equal(byName(after,absent.name).rank_movement,0,'불참·무효 경기 제외');
    for(const name of [floor.name,equal.name]){
      const row=byName(after,name);assert.equal(row.points,20);assert.equal(row.seed,'E');assert.equal(row.rank_protected,1);assert.equal(row.rank_movement,0);
      assert.ok(row.rank>byName(after,peer.name).rank,'보호 대상은 기존 20점 그룹 아래');
    }
    assert.equal(protectedRow.losses,2,'점수 보호와 별개로 실제 패 기록 유지');
    assert.equal(sqlite.prepare('SELECT total_points FROM ranking_events WHERE schedule_id=? AND member_id=?').get(id,floor.id).total_points,0,'실제로 차감된 점수만 이력에 기록');
    assert.equal(sqlite.prepare('SELECT total_points FROM ranking_events WHERE schedule_id=? AND member_id=?').get(id,equal.id).total_points,-1);
    const protectedGuest=(await data('/api/people')).people.find(p=>p.id===guest.id);
    assert.equal(protectedGuest.points,20);assert.equal(protectedGuest.rank_protected,1);assert.equal(protectedGuest.losses,2);
    await data('/api/posts/'+id+'/unsettle','POST',{});
    const undone=await rankings();
    assert.deepEqual(undone.map(r=>r.member_id),before.map(r=>r.member_id),'마감 취소 시 보호 이전 동점 순서까지 복원');
    for(const p of participants.filter(p=>p.type==='member')){
      const row=byName(undone,p.name);assert.equal(row.points,p.points,'마감 취소 점수 복원');assert.equal(row.rank_protected,0);assert.equal(row.rank_movement,0);assert.equal(row.floor_protected_at,null);
    }
    await settle(id);
    const beforePromotion=await rankings();
    await data('/api/people/promote','POST',{ids:[topGuest.id,guest.id]});
    after=await rankings();
    for(const old of beforePromotion){const row=byName(after,old.name);assert.equal(row.rank_movement,old.rank_movement,'이관 후 기존 화살표 유지');assert.equal(row.rank_protected,old.rank_protected);assert.equal(row.previous_rank,old.previous_rank);}
    assert.notEqual(byName(after,up.name).rank,byName(beforePromotion,up.name).rank,'이관 후 현재 순위는 새 명단대로 변경');
    assert.equal(byName(after,topGuest.name).rank_movement,0,'회원 순위의 이전 기준이 없는 신규 이관자는 화살표 없음');
    assert.equal(byName(after,guest.name).rank_protected,1,'게스트의 보호 상태도 회원으로 이관');
    const another=await add('회귀 신규최상위','member',600);
    assert.equal(byName(await rankings(),up.name).rank_movement,byName(beforePromotion,up.name).rank_movement);
    await data('/api/people/hide','POST',{ids:[another.id]});
    assert.equal(byName(await rankings(),up.name).rank_movement,byName(beforePromotion,up.name).rank_movement);
    await data('/api/posts/'+id+'/unsettle','POST',{});
    const promotedUndone=byName(await rankings(),guest.name);
    assert.equal(promotedUndone.points,20);assert.equal(promotedUndone.wins,0);assert.equal(promotedUndone.losses,0);assert.equal(promotedUndone.attendance,0);assert.equal(promotedUndone.rank_protected,0);
    await settle(id);
    const orderBeforeReset=(await rankings()).map(r=>r.member_id);
    await data('/api/posts/next-protection-regression','PUT',{kind:'schedule',version:0,operation:crypto.randomUUID(),data:{...schedule,results:{}}});
    const reset=await rankings();
    assert.ok(reset.every(r=>r.rank_movement===0&&r.rank_protected===0&&r.attendance===0));
    assert.deepEqual(reset.map(r=>r.member_id),orderBeforeReset,'새 정모 시작은 표시만 초기화, 보호 후 순서 유지');
    assert.ok(reset.every(r=>r.points>=20));
    console.log('PASS: ranking arrows survive promotion/add/remove; scored participants only; minimum 20, protected tie order, exact undo, migration recovery and weekly reset.');
  }finally{sqlite.close();}
}
