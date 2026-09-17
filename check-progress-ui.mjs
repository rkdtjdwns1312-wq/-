import assert from 'node:assert/strict';
import { client } from './dist/server/boards-client.js';
import { createScheduleTools } from './dist/server/schedule-tools.js';

// Execute the shipped functions; only network, timers and DOM painting are mocked.
const source=client.toString();
function actual(name){
  const declarations=[...source.matchAll(/^  (?:async )?function (\w+)\(/gm)];
  const index=declarations.findIndex(m=>m[1]===name);
  assert.ok(index>=0,'Missing client function: '+name);
  return source.slice(declarations[index].index,declarations[index+1]?.index??source.length-1);
}
const functions=['detail','startDraft','currentDetail','startDetailPoll','refreshDetail','recordProgress','recordResult','saveResult'].map(actual).join('\n');
function fixture(){return {id:'ui-progress',kind:'schedule',version:1,title:'Fixture',names:['A','B','C','D'],courts:1,rounds:1,schedule:[{round:1,method:'same',g:[['A','B','C','D']],rest:[]}],results:{},matchProgress:{},settledAt:null};}
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
function harness(){
  return new Function('scheduleTools','server',`
    let draft=null,dirty=false,routeToken=1,detailRead=0,saving=false,recordingResult=false,viewRound=1,pollTimer=null;
    let nextTimer=0,html='',renders=0,paint='',winner=null,bindings=0,rosterSize=-1;
    const timers=new Map(),calls=[],messages=[],location={hash:'#post/'+server.id},dialog={open:false},EDITOR='';
    const setInterval=fn=>{const id=++nextTimer;timers.set(id,fn);return id;};
    const clearInterval=id=>timers.delete(id);
    const stopPoll=()=>{if(pollTimer){clearInterval(pollTimer);pollTimer=null;}};
    const app={get innerHTML(){return html;},set innerHTML(value){html=value;renders++;},querySelector:()=>null,querySelectorAll:()=>[]};
    const $=()=>null,crumb=()=>'',esc=s=>String(s??''),date=s=>String(s??''),scheduleHTML=(d,editing,showResults,roster)=>{rosterSize=Array.isArray(roster)?roster.length:-1;return '<matches />';};
    const message=(text,error)=>messages.push({text,error});
    let peopleImpl=async()=>[];
    const getPeople=force=>peopleImpl(force);
    const applyMatchState=(d,el,ri,mi,state)=>{paint=state;};
    const applyWin=(el,value)=>{winner=value;};
    const bindProgressControls=()=>{bindings++;};
    let apiImpl=async(path,options)=>{
      if(options?.method==='POST'){
        const input=JSON.parse(options.body);
        if(path.endsWith('/progress')){
          if(input.state==='waiting')delete server.matchProgress[input.key];else server.matchProgress[input.key]=input.state;
        }else{server.results[input.key]=input.winner;delete server.matchProgress[input.key];}
        return {data:{version:++server.version}};
      }
      return {data:structuredClone(server)};
    };
    const api=(path,options)=>{calls.push({path,options});return apiImpl(path,options);};
    ${functions}
    return {
      server,calls,messages,timers,recordProgress,recordResult,detail,startDraft,startDetailPoll,
      setAPI(fn){apiImpl=fn;},getAPI(){return apiImpl;},setPeople(fn){peopleImpl=fn;},
      snapshot(){return {draft,routeToken,saving,recordingResult,html,renders,paint,winner,bindings,pollTimer,rosterSize};},
      async tick(){const callback=timers.get(pollTimer);assertTimer(callback);await callback();}
    };
    function assertTimer(callback){if(!callback)throw Error('Polling was not restarted');}
  `)(createScheduleTools(),fixture());
}
const button=(winner='a')=>({dataset:{progressKey:'0-0',progressRound:'0',progressMatch:'0',progressNext:'playing',resultKey:'0-0',winner},closest:()=>({})});

export async function runProgressUIChecks(){
  for(const kind of ['progress','result']){
    const h=harness(),d=fixture(),normal=h.getAPI();
    h.setAPI((path,options)=>options?normal(path,options):Promise.reject(Error('GET offline')));
    await h[kind==='progress'?'recordProgress':'recordResult'](d,button(),1);
    assert.equal(d.version,2);
    assert.equal(h.snapshot().paint,kind==='progress'?'playing':'finished','successful POST is never rolled back by GET failure');
    assert.equal(kind==='progress'?d.matchProgress['0-0']:d.results['0-0'],kind==='progress'?'playing':'a');
    assert.equal(h.timers.size,1,'read failure restarts polling');
    await h.tick();assert.equal(h.timers.size,1,'repeated read failure keeps retry alive');
    h.setAPI(normal);await h.tick();
    assert.equal(h.snapshot().renders,1,'retry renders even when server version equals acknowledged POST version');
    assert.equal(h.timers.size,1);
    assert.equal(h.snapshot().saving,false);assert.equal(h.snapshot().recordingResult,false);
  }
  for(const kind of ['progress','result']){
    const h=harness(),d=fixture();
    d.matchProgress['0-0']='playing';
    const b=button();b.dataset.progressNext='waiting';
    h.setAPI(()=>Promise.reject(Error('POST rejected')));
    await h[kind==='progress'?'recordProgress':'recordResult'](d,b,1);
    assert.equal(h.snapshot().paint,'playing','failed POST restores original state');
    assert.equal(d.results['0-0'],undefined);assert.equal(d.matchProgress['0-0'],'playing');
    assert.ok(h.snapshot().bindings>0,'rollback restores button handlers');
  }
  for(const kind of ['progress','result']){
    const h=harness(),d=fixture(),post=deferred();
    h.setAPI(()=>post.promise);
    const pending=h[kind==='progress'?'recordProgress':'recordResult'](d,button(),1);
    h.startDraft(d);h.snapshot().draft.title='Unsaved editor title';
    post.resolve({data:{version:2}});await pending;
    assert.equal(h.snapshot().routeToken,2);
    assert.equal(h.snapshot().draft.title,'Unsaved editor title');
    assert.equal(h.calls.length,1,'old POST response cannot request a detail refresh after editing starts');
    assert.equal(h.snapshot().renders,0);assert.equal(h.timers.size,0);
  }
  {
    const h=harness(),d=fixture(),read=deferred(),roster=deferred();
    h.setAPI(()=>read.promise);h.setPeople(()=>roster.promise);
    const pending=h.detail(d.id,1);
    read.resolve({data:d});await Promise.resolve();h.startDraft(d);roster.resolve([]);await pending;
    assert.equal(h.snapshot().renders,0,'a detail whose roster read finishes after editing starts cannot overwrite an editor');
    assert.equal(h.timers.size,0);
  }
  {
    const h=harness(),d=fixture(),roster=d.names.map((name,index)=>({id:'p'+index,name,points:100-index}));d.participantIds=roster.map(p=>p.id);
    h.setPeople(async()=>roster);await h.detail(d.id,1);
    assert.equal(h.snapshot().rosterSize,4,'a direct schedule link passes its freshly read people to detail rendering');
  }
  {
    const h=harness(),d=fixture(),olderRoster=deferred(),freshRoster=d.names.map((name,index)=>({id:'p'+index,name,points:100-index}));let reads=0,rosters=0;
    h.setAPI(async()=>({data:{...d,version:++reads}}));h.setPeople(()=>++rosters===1?olderRoster.promise:Promise.resolve(freshRoster));
    const older=h.detail(d.id,1);await Promise.resolve();const latest=h.detail(d.id,1);await latest;olderRoster.resolve(freshRoster);await older;
    assert.equal(h.snapshot().renders,1,'a delayed roster response from an older detail request cannot overwrite the newer same-route detail');
    assert.equal(h.snapshot().rosterSize,4,'the newest detail keeps its own current roster');
  }
  {
    const h=harness(),d=fixture(),stale=d.names.map((name,index)=>({id:'p'+index,name,points:100-index}));
    h.setPeople(async()=>stale);await h.detail(d.id,1);
    h.setPeople(async()=>{throw Error('offline');});await h.detail(d.id,1);
    assert.equal(h.snapshot().renders,2,'a people read failure still renders the schedule detail');
    assert.equal(h.snapshot().rosterSize,0,'a people read failure never reuses stale roster points to claim no warning');
  }
  {
    const h=harness(),d=fixture(),post=deferred();
    h.setAPI(()=>post.promise);
    const pending=h.recordResult(d,button('a'),1);
    await h.recordResult(d,button('b'),1);await h.recordProgress(d,button(),1);
    assert.equal(h.calls.length,1,'result and progress clicks are mutually exclusive while saving');
    h.startDraft(d);post.resolve({data:{version:2}});await pending;
  }
  {
    const h=harness(),d=fixture(),post=deferred();
    h.setAPI(()=>post.promise);
    const pending=h.recordProgress(d,button(),1);
    await h.recordResult(d,button(),1);assert.equal(h.calls.length,1,'progress saving also blocks result clicks');
    h.startDraft(d);post.resolve({data:{version:2}});await pending;
  }
  {
    const h=harness(),d=fixture(),read=deferred(),roster=deferred();
    h.startDetailPoll(d,1);h.setAPI(()=>read.promise);h.setPeople(()=>roster.promise);
    const pending=h.tick();read.resolve({data:{...d,version:2}});await Promise.resolve();h.startDraft(d);roster.resolve([]);await pending;
    assert.equal(h.snapshot().renders,0);assert.equal(h.calls.length,2,'a pending poll may begin its detail refresh, but its roster read cannot overwrite the editor');
    assert.equal(h.timers.size,0);
  }
  {
    // Run client initialization and the real router with the optional fourth factory.
    const instrumented=source.replace(/  route\(\);\s*}$/, '  return {route,stopPoll};\n}');
    assert.notEqual(instrumented,source);
    const app={innerHTML:''},location={hash:'#live'},events=[];
    const platform={
      document:{getElementById:id=>id==='app'?app:id==='picker'?{}:null,createElement:()=>({textContent:''}),head:{append(){}},addEventListener(){}},
      window:{addEventListener(){}},location,history:{},setInterval:()=>1,clearInterval(){}
    };
    const initialize=new Function('platform','tools','factory',`const {document,window,location,history,setInterval,clearInterval}=platform;return (${instrumented})('fixture-editor','',tools,factory);`);
    initialize(platform,createScheduleTools,undefined); // Existing three-argument callers.
    let context;
    const view=initialize(platform,createScheduleTools,options=>{
      context=options;
      return {stop(){events.push('stop');},async open(token){assertCurrent(token);events.push('open');}};
      function assertCurrent(token){assert.ok(options.isCurrent(token));}
    });
    await view.route();assert.deepEqual(events,['stop','open']);
    assert.equal(context.app,app);assert.equal(typeof context.api,'function');
    location.hash='#home';assert.equal(context.isCurrent(1),false);
    view.stopPoll();assert.deepEqual(events,['stop','open','stop']);
  }
  console.log('PASS: actual progress/result UI functions preserve acknowledged writes, retry failed reads, protect editors and reject overlapping clicks.');
}
