import assert from 'node:assert/strict';
import { createScoreHistory,scoreHistoryModel } from './dist/server/score-history-client.js';

class FakeNode{
  constructor(dialog){this.dialog=dialog;this.onclick=null;this.listeners={};}
  querySelector(selector){return this.dialog.nodeFor(selector);}
  querySelectorAll(selector){return selector==='[data-score-history-close]'?[this.dialog.nodeFor(selector),this.dialog.nodeFor(selector)]:[];}
  addEventListener(type,listener){this.listeners[type]=listener;}
}
class FakeScroller extends FakeNode{
  constructor(dialog){super(dialog);this.scrollLeft=0;this.clientWidth=dialog.width||1000;this.scrollWidth=this.clientWidth*Math.max(1,(dialog.innerHTML.match(/<section class="score-history-segment"/g)||[]).length);}
  fireScroll(){this.listeners.scroll?.();}
}
class FakeDialog{
  constructor(){this.open=false;this._html='';this.root=null;this.scroller=null;this.nodes={};}
  set innerHTML(value){this._html=String(value);this.root=/data-score-history-owner="\d+"/.test(this._html)?new FakeNode(this):null;this.scroller=/class="score-history-scroll"/.test(this._html)?new FakeScroller(this):null;this.nodes={};}
  get innerHTML(){return this._html;}
  showModal(){this.open=true;}
  close(){this.open=false;}
  querySelector(selector){if(selector.startsWith('[data-score-history-owner='))return this.open&&this.root?this.root:null;return this.nodeFor(selector);}
  nodeFor(selector){if(selector==='.score-history-scroll')return this.scroller;return this.nodes[selector]||(this.nodes[selector]=new FakeNode(this));}
}
const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;');
const settlement=(id,at,before,points,scheduleId='schedule-'+id)=>({id,at,before,points,kind:'settlement',seed:'C',scheduleId});
const history=({recordedFrom=null,from='2026-05-02T15:00:00.000Z',to='2026-09-19T15:00:00.000Z',points=[],carry=null,hasOlder=false,current=60}={})=>({person:{id:'member-1',type:'member',name:'테스터',points:current,seed:'C'},range:{from,to},points,carry,hasOlder,nextBefore:hasOlder?from:'',recordedFrom});
const dots=html=>(html.match(/<circle class="score-history-point/g)||[]).length;
const ticks=html=>(html.match(/<text class="score-history-axis-label score-history-week-label(?: |")/g)||[]).length;
const pathD=html=>html.match(/<path class="score-history-line" d="([^"]+)"/i)?.[1]||'';

export async function runScoreHistoryUIChecks(){
  const injectedFactory=new Function('return ('+createScoreHistory.toString()+')')();
  const modeled=scoreHistoryModel({range:{from:'2026-01-01T00:00:00Z',to:'2026-05-21T00:00:00Z'},points:[settlement('late','2026-02-01T02:00:00.000Z',20,21),{id:'current',at:'2026-02-02T00:00:00.000Z',before:21,points:99,kind:'current'},{id:'manual',at:'2026-02-03T00:00:00.000Z',before:99,points:50,kind:'manual'},settlement('early','2026-01-02T00:00:00.000Z',19,20),{id:'bad',at:'nope',points:1,kind:'settlement'}],carry:{id:'old',at:'2025-12-01T00:00:00.000Z',before:18,points:19,kind:'settlement',seed:'C',scheduleId:'old'}});
  assert.deepEqual(modeled.points.map(p=>p.id),['early','late'],'그래프 모델은 유효한 대진 마감 결과만 실제 시각순으로 남깁니다');
  assert.equal(modeled.carry?.id,'old','이전 20주보다 앞선 실제 대진 마감 결과는 carry로 보존합니다');

  const emptyDialog=new FakeDialog(),emptyView=injectedFactory({dialog:emptyDialog,api:async()=>history({current:73}),esc,isAllowed:()=>true,notify:()=>{}});
  await emptyView.open('member','member-1');
  assert.match(emptyDialog.innerHTML,/아직 대진 마감 기록이 없습니다/);
  assert.match(emptyDialog.innerHTML,/현재 점수: 73점/);
  assert.equal(dots(emptyDialog.innerHTML),0,'미마감 인원은 현재 점수를 가짜 점으로 그리지 않습니다');
  assert.equal(ticks(emptyDialog.innerHTML),0,'미마감 인원은 과거 날짜 축이나 범위를 꾸며 내지 않습니다');
  assert.doesNotMatch(emptyDialog.innerHTML,/score-history-segment/);
  assert.doesNotMatch(emptyDialog.innerHTML,/그래프의 점을 누르면/,'마감 기록이 없으면 점 선택 안내도 표시하지 않습니다');
  emptyDialog.root.querySelector('[data-score-history-close]').onclick?.();assert.equal(emptyDialog.open,false,'빈 상태도 닫기 동작을 유지합니다');

  const oneAt='2026-09-19T01:03:00.000Z',oneData=history({recordedFrom:oneAt,points:[settlement('one',oneAt,60,62)],current:64});
  const oneDialog=new FakeDialog(),oneView=injectedFactory({dialog:oneDialog,api:async()=>oneData,esc,isAllowed:()=>true,notify:()=>{}});
  await oneView.open('member','member-1');
  assert.equal(dots(oneDialog.innerHTML),1,'한 번 마감한 인원은 실제 마감 점 하나만 표시합니다');
  assert.match(oneDialog.innerHTML,/대진 마감/);assert.match(oneDialog.innerHTML,/현재 점수: 64점/);
  assert.match(oneDialog.innerHTML,/2026년 9월 19일/);assert.match(oneDialog.innerHTML,/10:03/,'점의 접근성 레이블과 글 기록에는 실제 마감 시각을 씁니다');
  assert.match(oneDialog.innerHTML,/role="button"/);assert.match(oneDialog.innerHTML,/tabindex="0"/);

  const sameDay=history({recordedFrom:oneAt,points:[settlement('morning',oneAt,60,62,'schedule-am'),settlement('evening','2026-09-19T10:45:00.000Z',62,61,'schedule-pm')],current:70});
  const sameDialog=new FakeDialog(),sameView=injectedFactory({dialog:sameDialog,api:async()=>sameDay,esc,isAllowed:()=>true,notify:()=>{}});
  await sameView.open('member','member-1');
  assert.equal(dots(sameDialog.innerHTML),2,'같은 날 여러 대진을 마감해도 결과마다 점을 남깁니다');
  assert.match(sameDialog.innerHTML,/10:03/);assert.match(sameDialog.innerHTML,/07:45/,'같은 날의 각 점도 실제 마감 시각을 구분합니다');
  assert.doesNotMatch(sameDialog.innerHTML,/수동 수정|보관 기록|현재 점수<\/li>/,'조회·수동·현재 기록을 점 또는 글 이력으로 섞지 않습니다');
  assert.equal((pathD(sameDialog.innerHTML).match(/\bL\b/g)||[]).length,1,'두 실제 마감 점을 잇되 마지막 점에서 현재 시각까지 인위적으로 연장하지 않습니다');
  assert.match(sameDialog.innerHTML,/점은 실제 대진 마감 결과입니다/);

  const carry=settlement('carry','2026-04-10T01:00:00.000Z',55,58),carryData=history({recordedFrom:carry.at,points:[],carry,hasOlder:true,current:58});
  const carryDialog=new FakeDialog(),carryView=injectedFactory({dialog:carryDialog,api:async()=>carryData,esc,isAllowed:()=>true,notify:()=>{}});
  await carryView.open('member','member-1');
  assert.match(carryDialog.innerHTML,/score-history-line/);assert.equal(dots(carryDialog.innerHTML),0,'carry만 있는 페이지는 새 점을 만들지 않습니다');
  assert.equal((pathD(carryDialog.innerHTML).match(/\bL\b/g)||[]).length,1,'이전 페이지에서 이어지는 carry 선은 유지합니다');

  const recentFrom='2026-05-02T15:00:00.000Z',recent=history({recordedFrom:'2026-04-25T15:00:00.000Z',from:recentFrom,to:'2026-09-19T15:00:00.000Z',points:[settlement('recent','2026-09-19T01:00:00.000Z',60,61)],hasOlder:true,current:61});
  const older=history({recordedFrom:'2026-04-25T15:00:00.000Z',from:'2025-12-13T15:00:00.000Z',to:recentFrom,points:[settlement('older','2026-04-25T15:00:00.000Z',59,60)],current:61});
  const mobileDialog=new FakeDialog();mobileDialog.width=320;let calls=0;const mobileView=injectedFactory({dialog:mobileDialog,api:async()=>calls++?older:recent,esc,isAllowed:()=>true,notify:()=>{}});
  await mobileView.open('member','member-1');
  assert.match(mobileDialog.innerHTML,/최근 20주 대진 마감 결과/);assert.equal(ticks(mobileDialog.innerHTML),20,'최근 20주는 주간 축을 눈금으로만 유지합니다');
  assert.match(mobileDialog.innerHTML,/rotate\(-90/,'320px에서는 주간 눈금을 세로로 표시합니다');
  mobileDialog.root.querySelector('[data-score-history-older]').onclick?.();await Promise.resolve();await Promise.resolve();
  assert.equal(calls,2,'20주 이전은 기존처럼 별도 페이지로 불러옵니다');assert.equal(ticks(mobileDialog.innerHTML),21,'첫 실제 대진 마감이 든 과거 페이지는 앞의 빈 주를 자릅니다');
  assert.match(mobileDialog.innerHTML,/기록을 글로 보기/,'그래프를 쓰기 어려운 경우의 텍스트 기록을 유지합니다');

  const reopenDialog=new FakeDialog();let releaseOlder;const slowOlder=new Promise(resolve=>{releaseOlder=resolve;});let reopenCalls=0;
  const reopenView=injectedFactory({dialog:reopenDialog,api:()=>{const call=reopenCalls++;return call===0?Promise.resolve(recent):call===1?slowOlder:Promise.resolve(history({recordedFrom:oneAt,points:[settlement('reopened',oneAt,60,62)]}));},esc,isAllowed:()=>true,notify:()=>{}});
  await reopenView.open('member','member-1');reopenDialog.scroller.scrollLeft=0;reopenDialog.scroller.listeners.wheel({deltaX:-1,preventDefault(){}});reopenDialog.root.querySelector('[data-score-history-close]').onclick?.();await reopenView.open('member','member-1');releaseOlder(older);await Promise.resolve();await Promise.resolve();
  assert.match(reopenDialog.innerHTML,/reopened/);assert.doesNotMatch(reopenDialog.innerHTML,/data-score-history-point="older"/,'닫았다 다시 열면 이전 요청의 늦은 결과를 섞지 않습니다');
}
