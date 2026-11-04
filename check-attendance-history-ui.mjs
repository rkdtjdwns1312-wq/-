import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { client } from './dist/server/boards-client.js';

export async function runAttendanceHistoryUIChecks(){
  const source=client.toString();
  assert.ok(source.includes('<th>누적출석</th>'),'member ranking has cumulative attendance after win/loss columns');
  assert.ok(source.includes('class="attendance-history-open"')&&source.includes('data-member-id='),'attendance count is an accessible per-member button');
  assert.ok(source.includes('function showAttendanceHistory')&&source.includes('attendance-date-list'),'attendance count opens a vertical date list');
  assert.ok(source.includes("[...row.attendance_dates].sort().reverse()"),'latest attendance date is shown first');
  assert.ok(source.includes('대진에 실제 편성된 날짜 기준'),'dialog explains the counting rule');
  console.log('PASS: seed ranking shows clickable cumulative attendance and a recent-first vertical date dialog.');
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await runAttendanceHistoryUIChecks();
