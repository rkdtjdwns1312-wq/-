// Serialized into the page: keep all helpers inside this factory.
export function createScheduleInfo({root,esc,now=Date.now()}){
  const today=new Date(now+9*3600000).toISOString().slice(0,10);
  let year=Number(today.slice(0,4)),month=Number(today.slice(5,7)),date='',panel='';
  const $=id=>root.querySelector('#'+id),pad=n=>String(n).padStart(2,'0');
  const utc=(y,m,d)=>{const value=new Date(0);value.setUTCFullYear(y,m-1,d);value.setUTCHours(0,0,0,0);return value;};
  const weekdays=['일','월','화','수','목','금','토'];
  const dateLabel=()=>{if(!date)return '';const [y,m,d]=date.split('-').map(Number);return m+'월 '+d+'일('+weekdays[utc(y,m,d).getUTCDay()]+')';};
  root.innerHTML='<section class="schedule-info" aria-labelledby="scheduleInfoTitle"><h3 id="scheduleInfoTitle">대진 날짜와 장소</h3><div class="schedule-info-actions"><button type="button" id="scheduleDateButton" aria-expanded="false" aria-controls="scheduleDatePanel">날짜 선택하기</button><button type="button" id="scheduleVenueButton" aria-expanded="false" aria-controls="scheduleVenuePanel">장소 입력하기</button><button type="button" id="scheduleTimeButton" aria-expanded="false" aria-controls="scheduleTimePanel">시작시간</button></div><div id="scheduleDatePanel" class="schedule-info-panel" hidden><div id="scheduleCalendar" class="schedule-calendar"></div></div><div id="scheduleVenuePanel" class="schedule-info-panel" hidden><label for="scheduleVenue">장소<input id="scheduleVenue" type="text" maxlength="60" placeholder="예: 중앙체육관" autocomplete="off"></label></div><div id="scheduleTimePanel" class="schedule-info-panel" hidden><div class="schedule-time-fields"><label for="scheduleHour">시 (24시간제)<select id="scheduleHour" aria-label="시 (24시간제)"><option value="">시간 선택</option>'+Array.from({length:24},(_,n)=>'<option value="'+pad(n)+'">'+pad(n)+'시</option>').join('')+'</select></label><label for="scheduleMinute">분<select id="scheduleMinute" aria-label="분">'+Array.from({length:60},(_,n)=>'<option value="'+pad(n)+'">'+pad(n)+'분</option>').join('')+'</select></label></div></div><p class="schedule-title-preview" aria-live="polite">제목 미리보기<br><strong id="scheduleTitlePreview"></strong></p></section>';
  function values(){
    const venue=$('scheduleVenue').value.trim().replace(/\s+/g,' '),hour=$('scheduleHour').value,minute=$('scheduleMinute').value;
    return {venue,hour,minute};
  }
  function update(){
    const {venue,hour,minute}=values();
    $('scheduleDateButton').textContent=dateLabel()||'날짜 선택하기';
    $('scheduleTimeButton').textContent=hour?hour+':'+minute:'시작시간';
    $('scheduleTitlePreview').textContent=date&&venue&&hour?dateLabel()+' '+venue+' '+hour+':'+minute:'날짜·장소·시작시간을 선택해주세요.';
  }
  function show(next){
    panel=next;
    for(const name of ['Date','Venue','Time']){
      $( 'schedule'+name+'Panel').hidden=next!==name;
      $( 'schedule'+name+'Button').setAttribute('aria-expanded',String(next===name));
    }
    if(next==='Date'){if(date){year=Number(date.slice(0,4));month=Number(date.slice(5,7));}calendar();}
    if(next==='Venue')$('scheduleVenue').focus();
    if(next==='Time')$('scheduleHour').focus();
  }
  function calendar(){
    const offset=utc(year,month,1).getUTCDay(),days=utc(year,month+1,0).getUTCDate();
    $('scheduleCalendar').innerHTML='<div class="schedule-calendar-nav"><button type="button" id="schedulePrevMonth" aria-label="이전 달"'+(year===1&&month===1?' disabled':'')+'>‹</button><strong aria-live="polite">'+year+'년 '+month+'월</strong><button type="button" id="scheduleNextMonth" aria-label="다음 달"'+(year===9999&&month===12?' disabled':'')+'>›</button></div><div class="schedule-calendar-grid">'+weekdays.map(w=>'<span class="schedule-weekday">'+w+'</span>').join('')+'<span class="schedule-calendar-blank" aria-hidden="true"></span>'.repeat(offset)+Array.from({length:days},(_,index)=>{
      const day=index+1,key=String(year).padStart(4,'0')+'-'+pad(month)+'-'+pad(day);
      return '<button type="button" class="schedule-day'+(key===date?' selected':'')+(key===today?' today':'')+'" data-schedule-date="'+key+'" aria-label="'+year+'년 '+month+'월 '+day+'일 '+weekdays[utc(year,month,day).getUTCDay()]+'요일" aria-pressed="'+(key===date)+'"'+(key===today?' aria-current="date"':'')+'>'+day+'</button>';
    }).join('')+'</div>';
    $('schedulePrevMonth').onclick=()=>{if(year===1&&month===1)return;if(--month===0){month=12;year--;}calendar();$('schedulePrevMonth').focus();};
    $('scheduleNextMonth').onclick=()=>{if(year===9999&&month===12)return;if(++month===13){month=1;year++;}calendar();$('scheduleNextMonth').focus();};
    root.querySelectorAll('[data-schedule-date]').forEach(button=>button.onclick=()=>{date=button.dataset.scheduleDate;show('');update();$('scheduleDateButton').focus();});
  }
  for(const name of ['Date','Venue','Time'])$('schedule'+name+'Button').onclick=()=>show(panel===name?'':name);
  $('scheduleVenue').oninput=update;$('scheduleHour').onchange=update;$('scheduleMinute').onchange=update;
  $('scheduleVenue').onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();show('');$('scheduleVenueButton').focus();}};
  root.addEventListener('keydown',event=>{if(event.key==='Escape'&&panel){const name=panel;event.preventDefault();event.stopPropagation();show('');$('schedule'+name+'Button').focus();}});
  update();
  function read(){
    const {venue,hour,minute}=values();
    if(!date){show('Date');throw Error('대진 날짜를 선택해주세요.');}
    if(!venue||venue.length>60||/[\u0000-\u001f\u007f]/.test(venue)){show('Venue');throw Error('장소를 1~60자로 입력해주세요.');}
    if(!/^(?:[01]\d|2[0-3])$/.test(hour)||!/^\d{2}$/.test(minute)||Number(minute)>59){show('Time');throw Error('시작시간을 24시간제로 선택해주세요.');}
    return {title:dateLabel()+' '+venue+' '+hour+':'+minute};
  }
  return {read};
}
