import assert from 'node:assert/strict';
import { createScoreHistory,scoreHistoryModel } from './dist/server/score-history-client.js';

class FakeNode{
  constructor(dialog){this.dialog=dialog;this.onclick=null;this.listeners={};}
  querySelector(selector){return this.dialog.nodeFor(selector);}
  querySelectorAll(selector){return selector==='[data-score-history-close]'?[this.dialog.nodeFor(selector),this.dialog.nodeFor(selector)]:[];}
  addEventListener(type,listener){this.listeners[type]=listener;}
}
class FakeScroller extends FakeNode{
  constructor(dialog){super(dialog);this.scrollLeft=0;this.clientWidth=1000;this.scrollWidth=1000*Math.max(1,(dialog.innerHTML.match(/<section class="score-history-segment"/g)||[]).length);}
  scrollTo({left}){this.scrollLeft=left;}
  fireScroll(){this.listeners.scroll?.();}
}
class FakeDialog{
  constructor(){this.open=false;this._html='';this.root=null;this.scroller=null;this.nodes={};}
  set innerHTML(value){this._html=String(value);const match=this._html.match(/data-score-history-owner="(\d+)"/);this.root=match?new FakeNode(this):null;this.scroller=match?new FakeScroller(this):null;this.nodes={};}
  get innerHTML(){return this._html;}
  showModal(){this.open=true;}
  close(){this.open=false;}
  querySelector(selector){if(selector.startsWith('[data-score-history-owner='))return this.open&&this.root?this.root:null;return this.nodeFor(selector);}
  nodeFor(selector){if(selector==='.score-history-scroll')return this.scroller;return this.nodes[selector]||(this.nodes[selector]=new FakeNode(this));}
}
const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;');
const segment=(from,index,hasOlder=true)=>({person:{id:'member-1',type:'member',name:'테스터',points:60,seed:'C'},range:{from,to:new Date(new Date(from).getTime()+140*86400000).toISOString()},points:[{id:'p-'+index,at:new Date(new Date(from).getTime()+70*86400000).toISOString(),before:59+index,points:60+index,kind:index?'settlement':'current',seed:'C'}],carry:{id:'carry-'+index,at:new Date(new Date(from).getTime()-1).toISOString(),points:59+index},hasOlder,nextBefore:hasOlder?from:'',recordedFrom:'2023-01-01T00:00:00.000Z'});

export async function runScoreHistoryUIChecks(){
  const injectedFactory=new Function('return ('+createScoreHistory.toString()+')')();
  const sorted=scoreHistoryModel({range:{from:'2026-01-01T00:00:00Z',to:'2026-05-21T00:00:00Z'},points:[{id:'baseline',at:'2026-02-01T00:00:00Z',before:null,points:20},{id:'event',at:'2026-02-01T00:00:00Z',before:20,points:21},{id:'current',at:'2026-02-01T00:00:00Z',before:21,points:21},{id:'old',at:'2026-01-02T00:00:00Z',points:19}]});
  assert.deepEqual(sorted.points.map(p=>p.id),['old','baseline','event','current'],'같은 시각의 기준·변경·현재 기록은 서버 입력 순서를 보존해야 합니다');assert.equal(sorted.points[1].before,null,'null 이전 점수는 0점으로 바뀌면 안 됩니다');
  const dialog=new FakeDialog(),pages=[];for(let i=0;i<8;i++)pages.push(segment(new Date(Date.UTC(2026,0,1)-i*140*86400000).toISOString(),i,i<7));for(let i=1;i<pages.length;i++)assert.equal(pages[i].range.to,pages[i-1].range.from,'이전 20주 구간은 바로 다음 20주 구간에 정확히 이어져야 합니다');
  pages[0].points[0].before=null;
  let calls=0,allowed=true;const api=async()=>pages[calls++];const view=injectedFactory({dialog,api,esc,isAllowed:()=>allowed,notify:()=>{}});
  await view.open('member','member-1');assert.match(dialog.innerHTML,/최근 20주/);assert.doesNotMatch(dialog.innerHTML,/1년/);assert.match(dialog.innerHTML,/기록을 글로 보기/);assert.match(dialog.innerHTML,/변동 기준 없음/);assert.doesNotMatch(dialog.innerHTML,/변동 기준 없음점/);assert.match(dialog.innerHTML,/id="pickerTitle"/);
  dialog.scroller.scrollLeft=420;dialog.querySelector('.score-history-details').open=true;const point={dataset:{scoreHistorySegment:'0',scoreHistoryPoint:'p-0'},closest:()=>point};dialog.root.listeners.click({target:point});await Promise.resolve();assert.equal(dialog.scroller.scrollLeft,420,'점 선택 후에는 현재 가로 위치를 유지해야 합니다');assert.match(dialog.innerHTML,/<details class="score-history-details" open>/,'그래프 재배치 중 펼쳐 둔 텍스트 기록을 닫지 않습니다');
  dialog.root.querySelector('[data-score-history-older]').onclick?.();await Promise.resolve();await Promise.resolve();assert.equal(dialog.scroller.scrollLeft,0,'처음 이전 20주 보기 뒤에는 새로 추가한 이전 구간을 바로 보여야 합니다');
  dialog.scroller.scrollLeft=0;dialog.scroller.fireScroll();await Promise.resolve();await Promise.resolve();assert.equal(dialog.scroller.scrollLeft,1000,'왼쪽 제스처로 추가할 때는 현재 가로 위치를 보존해야 합니다');
  for(let i=0;i<6;i++){dialog.scroller.scrollLeft=0;dialog.scroller.fireScroll();await Promise.resolve();await Promise.resolve();}
  assert.equal(calls,8,'3년 이상 기록은 20주 단위로 왼쪽에 추가 요청해야 합니다');assert.match(dialog.innerHTML,/p-7/);
  dialog.root.querySelector('[data-score-history-return]').onclick();
  assert.equal(dialog.root.querySelector('[data-score-history-older]').disabled,false,'더 불러올 이력이 없어도 이미 로드한 과거 구간으로 이동할 수 있어야 합니다');
  const latestLeft=dialog.scroller.scrollLeft;dialog.root.querySelector('[data-score-history-older]').onclick();assert.equal(dialog.scroller.scrollLeft,latestLeft-dialog.scroller.clientWidth,'과거 버튼은 한 구간씩 이동해야 합니다');assert.equal(calls,8,'이미 불러온 구간을 이동할 때 재요청하지 않습니다');
  const close=dialog.root.querySelector('[data-score-history-close]');close.onclick?.();assert.equal(dialog.open,false,'사용자가 닫은 팝업은 이후 응답으로 다시 열리지 않아야 합니다');
  const carryDialog=new FakeDialog(),carryView=injectedFactory({dialog:carryDialog,api:async()=>({...segment('2026-01-01T00:00:00.000Z',0,false),points:[]}),esc,isAllowed:()=>true,notify:()=>{}});await carryView.open('member','member-1');assert.match(carryDialog.innerHTML,/score-history-line/);assert.doesNotMatch(carryDialog.innerHTML,/기록 없음/,'이전 점수가 알려진 carry 전용 구간은 평평한 선으로 표시해야 합니다');
  const reopeningDialog=new FakeDialog();let releaseOlder;const slowOlder=new Promise(resolve=>{releaseOlder=resolve;});let reopenCalls=0;const reopenView=injectedFactory({dialog:reopeningDialog,api:()=>{const call=reopenCalls++;return call===0?Promise.resolve(segment('2026-01-01T00:00:00.000Z',0,true)):call===1?slowOlder:Promise.resolve({...segment('2026-06-01T00:00:00.000Z',9,false),points:[{id:'reopened',at:'2026-07-01T00:00:00.000Z',before:60,points:61,kind:'current'}]});},esc,isAllowed:()=>true,notify:()=>{}});await reopenView.open('member','member-1');reopeningDialog.scroller.scrollLeft=0;reopeningDialog.scroller.listeners.wheel({deltaX:-1,preventDefault(){}});reopeningDialog.root.querySelector('[data-score-history-close]').onclick?.();const reopen=reopenView.open('member','member-1');await reopen;releaseOlder({...segment('2025-01-01T00:00:00.000Z',8,false),points:[{id:'stale-older',at:'2025-02-01T00:00:00.000Z',before:50,points:51,kind:'settlement'}]});await Promise.resolve();await Promise.resolve();assert.match(reopeningDialog.innerHTML,/reopened/);assert.doesNotMatch(reopeningDialog.innerHTML,/stale-older/,'닫았다 다시 열면 이전 요청의 늦은 결과를 섞지 않아야 합니다');
  let resolveSlow;const slow=new Promise(resolve=>{resolveSlow=resolve;});const asyncView=injectedFactory({dialog,api:()=>slow,esc,isAllowed:()=>allowed,notify:()=>{}});const pending=asyncView.open('guest','guest-1');asyncView.stop();allowed=false;resolveSlow(segment('2026-01-01T00:00:00.000Z',0,false));await pending;assert.equal(dialog.innerHTML,'','로그아웃/중지 뒤 늦은 응답은 개인 그래프를 다시 그리지 않아야 합니다');
}
