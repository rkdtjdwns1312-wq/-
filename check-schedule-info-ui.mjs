import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { createScheduleInfo } from './dist/server/schedule-info-client.js';

class Element {
  constructor(id='') { this.id=id; this.attributes={}; this.hidden=false; this.value=''; this.textContent=''; this._innerHTML=''; this.onclick=null; this.oninput=null; this.onchange=null; this.onkeydown=null; this.dataset={}; this.options=[]; this.focused=false; }
  setAttribute(name,value){this.attributes[name]=String(value);}
  getAttribute(name){return this.attributes[name]??null;}
  focus(){this.root.activeElement=this;}
  set innerHTML(html){this._innerHTML=html; if(this.id==='scheduleCalendar')this.root.parseCalendar(html); else if(this.id==='root')this.root.parseRoot(html);}
  get innerHTML(){return this._innerHTML??'';}
}

class Root extends Element {
  constructor(){super('root');this.root=this;this.elements=new Map();this.listeners={};this.activeElement=null;this.calendarDates=[];}
  get innerHTML(){return this._innerHTML??'';}
  set innerHTML(html){this._innerHTML=html;this.parseRoot(html);}
  make(id){let el=this.elements.get(id);if(!el){el=new Element(id);el.root=this;this.elements.set(id,el);}return el;}
  parseRoot(html){for(const [,id] of html.matchAll(/\bid="([^"]+)"/g)){const el=this.make(id);if(id==='scheduleVenue')el.maxLength=60;}
    for(const id of ['scheduleDatePanel','scheduleVenuePanel','scheduleTimePanel'])this.make(id).hidden=true;
    for(const id of ['scheduleDateButton','scheduleVenueButton','scheduleTimeButton'])this.make(id).setAttribute('aria-expanded','false');
    for(const [,attributes,body] of html.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/g)){
      const id=attributes.match(/\bid="([^"]+)"/)?.[1];if(!id)continue;
      const select=this.make(id);for(const [,name,value] of attributes.matchAll(/([\w-]+)="([^"]*)"/g))select.setAttribute(name,value);
      select.options=[...body.matchAll(/<option value="([^"]*)"/g)].map(match=>match[1]);
    }
  }
  parseCalendar(html){for(const id of ['schedulePrevMonth','scheduleNextMonth'])this.elements.delete(id);this.calendarDates=[];
    for(const match of html.matchAll(/<button type="button" id="(schedule(?:Prev|Next)Month)"[^>]*>([^<]*)<\/button>/g)){const el=this.make(match[1]);el.textContent=match[2];el.disabled=/ disabled>/.test(match[0]);}
    for(const match of html.matchAll(/<button type="button" class="schedule-day([^\"]*)" data-schedule-date="([^"]+)" aria-label="([^"]+)" aria-pressed="([^"]+)"([^>]*)>([^<]+)<\/button>/g)){const el=new Element('');el.root=this;el.className=match[1];el.dataset.scheduleDate=match[2];el.setAttribute('aria-label',match[3]);el.setAttribute('aria-pressed',match[4]);el.textContent=match[6];if(match[5].includes('aria-current="date"'))el.setAttribute('aria-current','date');this.calendarDates.push(el);}
  }
  querySelector(selector){return selector.startsWith('#')?this.elements.get(selector.slice(1))??null:null;}
  querySelectorAll(selector){return selector==='[data-schedule-date]'?this.calendarDates:[];}
  addEventListener(name,fn){this.listeners[name]=fn;}
  key(key){let prevented=false,stopped=false;this.listeners.keydown?.({key,preventDefault(){prevented=true;},stopPropagation(){stopped=true;}});return {prevented,stopped};}
  click(id){const el=this.querySelector('#'+id);assert.ok(el,`missing #${id}`);assert.equal(typeof el.onclick,'function',`#${id} should be clickable`);el.onclick();return el;}
  set(id,value,event='oninput'){const el=this.querySelector('#'+id);assert.ok(el,`missing #${id}`);el.value=value;el[event]?.();return el;}
}

const esc=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const makeNow=(year,month,day,hour=12)=>{const d=new Date(0);d.setUTCFullYear(year,month-1,day);d.setUTCHours(hour,0,0,0);return d.getTime();};
const mount=(date)=>{const root=new Root();const api=createScheduleInfo({root,esc,now:makeNow(...date)});return {root,api};};
const showDate=root=>root.click('scheduleDateButton');
const choose=(root,date)=>{const day=root.calendarDates.find(el=>el.dataset.scheduleDate===date);assert.ok(day,`calendar should contain ${date}`);day.onclick();};
const monthLabel=root=>root.querySelector('#scheduleCalendar').innerHTML.match(/<strong[^>]*>([^<]+)<\/strong>/)?.[1];

export function runScheduleInfoUIChecks(){
  // KST date selection starts on the local month, including UTC month/year rollover.
  const {root,api}=mount([2024,1,31,16]);
  assert.ok(root.innerHTML.includes('<h3 id="scheduleInfoTitle">대진 날짜와 장소</h3>'));
  assert.deepEqual(['scheduleDateButton','scheduleVenueButton','scheduleTimeButton'].map(id=>root.elements.has(id)),[true,true,true]);
  const order=['scheduleDateButton','scheduleVenueButton','scheduleTimeButton'].map(id=>root.innerHTML.indexOf(`id="${id}"`));assert.ok(order[0]<order[1]&&order[1]<order[2],'picker buttons should appear date, place, time');
  showDate(root);assert.equal(monthLabel(root),'2024년 2월');

  // Month navigation crosses both sides of a year boundary.
  root.click('schedulePrevMonth');assert.equal(monthLabel(root),'2024년 1월');
  root.click('scheduleNextMonth');root.click('scheduleNextMonth');assert.equal(monthLabel(root),'2024년 3월');
  const jan=mount([2025,1,3]);showDate(jan.root);assert.equal(monthLabel(jan.root),'2025년 1월');jan.root.click('schedulePrevMonth');assert.equal(monthLabel(jan.root),'2024년 12월');
  jan.root.click('scheduleNextMonth');jan.root.click('scheduleNextMonth');assert.equal(monthLabel(jan.root),'2025년 2월');

  // Leap day, selected state, weekday label, and panel close after date choice.
  const leap=mount([2024,2,8]);showDate(leap.root);assert.equal(leap.root.calendarDates.length,29);
  const leapDay=leap.root.calendarDates.find(el=>el.dataset.scheduleDate==='2024-02-29');assert.match(leapDay.getAttribute('aria-label'),/목요일/);
  choose(leap.root,'2024-02-29');assert.equal(leap.root.querySelector('#scheduleDatePanel').hidden,true);assert.equal(leap.root.querySelector('#scheduleDateButton').textContent,'2월 29일(목)');
  showDate(leap.root);const selected=leap.root.calendarDates.find(el=>el.dataset.scheduleDate==='2024-02-29');assert.match(selected.className,/selected/);assert.equal(selected.getAttribute('aria-pressed'),'true');

  // Every valid dropdown endpoint is present, while blank/invalid values are rejected.
  const hour=leap.root.querySelector('#scheduleHour'),minute=leap.root.querySelector('#scheduleMinute');
  assert.equal(hour.getAttribute('aria-label'),'시 (24시간제)');assert.equal(minute.getAttribute('aria-label'),'분');
  assert.equal(hour.options.length,25);assert.equal(hour.options[0],'');assert.equal(hour.options[1],'00');assert.equal(hour.options.at(-1),'23');
  assert.equal(minute.options.length,60);assert.equal(minute.options[0],'00');assert.equal(minute.options.at(-1),'59');
  assert.throws(()=>leap.api.read(),/장소/);
  leap.root.set('scheduleVenue','중앙체육관');assert.throws(()=>leap.api.read(),/시작시간/);
  leap.root.set('scheduleHour','00','onchange');leap.root.set('scheduleMinute','00','onchange');
  assert.equal(leap.api.read().title,'2월 29일(목) 중앙체육관 00:00');
  leap.root.set('scheduleHour','23','onchange');leap.root.set('scheduleMinute','59','onchange');
  assert.equal(leap.api.read().title,'2월 29일(목) 중앙체육관 23:59');
  leap.root.set('scheduleHour','24','onchange');assert.throws(()=>leap.api.read(),/시작시간/);
  leap.root.set('scheduleHour','23','onchange');leap.root.set('scheduleMinute','60','onchange');assert.throws(()=>leap.api.read(),/시작시간/);

  // Place is trimmed and normalized; preview uses textContent so markup stays literal.
  leap.root.set('scheduleMinute','59','onchange');leap.root.set('scheduleVenue','  <b>중앙</b>   체육관  ');
  assert.equal(leap.api.read().title,'2월 29일(목) <b>중앙</b> 체육관 23:59');
  assert.equal(leap.root.querySelector('#scheduleTitlePreview').textContent,'2월 29일(목) <b>중앙</b> 체육관 23:59');
  leap.root.set('scheduleVenue','x'.repeat(60));assert.equal(leap.api.read().title,'2월 29일(목) '+'x'.repeat(60)+' 23:59');
  leap.root.set('scheduleVenue','x'.repeat(61));assert.throws(()=>leap.api.read(),/1~60자/);

  // Escape closes the active panel but retains the values and selected date.
  leap.root.set('scheduleVenue','  체육관  ');
  const escape=leap.root.key('Escape');assert.equal(escape.prevented,true);assert.equal(escape.stopped,true);
  assert.equal(leap.root.querySelector('#scheduleVenuePanel').hidden,true);assert.equal(leap.root.querySelector('#scheduleVenue').value,'  체육관  ');
  assert.equal(leap.root.querySelector('#scheduleDateButton').textContent,'2월 29일(목)');
  assert.equal(leap.api.read().title,'2월 29일(목) 체육관 23:59');

  // A new factory instance starts without a date or place from an earlier instance.
  const fresh=mount([2024,2,8]);assert.throws(()=>fresh.api.read(),/날짜/);showDate(fresh.root);assert.equal(fresh.root.calendarDates.length,29);
  return true;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){runScheduleInfoUIChecks();console.log('schedule-info UI checks: PASS');}
