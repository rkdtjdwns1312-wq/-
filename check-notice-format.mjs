import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { client } from './dist/server/boards-client.js';

export async function runNoticeFormatChecks(){
  const source=client.toString();
  assert.ok(source.includes('function parseTable(start)'),'notice renderer recognizes structured tables');
  assert.ok(source.includes('class="notice-table-wrap"')&&source.includes('class="notice-table"'),'notice table has a responsive wrapper and semantic table');
  assert.ok(source.includes("rows[0].map(cell=>'<th scope=\"col\">'+esc(cell)"),'table headings are escaped');
  assert.ok(source.includes("row.map(cell=>'<td>'+esc(cell)"),'table cells are escaped');
  console.log('PASS: notice renderer safely formats responsive tables.');
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await runNoticeFormatChecks();
