import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import worker from './dist/server/index.js';

const migration=readFileSync(new URL('./drizzle/0020_active_people_names.sql',import.meta.url),'utf8');
function fixture(upgrade=true){
  const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');
  const migrate=sql=>{db.exec('BEGIN');try{db.exec(sql);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}};
  for(const file of readdirSync(new URL('./drizzle/',import.meta.url)).filter(n=>n.endsWith('.sql')&&n<'0020').sort())migrate(readFileSync(new URL('./drizzle/'+file,import.meta.url),'utf8'));
  if(upgrade)migrate(migration);
  let beforeBatch=null;
  const DB={prepare(sql){let params=[];const s=db.prepare(sql);return {
    bind(...values){assert.ok(values.length<=100);params=values;return this;},async first(){return s.get(...params)||null;},async all(){return {results:s.all(...params)};},async run(){return {meta:s.run(...params)};},
    execute(){return /^\s*(SELECT|WITH)\b/i.test(sql)?{results:s.all(...params)}:{meta:s.run(...params)};}
  };},async batch(statements){if(beforeBatch){const hook=beforeBatch;beforeBatch=null;await hook();}db.exec('BEGIN');try{const result=statements.map(s=>s.execute());db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}}};
  const env={DB,EDITOR_KEY:crypto.randomUUID()},origin='https://hidden-names.test';
  const call=(path,body,method=body===undefined?'GET':'POST')=>worker.fetch(new Request(origin+path,{method,headers:{origin,'content-type':'application/json','x-kokkiri-editor':env.EDITOR_KEY},...(body===undefined?{}:{body:JSON.stringify(body)})}),env);
  const data=async(path,body,method)=>{const response=await call(path,body,method),value=await response.json();assert.equal(response.status,200,JSON.stringify(value));return value.data||value;};
  const person=(type,id)=>db.prepare('SELECT * FROM '+(type==='member'?'ranking_members WHERE member_id=?':'guests WHERE guest_id=?')).get(id);
  const rename=(type,id,name)=>{const p=person(type,id);return call('/api/people/update',{id,type,name,points:p.points,expectedVersion:p.edit_version,reason:'로컬 이름 수정 검사'});};
  const create=(type,name,points=80)=>data('/api/people',{type,name,points});
  const archive=async(type,name)=>{const p=await create(type,name);await data('/api/people/hide',{ids:[p.id]});return p;};
  const tables=['ranking_members','guests','ranking_events','guest_events','ranking_settlements','people_changes','score_point_history','board_posts','roster_write_revision'];
  const snapshot=()=>JSON.stringify(tables.map(t=>[t,db.prepare('SELECT rowid AS _rowid_,* FROM '+t+' ORDER BY rowid').all()]));
  const schedule=async(id,p,ids=true)=>{
    const others=db.prepare('SELECT member_id AS id,name FROM ranking_members WHERE hidden=0 AND member_id<>? ORDER BY rank LIMIT 3').all(p.id);
    const names=[p.name,...others.map(r=>r.name)],participantIds=ids?[p.id,...others.map(r=>r.id)]:[];
    return data('/api/posts/'+id,{kind:'schedule',version:0,operation:crypto.randomUUID(),data:{title:'로컬 이름 검사',names,participantIds,courts:1,rounds:1,schedule:[{method:'same',g:[names]}],results:{'0-0':'a'}}},'PUT');
  };
  const settle=async id=>{const post=await data('/api/posts/'+id);return call('/api/posts/'+id+'/settle',{version:post.version,operation:crypto.randomUUID()});};
  return {db,env,call,data,person,rename,create,archive,snapshot,schedule,settle,migrate,set beforeBatch(fn){beforeBatch=fn;}};
}
async function accepted(response){const value=await response.json();assert.equal(response.status,200,JSON.stringify(value));return value.data;}
const exceptRename=p=>{const {name,edit_version,updated_at,...unchanged}=p;return unchanged;};

export async function runHiddenNameChecks(){
  // Rebuild a populated FK-linked database, preserving every value and rowid.
  {
    const h=fixture(false);try{
      const p=await h.create('member','마이그레이션 보존',99);await h.schedule('migration-history',p);await accepted(await h.settle('migration-history'));
      await h.data('/api/people/hide',{ids:[p.id]});const before=h.snapshot();
      h.migrate(migration);assert.equal(h.snapshot(),before,'migration preserves all business rows, IDs, rowids, scores, history and posts');
      assert.deepEqual(h.db.prepare('PRAGMA foreign_key_check').all(),[]);
      assert.equal(h.db.prepare('PRAGMA foreign_key_list(ranking_events)').get().table,'ranking_members');
      assert.equal(h.db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='trigger' AND name LIKE 'score_history_member_%'").get().n,2);
      h.migrate(migration);assert.equal(h.snapshot(),before,'migration replay does not fabricate score observations');
      const fresh=await h.create('member',p.name,99);assert.deepEqual(h.db.prepare('PRAGMA foreign_key_check').all(),[]);
      const afterReuse=h.snapshot();h.migrate(migration);assert.equal(h.snapshot(),afterReuse,'replay allows hidden/active duplicate names');
      assert.equal(h.db.prepare("SELECT count(*) AS n FROM score_point_history WHERE person_type='member' AND kind='initial' AND person_id=?").get(fresh.id).n,1,'restored insert trigger records new people exactly once');
      h.db.prepare('UPDATE ranking_members SET points=points+1 WHERE member_id=?').run(fresh.id);
      const change=h.db.prepare("SELECT points_before,points_after FROM score_point_history WHERE person_type='member' AND kind='change' AND person_id=?").get(fresh.id);
      assert.deepEqual({...change},{points_before:99,points_after:100},'restored update trigger remains functional after replay');
    }finally{h.db.close();}
  }
  {
    const h=fixture(false);try{
      const g=await h.create('guest','기존 활성 중복');
      h.db.prepare('INSERT INTO guests(guest_id,name,points,hidden) VALUES(?,?,80,0)').run('legacy-active-duplicate',g.name);
      const before=h.snapshot(),schema=h.db.prepare('SELECT name,sql FROM sqlite_master ORDER BY name').all();
      assert.throws(()=>h.migrate(migration),/UNIQUE/,'pre-existing active duplicates stop migration instead of being merged/deleted');
      assert.equal(h.snapshot(),before,'failed migration restores every record');
      assert.deepEqual(h.db.prepare('SELECT name,sql FROM sqlite_master ORDER BY name').all(),schema,'failed migration restores old constraints/triggers and leaves no staging tables');
      assert.deepEqual(h.db.prepare('PRAGMA foreign_key_check').all(),[]);
    }finally{h.db.close();}
  }
  // Synthetic versions of the two reported names, with all historical state retained.
  {
    const h=fixture();try{
      const hiddenM=await h.archive('member','박상'),hiddenG=await h.archive('guest','지성');
      const m=await h.create('member','박상.',99),g=await h.create('guest','지성.',101);
      h.db.prepare('UPDATE ranking_members SET attendance=1,wins=4,losses=0,rank_movement=2 WHERE member_id=?').run(m.id);
      h.db.prepare('UPDATE guests SET attendance=1,wins=1,losses=3 WHERE guest_id=?').run(g.id);
      const posted=await h.schedule('rename-retains-post',m);
      const prior={member:h.person('member',m.id),guest:h.person('guest',g.id),hiddenM:h.person('member',hiddenM.id),hiddenG:h.person('guest',hiddenG.id)};
      const audits=h.db.prepare('SELECT * FROM people_changes ORDER BY rowid').all(),scores=h.db.prepare('SELECT * FROM score_point_history ORDER BY id').all();
      await accepted(await h.rename('member',m.id,'박상'));await accepted(await h.rename('guest',g.id,'지성'));
      assert.deepEqual(exceptRename(h.person('member',m.id)),exceptRename(prior.member),'member name-only edit preserves points, seed, rank, movement and results');
      assert.deepEqual(exceptRename(h.person('guest',g.id)),exceptRename(prior.guest),'guest name-only edit preserves points and results');
      assert.deepEqual(h.person('member',hiddenM.id),prior.hiddenM);assert.deepEqual(h.person('guest',hiddenG.id),prior.hiddenG);
      assert.deepEqual(h.db.prepare('SELECT * FROM score_point_history ORDER BY id').all(),scores,'rename creates no score observation');
      assert.deepEqual(h.db.prepare('SELECT * FROM people_changes ORDER BY rowid LIMIT ?').all(audits.length),audits,'all old edit history remains byte-for-byte');
      assert.equal(h.db.prepare('SELECT count(*) AS n FROM people_changes').get().n,audits.length+2);
      assert.deepEqual(await h.data('/api/posts/rename-retains-post'),posted,'rename never rewrites archived labels or participant IDs');
      assert.equal((await h.rename('guest',g.id,'박상')).status,409,'cross-type active collision rejected');
      assert.equal((await h.rename('member',m.id,'지성')).status,409);
      for(const type of ['member','guest'])assert.equal((await h.call('/api/people',{type,name:'박상',points:50})).status,409);
      const stale=await h.call('/api/people/update',{id:m.id,type:'member',name:'이전 요청',points:99,expectedVersion:prior.member.edit_version,reason:'오래된 요청'});assert.equal(stale.status,409);
      const beforeScore=h.person('member',m.id).points;await accepted(await h.settle('rename-retains-post'));assert.equal(h.person('member',m.id).points,beforeScore+1,'explicit ID still scores after current-name rename');
      await h.data('/api/posts/rename-retains-post/unsettle',{});assert.equal(h.person('member',m.id).points,beforeScore,'undo still uses IDs');
      assert.deepEqual(h.person('member',hiddenM.id),prior.hiddenM);
    }finally{h.db.close();}
  }
  // Hidden records may belong to either table, including promotion archives.
  for(const oldType of ['member','guest'])for(const newType of ['member','guest']){
    const h=fixture();try{
      const old=await h.archive(oldType,'이름 재사용'),savedOld=h.person(oldType,old.id);
      const fresh=await h.create(newType,'이름 재사용');assert.ok(fresh.id!==old.id);assert.deepEqual(h.person(oldType,old.id),savedOld);
      if(newType==='guest'){
        await h.data('/api/people/promote',{ids:[fresh.id]});
        const promoted=h.db.prepare('SELECT * FROM ranking_members WHERE promoted_guest_id=?').get(fresh.id);
        assert.ok(promoted);assert.equal(promoted.points,fresh.points);assert.equal(h.person('guest',fresh.id).hidden,1);
        assert.deepEqual(h.person(oldType,old.id),savedOld);
      }
    }finally{h.db.close();}
  }
  // Existing active cross-type collisions (legacy/manual corruption) must also
  // block promotion. Same-kind uniqueness is enforced by partial indexes.
  {
    const h=fixture();try{
      const g=await h.create('guest','이관 중복'),m=await h.create('member','다른 회원');
      h.db.prepare('UPDATE ranking_members SET name=? WHERE member_id=?').run(g.name,m.id);
      const before=h.snapshot();assert.equal((await h.call('/api/people/promote',{ids:[g.id]})).status,409);assert.equal(h.snapshot(),before);
      assert.throws(()=>h.db.prepare('INSERT INTO guests(guest_id,name,points,hidden) VALUES(?,?,80,0)').run('same-kind',g.name),/UNIQUE/);
    }finally{h.db.close();}
  }
  // The roster-wide CAS closes create/update/promotion races across tables.
  for(const action of ['create','update','promote']){
    const h=fixture();try{
      let operation;
      if(action==='create')operation=()=>h.call('/api/people',{type:'member',name:'경합 이름',points:80});
      if(action==='update'){const p=await h.create('member','수정 전');operation=()=>h.rename('member',p.id,'경합 이름');}
      if(action==='promote'){const g=await h.create('guest','경합 이름');operation=()=>h.call('/api/people/promote',{ids:[g.id]});}
      let winner;
      h.beforeBatch=async()=>{
        if(action==='promote')await h.create('guest','독립 동시 변경');else await h.create('guest','경합 이름');
        winner=h.snapshot();
      };
      assert.equal((await operation()).status,409,action+' stale roster claim');assert.equal(h.snapshot(),winner,'losing '+action+' writes no row, audit or score history');
    }finally{h.db.close();}
  }
  {
    const h=fixture();try{
      const outcomes=await Promise.all(['member','guest'].map(type=>h.call('/api/people',{type,name:'동시 이름',points:80})));
      assert.deepEqual(outcomes.map(r=>r.status).sort(),[200,409]);
    }finally{h.db.close();}
  }
  // Name-only legacy data must not pick a new namesake. ID-based schedules keep
  // working, including renamed and promoted people; unknown adhoc IDs never fall back.
  for(const oldType of ['member','guest']){
    const h=fixture();try{
      const old=await h.create(oldType,'과거 이름');await h.schedule('legacy-reuse',old,false);await h.schedule('explicit-old',old,true);
      await h.data('/api/people/hide',{ids:[old.id]});const fresh=await h.create('member',old.name,85);
      const before=h.snapshot();
      assert.equal((await h.settle('legacy-reuse')).status,409);assert.equal(h.snapshot(),before,'ambiguous legacy settlement fails without any writes');
      const post=await h.data('/api/posts/legacy-reuse'),replacement=h.db.prepare('SELECT name FROM ranking_members WHERE hidden=0 AND member_id<>? ORDER BY rank DESC LIMIT 1').get(fresh.id).name;
      assert.equal((await h.call('/api/posts/legacy-reuse/substitute',{version:post.version,round:1,court:1,oldName:old.name,newName:replacement})).status,409);
      assert.equal(h.snapshot(),before,'legacy substitution cannot freeze an incorrect new identity');
      await accepted(await h.settle('explicit-old'));assert.equal(h.person('member',fresh.id).points,85,'hidden explicit old ID never credits namesake');
    }finally{h.db.close();}
  }
  {
    const h=fixture();try{
      const p=await h.create('member','변경 전 이름');await h.schedule('legacy-renamed',p,false);await accepted(await h.rename('member',p.id,'현재 이름'));
      const before=h.snapshot();assert.equal((await h.settle('legacy-renamed')).status,409);assert.equal(h.snapshot(),before,'known old nickname requires ID clarification instead of losing that score');
      const namesake=await h.create('guest','변경 전 이름');assert.equal((await h.settle('legacy-renamed')).status,409);assert.equal(h.person('guest',namesake.id).points,80,'edit history prevents reuse misattribution even without hidden rows');
    }finally{h.db.close();}
  }
  {
    const h=fixture();try{
      const g=await h.create('guest','이관 이름');await h.schedule('legacy-promotion',g,false);await h.data('/api/people/promote',{ids:[g.id]});
      const promoted=h.db.prepare('SELECT * FROM ranking_members WHERE promoted_guest_id=?').get(g.id);
      await accepted(await h.settle('legacy-promotion'));assert.equal(h.person('member',promoted.member_id).points,g.points+1,'promotion aliases represent one identity, not an ambiguous namesake');
    }finally{h.db.close();}
  }
  // A failed audit insertion must roll back the rename and all its side effects.
  {
    const h=fixture();try{
      await h.archive('member','원자적 이름');const p=await h.create('member','수정 대상');const before=h.snapshot();
      h.db.exec("CREATE TEMP TRIGGER reject_name_audit BEFORE INSERT ON people_changes BEGIN SELECT RAISE(ABORT,'injected audit failure'); END");
      const error=console.error;console.error=()=>{};try{assert.equal((await h.rename('member',p.id,'원자적 이름')).status,503);}finally{console.error=error;h.db.exec('DROP TRIGGER reject_name_audit');}
      assert.equal(h.snapshot(),before);await accepted(await h.rename('member',p.id,'원자적 이름'));
    }finally{h.db.close();}
  }
  console.log('PASS: active-only name uniqueness, hidden/history/score/rank preservation, FK-safe migration/replay, promotion, cross-table CAS races, atomic rollback and ID-safe legacy settlement/substitution.');
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await runHiddenNameChecks();
