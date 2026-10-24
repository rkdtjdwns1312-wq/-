// Serialized into the page. Keep dependencies explicit and the factory self-contained.
export function createLedgerLists({app,api,esc,EDITOR,isCurrent,setDirty,setSaving,message,onBack}){
  let kind='',token=0,data=null,draft=null,busy=false,dirty=false,pending=null,readId=0;
  let selected=new Set(),editable=new Set();
  const $=id=>app.querySelector('#'+id);
  const title=()=>kind==='prepaid'?'선납자명단':'찬조명단';
  const current=()=>isCurrent(token);
  const ordered=entries=>entries.map((e,index)=>({...e,index})).sort((a,b)=>b.date.localeCompare(a.date)||a.index-b.index);
  const changed=()=>{dirty=true;pending=null;setDirty(true);};
  const error=text=>{const el=$('listError');if(el){el.textContent=text;el.focus();}};
  const reset=()=>{draft=null;pending=null;dirty=false;selected=new Set();editable=new Set();setDirty(false);};
  const money=n=>Number(n).toLocaleString('ko-KR')+'원';
  function updateSelection(){
    const count=selected.size;
    $('listModify').disabled=busy||count===0;$('listDelete').disabled=busy||count===0;
    $('listSelected').textContent=count+'명 선택';
    $('listAll').checked=draft.entries.length>0&&count===draft.entries.length;
    $('listAll').indeterminate=count>0&&count<draft.entries.length;
  }
  function render(){
    if(!current()||!data)return;
    const editing=Boolean(draft),value=draft||data;
    const rows=ordered(value.entries).map(e=>{
      const enabled=editing&&editable.has(e.id),label=(e.index+1)+'행 ';
      const input=(field,type,caption,attrs)=>'<input type="'+type+'" aria-label="'+esc(label+caption)+'" data-list-id="'+esc(e.id)+'" data-list-field="'+field+'" '+attrs+' value="'+esc(e[field])+'">';
      return '<tr>'+(editing?'<td><input type="checkbox" data-select="'+esc(e.id)+'" aria-label="'+esc(label+(e.name||'새 항목')+' 선택')+'" '+(selected.has(e.id)?'checked':'')+'></td>':'')+'<td class="list-name">'+(enabled?input('name','text','이름','maxlength="80" required'):esc(e.name||'이름을 입력해주세요'))+'</td><td class="list-amount">'+(enabled?input('amount','number','금액','min="1" max="1000000000000" step="1" inputmode="numeric" required'):money(e.amount))+'</td><td class="list-date">'+(enabled?input('date','date','날짜','required'):esc(e.date))+'</td></tr>';
    }).join('');
    app.innerHTML='<button type="button" id="listBack" class="crumb home-return">회계장부로 돌아가기</button><section class="panel ledger ledger-list"><div class="ledger-heading"><h1>'+title()+'</h1><div class="ledger-list-actions">'+(editing?'<button type="button" id="listCancel">취소</button><button type="button" id="listSave" class="primary">저장</button>':(EDITOR?'<button type="button" id="listEdit">편집</button>':'')+'<button type="button" id="listRefresh">새로고침</button>')+'</div></div><p class="muted">'+(kind==='prepaid'?'회비를 미리 납부한 회원의 이름·금액·날짜입니다.':'찬조해주신 분의 이름·금액·날짜입니다.')+' 장부 수입에는 자동 합산되지 않습니다.</p><p class="ledger-list-total">'+value.entries.length+'명 · 총 '+money(value.entries.reduce((sum,e)=>sum+Number(e.amount||0),0))+'</p>'+(editing?'<div class="ledger-list-actions"><button type="button" id="listAdd">+ 추가</button><button type="button" id="listModify">선택 수정</button><button type="button" id="listDelete" class="danger">선택 삭제</button><span id="listSelected" aria-live="polite"></span></div><p class="muted">체크한 뒤 선택 수정 또는 선택 삭제를 누르세요. 변경 내용은 저장해야 반영됩니다.</p>':'<p class="muted">'+(EDITOR?'편집 버튼으로 명단을 관리할 수 있습니다.':'회원은 조회만 가능합니다.')+'</p>')+'<p id="listError" class="login-error ledger-list-error" role="alert" tabindex="-1"></p><div class="ledger-list-scroll" role="region" tabindex="0" aria-label="'+title()+' — 아래로 스크롤"><table class="ledger-list-table'+(editing?' editing':'')+'"><thead><tr>'+(editing?'<th scope="col"><input id="listAll" type="checkbox" aria-label="전체 선택"></th>':'')+'<th scope="col">이름</th><th scope="col">금액</th><th scope="col">날짜</th></tr></thead><tbody>'+rows+'</tbody></table></div>'+(!value.entries.length?'<p class="empty">등록된 명단이 없습니다.</p>':'')+(data.updatedAt?'<p class="muted">마지막 저장: '+esc(new Date(data.updatedAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}))+'</p>':'')+'</section>';
    $('listBack').onclick=()=>{if(busy||dirty&&!confirm('저장하지 않은 명단 변경을 취소하고 돌아갈까요?'))return;readId++;reset();onBack();};
    if(!editing){
      if(EDITOR)$('listEdit').onclick=()=>{draft=structuredClone(data);render();};
      $('listRefresh').onclick=()=>refresh();
      return;
    }
    $('listCancel').onclick=()=>{if(busy||dirty&&!confirm('명단의 편집 내용을 취소할까요?'))return;reset();render();};
    $('listSave').onclick=save;
    $('listAdd').onclick=()=>{
      if(busy)return;if(draft.entries.length>=500){error('명단은 최대 500행까지 입력할 수 있습니다.');return;}
      const id=crypto.randomUUID();draft.entries.push({id,name:'',amount:0,date:new Date(Date.now()+9*3600000).toISOString().slice(0,10)});editable.add(id);changed();render();
      Array.from(app.querySelectorAll('[data-list-field]')).find(el=>el.dataset.listId===id&&el.dataset.listField==='name')?.focus();
    };
    $('listAll').onchange=e=>{selected=e.target.checked?new Set(draft.entries.map(row=>row.id)):new Set();app.querySelectorAll('[data-select]').forEach(el=>el.checked=selected.has(el.dataset.select));updateSelection();};
    app.querySelectorAll('[data-select]').forEach(el=>el.onchange=()=>{if(el.checked)selected.add(el.dataset.select);else selected.delete(el.dataset.select);updateSelection();});
    $('listModify').onclick=()=>{if(busy||!selected.size)return;for(const id of selected)editable.add(id);render();app.querySelector('[data-list-field]')?.focus();};
    $('listDelete').onclick=()=>{if(busy||!selected.size||!confirm('선택한 '+selected.size+'명의 명단을 삭제할까요? 저장 전에는 취소할 수 있습니다.'))return;draft.entries=draft.entries.filter(e=>!selected.has(e.id));for(const id of selected)editable.delete(id);selected.clear();changed();render();};
    app.querySelectorAll('[data-list-field]').forEach(el=>el.oninput=()=>{const row=draft.entries.find(e=>e.id===el.dataset.listId);if(row){row[el.dataset.listField]=el.value;changed();app.querySelector('.ledger-list-total').textContent=draft.entries.length+'명 · 총 '+money(draft.entries.reduce((sum,e)=>sum+Number(e.amount||0),0));}});
    updateSelection();
  }
  async function refresh(){
    if(busy)return;
    const mine=token,requestedKind=kind,read=++readId;busy=true;
    app.querySelectorAll('button').forEach(el=>el.disabled=true);
    try{const response=await api('/api/ledger-lists/'+requestedKind);if(!current()||token!==mine||kind!==requestedKind||read!==readId)return;data=response.data;render();}
    catch(e){if(current()&&token===mine&&read===readId&&!e.memberOnly)error(e.message||'명단을 불러오지 못했습니다. 다시 시도해주세요.');}
    finally{if(token===mine&&read===readId){busy=false;if(current())app.querySelectorAll('button').forEach(el=>el.disabled=false);}}
  }
  async function open(nextKind,nextToken){
    if(!['prepaid','sponsors'].includes(nextKind))return;
    kind=nextKind;token=nextToken;busy=false;reset();data=null;
    app.innerHTML='<p class="empty">'+title()+'을 불러오는 중…</p>';
    const mine=token,requestedKind=kind,read=++readId;
    try{const response=await api('/api/ledger-lists/'+kind);if(!current()||token!==mine||kind!==requestedKind||read!==readId)return;data=response.data;render();}
    catch(e){if(!current()||token!==mine||read!==readId||e.memberOnly)return;app.innerHTML='<p class="login-error">'+esc(e.message||'명단을 불러오지 못했습니다.')+'</p><button type="button" id="listRetry">다시 시도</button><button type="button" id="listBack">회계장부로 돌아가기</button>';$('listRetry').onclick=()=>open(kind,token);$('listBack').onclick=()=>{readId++;onBack();};}
  }
  async function save(){
    if(busy||!EDITOR||!draft||!current())return;
    const entries=draft.entries.map(e=>({id:e.id,name:e.name.trim(),amount:Number(e.amount),date:e.date}));
    if(entries.some(e=>!e.name||!e.date||!Number.isSafeInteger(e.amount)||e.amount<1||e.amount>1e12)){error('이름·날짜와 1원 이상의 정수 금액을 입력해주세요.');return;}
    if(!pending)pending={entries,version:data.version,operation:crypto.randomUUID()};
    const mine=token,requestedKind=kind,read=readId;busy=true;setSaving(true);app.querySelectorAll('button,input').forEach(el=>el.disabled=true);
    try{const response=await api('/api/ledger-lists/'+kind,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(pending)});if(!current()||token!==mine||read!==readId||kind!==requestedKind)return;data=response.data;reset();render();message(title()+'을 저장했습니다.');}
    catch(e){if(current()&&token===mine&&read===readId&&!e.memberOnly)error(e.status===409?'다른 운영진이 먼저 변경했습니다. 입력 내용을 별도로 보관한 뒤 취소하고 새로고침해주세요.':(e.message||'저장하지 못했습니다. 입력은 유지됩니다. 다시 저장해주세요.'));}
    finally{setSaving(false);if(token===mine&&read===readId){busy=false;if(current()){app.querySelectorAll('button,input').forEach(el=>el.disabled=false);if(draft)updateSelection();}}}
  }
  return {open};
}
