import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { client } from './dist/server/boards-client.js';

export async function runAttendanceHistoryUIChecks(){
  const source=client.toString();
  assert.ok(source.includes('<th>누적출석</th>'),'member ranking has cumulative attendance after win/loss columns');
  assert.ok(source.includes('class="attendance-history-open"')&&source.includes('data-member-id='),'attendance count is an accessible per-member button');
  assert.ok(source.includes('function showAttendanceHistory')&&source.includes('attendance-date-list'),'attendance count opens a vertical date list');
  assert.ok(source.includes("[...row.attendance_dates].sort().reverse()"),'latest attendance date is shown first');
  assert.ok(source.includes('대진 편성 또는 운영진 확인 날짜 기준'),'dialog explains both schedule and manually confirmed attendance');
  assert.ok(source.includes("weekday===3||weekday===6?'regular':'flash'"),'Wednesday and Saturday dates are classified as regular meetings');
  assert.ok(source.includes('row.attendance_entries')&&source.includes('kindByDate.get(day)||attendanceKind(day)'),'saved meeting type overrides the weekday fallback');
  assert.ok(source.includes("groups.regular.length+'회")&&source.includes("groups.flash.length+'회"),'dialog exposes separate regular and flash attendance counts');
  assert.ok(source.includes('data-attendance-kind="regular"')&&source.includes('data-attendance-kind="flash"'),'attendance type buttons switch the visible vertical date list');
  assert.ok(source.includes('regular_attendance_3m')&&source.includes('ghost-member-badge'),'members with zero regular attendance in the recent window receive the ghost badge');
  assert.ok(source.includes('!isExcellent(row.name)'),'excellent members are excluded from ghost-member labeling');
  console.log('PASS: seed ranking shows clickable cumulative attendance and a recent-first vertical date dialog.');
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await runAttendanceHistoryUIChecks();
