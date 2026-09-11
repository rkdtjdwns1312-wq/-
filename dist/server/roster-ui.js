export function installRoster(people) {
  const selected = new Set();
  let active = 'member';
  const field = document.getElementById('members').closest('label');
  field.hidden = true;
  field.nextElementSibling.textContent = '회원과 게스트 탭에서 이번 참가자를 선택하세요. 시드는 명단 표시용입니다.';
  const host = document.getElementById('choices');
  const tools = document.createElement('div');
  tools.innerHTML = '<div class="roster-tabs" role="tablist" aria-label="참가자 구분"><button type="button" id="memberTab" role="tab" aria-controls="choices">회원</button><button type="button" id="guestTab" role="tab" aria-controls="choices">게스트</button></div><label>이름 검색<input id="rosterSearch" type="search" placeholder="이름으로 찾기"></label><p id="selectionCount" aria-live="polite"></p>';
  host.before(tools);
  host.setAttribute('role','tabpanel');
  const clear = document.createElement('button');
  clear.type = 'button'; clear.textContent = '전체 선택 해제';
  document.getElementById('all').after(clear);
  const count = () => {
    const m = people.filter(p=>p.type==='member' && selected.has(p.id)).length;
    const g = people.filter(p=>p.type==='guest' && selected.has(p.id)).length;
    document.getElementById('selectionCount').textContent = '선택 '+(m+g)+'명 · 회원 '+m+'명 / 게스트 '+g+'명';
  };
  const visible = () => people.filter(p=>p.type===active && p.name.toLocaleLowerCase().includes(document.getElementById('rosterSearch').value.trim().toLocaleLowerCase()));
  function render() {
    host.replaceChildren();
    for (const type of ['member','guest']) {
      const tab = document.getElementById(type+'Tab');
      tab.textContent = (type==='member'?'회원':'게스트')+' '+people.filter(p=>p.type===type).length+'명';
      tab.setAttribute('aria-selected',String(active===type));
      tab.tabIndex = active===type?0:-1;
    }
    host.setAttribute('aria-labelledby',active+'Tab');
    for(const person of visible()) {
      const label=document.createElement('label');label.className='choice roster-choice';
      const box=document.createElement('input');box.type='checkbox';box.value=person.id;box.checked=selected.has(person.id);
      box.onchange=()=>{if(box.checked)selected.add(person.id);else selected.delete(person.id);count();};
      const name=document.createElement('span');name.textContent=person.name;
      const seed=document.createElement('small');seed.textContent=person.seed||'미정';
      label.append(box,name,seed);host.append(label);
    }
    if(!host.children.length){const p=document.createElement('p');p.textContent='검색 결과가 없습니다.';host.append(p);}
    document.getElementById('all').textContent='현재 목록 전체 선택';
    count();
  }
  for(const type of ['member','guest']){
    const tab=document.getElementById(type+'Tab');
    tab.onclick=()=>{active=type;render();};
    tab.onkeydown=e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();active=e.key==='Home'?'member':e.key==='End'?'guest':active==='member'?'guest':'member';render();document.getElementById(active+'Tab').focus();}};
  }
  document.getElementById('rosterSearch').oninput=render;
  document.getElementById('all').onclick=()=>{visible().forEach(p=>selected.add(p.id));render();};
  clear.onclick=()=>{selected.clear();render();};
  document.getElementById('open').onclick=()=>{document.getElementById('title').value='';active='member';document.getElementById('rosterSearch').value='';render();document.getElementById('dialog').showModal();};
  document.getElementById('make').onclick=()=>{
    const picked=people.filter(p=>selected.has(p.id));
    const c=Number(document.getElementById('courts').value),r=Number(document.getElementById('rounds').value);
    if(picked.length<4){alert('참가자 4명 이상을 선택해주세요.');return;}
    if(!Number.isInteger(c)||c<1||c>20||!Number.isInteger(r)||r<1||r>20){alert('코트 수와 라운드 수는 1~20 사이 정수로 입력해주세요.');return;}
    const names=picked.map(p=>people.some(q=>q.name===p.name&&q.id!==p.id)?p.name+' ('+(p.type==='member'?'회원':'게스트')+')':p.name);
    const title=document.getElementById('title').value.trim()||stamp();
    data={title,roster:[],names,courts:c,rounds:r,schedule:rounds(names,c,r),updatedAt:null};
    document.getElementById('dialog').close();draw();
  };
  render();
}

