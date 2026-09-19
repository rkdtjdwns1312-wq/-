import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { operatorNavCss,operatorNavHtml } from './dist/server/operator-nav.js';

const expected=[['#home','홈'],['#notice','공지사항'],['#schedule','대진표'],['#live','실시간대진'],['#seed','시드현황']];

function staticAnchors(html){
  return [...html.matchAll(/<a\s+([^>]+)>([^<]*)<\/a>/g)].map(match=>{
    const attrs=Object.fromEntries([...match[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(([,name,value])=>[name,value]));
    return [attrs.href,match[2],attrs.class];
  });
}

export function runOperatorNavChecks(){
  for(const publicValue of [undefined,null,false,0,''])assert.equal(operatorNavHtml(publicValue),'','public pages have no operator navigation');

  const editor='operator-session-value-that-must-not-render';
  const html=operatorNavHtml(editor);
  assert.match(html,/^<nav class="operator-nav" aria-label="운영진 메뉴">/,'editor output is a labelled navigation landmark');
  assert.deepEqual(staticAnchors(html).map(([href,label])=>[href,label]),expected,'editor output has the five routes in the requested order');
  assert.ok(staticAnchors(html).every(([, ,className])=>className==='operator-nav-link'),'every static link has the navigation target class');
  assert.equal((html.match(/<a\b/g)||[]).length,5,'static HTML has exactly five anchors');
  assert.ok(!html.includes(editor),'editor value only gates rendering and is never interpolated');
  assert.ok(!/[<](?:script|style|form|input)\b/i.test(html),'static navigation adds no executable or stateful markup');

  assert.match(operatorNavCss,/\.operator-nav\{position:fixed;left:12px;top:50%;/,'desktop menu is fixed on the left rail');
  assert.match(operatorNavCss,/transform:translateY\(-50%\)/,'desktop menu is vertically centered');
  assert.match(operatorNavCss,/max-height:calc\(100dvh - 24px\);[\s\S]*overflow:auto/,'short viewports scroll the rail itself');
  assert.match(operatorNavCss,/body\.operator-layout\{padding-left:140px\}/,'desktop operator pages reserve rail space');
  assert.match(operatorNavCss,/min-width:44px;min-height:44px/,'links meet the 44px focus target size');
  assert.match(operatorNavCss,/@media\(max-width:650px\)[\s\S]*body\.operator-layout\{padding-left:78px\}[\s\S]*\.operator-nav\{left:6px;width:66px/,'mobile guard narrows both body rail and fixed menu');
  assert.match(operatorNavCss,/@media\(max-width:650px\)[\s\S]*\.operator-layout main \.matches\{grid-template-columns:minmax\(0,1fr\)\}/,'narrow operator content cannot retain a wide match grid');
  assert.match(operatorNavCss,/@media\(max-width:650px\)[\s\S]*\.operator-layout main\{padding:16px 8px\}[\s\S]*\.operator-layout main \.detail\{padding:12px 10px\}/,'mobile operator content uses the remaining rail width efficiently');
  assert.match(operatorNavCss,/\.operator-layout main \.round-head\{flex-wrap:wrap;gap:6px;padding:8px 10px\}[\s\S]*\.round-head h3\{white-space:nowrap;font-size:1rem\}/,'round titles wrap as a unit instead of character by character');
  assert.match(operatorNavCss,/\.operator-layout main \.match \.teams\{display:grid;grid-template-columns:minmax\(0,1fr\);gap:7px;justify-content:stretch\}/,'all mobile match teams, including editing cards, stack vertically');
  assert.match(operatorNavCss,/\.operator-layout main \.match \.team-wrap\{width:100%\}/,'editing and read-only team cards use the full narrow content width');
  assert.match(operatorNavCss,/\.operator-layout main \.match:not\(\.edit-match\) \.team\{flex-direction:row;flex-wrap:wrap;justify-content:center/,'team names can wrap in readable rows');
  assert.ok(!operatorNavCss.includes('dialog'),'fixed-layer dialogs keep their viewport-based sizing');
  assert.match(operatorNavCss,/\.operator-layout main \.edit-match \.team-wrap,[^\n]+\{grid-area:auto\}/,'mobile edit cards reset explicit three-column placement');
  assert.match(operatorNavCss,/\.operator-layout main \.edit-match \.vs-cluster\{display:flex\}/,'mobile edit winner controls form one centered row');
  console.log('PASS: operator navigation is static, editor-gated, route-ordered, fixed, accessible, and guarded for narrow viewports.');
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)runOperatorNavChecks();
