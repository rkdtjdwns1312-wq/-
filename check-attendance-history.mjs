import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { readAttendanceHistories } from './dist/server/attendance-history.js';

function database(){
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec("CREATE TABLE people_changes(person_type TEXT,person_id TEXT,before_name TEXT,after_name TEXT); CREATE TABLE board_posts(id TEXT PRIMARY KEY,kind TEXT,payload TEXT,created_at TEXT); CREATE TABLE manual_attendance(attendance_date TEXT,person_name TEXT);");
  const DB={prepare(sql){let params=[];const statement=sqlite.prepare(sql);return {bind(...values){params=values;return this;},async all(){return {results:statement.all(...params)};}};}};
  return {sqlite,DB};
}
const game=(names,ids,date,played=names,absent=[])=>({title:'테스트 대진',scheduleDate:date,names,participantIds:ids,schedule:[{g:[played]}],absent});

export async function runAttendanceHistoryChecks(){
  const {sqlite,DB}=database(),members=[
    {member_id:'member-a',name:'하나',promoted_guest_id:null},
    {member_id:'member-b',name:'둘',promoted_guest_id:null},
    {member_id:'member-c',name:'새이름',promoted_guest_id:null},
    {member_id:'member-d',name:'승격회원',promoted_guest_id:'guest-promoted'}
  ];
  const change=sqlite.prepare('INSERT INTO people_changes VALUES(?,?,?,?)');
  change.run('member','member-c','옛이름','새이름');change.run('guest','guest-promoted','승격전','승격회원');
  change.run('member','member-a','겹친이름','하나');change.run('member','member-b','겹친이름','둘');
  const insert=sqlite.prepare("INSERT INTO board_posts VALUES(?, 'schedule', ?, ?)");
  const add=(id,payload,created='2026-10-01T04:00:00.000Z')=>insert.run(id,JSON.stringify(payload),created);
  add('direct',game(['하나','둘','게스트','대기만'],['member-a','member-b','guest-x','member-c'],'2026-10-01',['하나','둘','게스트'],['둘']));
  add('same-day',game(['하나'],['member-a'],'2026-10-01'));
  add('aliases',game(['옛이름','승격전','겹친이름','대기만'],[], '2026-10-02',['옛이름','승격전','겹친이름']));
  add('promoted-id',game(['승격회원'],['guest-promoted'],'2026-10-03'));
  add('another-day',game(['하나'],['member-a'],'2026-10-04'));
  add('unknown-day',{title:'날짜 없는 대진',names:['하나'],participantIds:['member-a'],schedule:[{g:[['하나']]}]},'2026-10-05T04:00:00.000Z');
  add('legacy-day',{title:'10월 6일 화요일 정모',names:['둘'],participantIds:['member-b'],schedule:[{g:[['둘']]}]},'2026-10-06T04:00:00.000Z');
  const manual=sqlite.prepare('INSERT INTO manual_attendance VALUES(?,?)');manual.run('2026-10-01','하나');manual.run('2026-10-07','하나');manual.run('2026-10-07','옛이름');manual.run('2026-10-07','승격전');manual.run('2026-10-07','게스트');manual.run('2026-10-07','겹친이름');
  try{
    const result=await readAttendanceHistories(DB,members);
    assert.deepEqual(result.get('member-a'),['2026-10-01','2026-10-04','2026-10-07'],'manual and schedule attendance are unioned once per day');
    assert.deepEqual(result.get('member-b'),['2026-10-06'],'absent member is excluded and legacy title date is resolved');
    assert.deepEqual(result.get('member-c'),['2026-10-02','2026-10-07'],'unique historical member name links manual attendance too');
    assert.deepEqual(result.get('member-d'),['2026-10-02','2026-10-03','2026-10-07'],'promoted guest history links schedules and manual attendance');
  }finally{sqlite.close();}
  console.log('PASS: cumulative attendance unions schedule/manual dates, excludes absences/bench/guests, and follows rename/promotion history.');
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await runAttendanceHistoryChecks();
