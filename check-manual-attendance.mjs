import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync,readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { readAttendanceHistories } from './dist/server/attendance-history.js';

const snapshot=db=>JSON.stringify({
  members:db.prepare('SELECT member_id,points,attendance,wins,losses,rank,previous_rank,previous_points FROM ranking_members ORDER BY member_id').all(),
  guests:db.prepare('SELECT guest_id,points,attendance,wins,losses FROM guests ORDER BY guest_id').all(),
  events:db.prepare('SELECT * FROM ranking_events ORDER BY schedule_id,member_id').all()
});
const wrap=db=>({prepare(sql){const statement=db.prepare(sql);let params=[];return {bind(...values){params=values;return this;},async all(){return {results:statement.all(...params)};}};}});

export async function runManualAttendanceChecks(){
  const db=new DatabaseSync(':memory:'),files=readdirSync(new URL('./drizzle/',import.meta.url)).filter(name=>name.endsWith('.sql')).sort(),migration='0023_manual_attendance.sql';
  for(const name of files.filter(name=>name<migration))db.exec(readFileSync(new URL('./drizzle/'+name,import.meta.url),'utf8'));
  const before=snapshot(db),sql=readFileSync(new URL('./drizzle/'+migration,import.meta.url),'utf8');db.exec(sql);
  assert.equal(snapshot(db),before,'manual attendance migration must not change scores, wins, losses, ranks or score events');
  assert.equal(db.prepare('SELECT COUNT(*) count FROM manual_attendance').get().count,186);
  assert.equal(db.prepare('SELECT COUNT(DISTINCT attendance_date) count FROM manual_attendance').get().count,15);
  assert.deepEqual(db.prepare("SELECT attendance_date FROM manual_attendance WHERE person_name='동이' ORDER BY attendance_date").all().map(row=>row.attendance_date),['2026-08-08','2026-08-19','2026-08-26','2026-08-29','2026-09-02','2026-09-05','2026-09-09','2026-10-10']);
  assert.deepEqual(db.prepare("SELECT attendance_date FROM manual_attendance WHERE person_name='엽이' ORDER BY attendance_date").all().map(row=>row.attendance_date),['2026-08-26','2026-09-09','2026-11-01']);
  assert.deepEqual(db.prepare("SELECT attendance_date FROM manual_attendance WHERE person_name='피클렛' ORDER BY attendance_date").all().map(row=>row.attendance_date),['2026-09-06','2026-09-09']);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM manual_attendance WHERE attendance_date='2026-08-19' AND person_name='머우'").get().count,1);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM manual_attendance WHERE attendance_date='2026-08-29' AND person_name='현이'").get().count,1);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM manual_attendance WHERE person_name IN ('너을','따순','온도','동후','허니')").get().count,8,'live/future member names remain available for runtime matching');
  assert.ok(db.prepare("SELECT 1 FROM manual_attendance WHERE attendance_date='2026-09-02' AND person_name='네오' AND reported_name='네오'").get(),'corrected 네오 entry is stored');
  assert.throws(()=>db.prepare("INSERT INTO manual_attendance VALUES('2026-02-29','잘못된날짜','잘못된날짜','now')").run());
  assert.throws(()=>db.prepare("INSERT INTO manual_attendance VALUES('2026-99-09','잘못된월','잘못된월','now')").run());
  const members=db.prepare('SELECT member_id,name,promoted_guest_id FROM ranking_members WHERE hidden=0').all(),histories=await readAttendanceHistories(wrap(db),members);
  const byName=new Map(members.map(member=>[member.name,histories.get(member.member_id)]));
  for(const day of ['2026-08-26','2026-09-09','2026-11-01'])assert.ok(byName.get('엽이').includes(day));
  for(const day of ['2026-09-06','2026-09-09'])assert.ok(byName.get('피클렛').includes(day));
  const beforeReplay=JSON.stringify(db.prepare('SELECT * FROM manual_attendance ORDER BY attendance_date,person_name').all());db.exec(sql);assert.equal(JSON.stringify(db.prepare('SELECT * FROM manual_attendance ORDER BY attendance_date,person_name').all()),beforeReplay,'migration replay is idempotent');
  db.close();
  console.log('PASS: 15 dates/186 manual attendance rows, aliases/deduplication, score isolation, runtime union and idempotent migration.');
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await runManualAttendanceChecks();
