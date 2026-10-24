// Serialized into the page: keep this factory self-contained.
export function createLedgerView({app,api,esc,EDITOR,isCurrent,setDirty,setSaving,message}){
  let data=null,draft=null,busy=false,pending=null,token=0,readId=0;
  const $=id=>app.querySelector('#'+id);
  const money=value=>Number(value).toLocaleString('ko-KR')+'원';
  const ordered=entries=>entries.map((e,i)=>({...e,index:i})).sort((a,b)=>a.date.localeCompare(b.date)||a.index-b.index);
  const totals=value=>value.entries.reduce((a,e)=>({income:a.income+Number(e.income||0),expense:a.expense+Number(e.expense||0),balance:a.balance+Number(e.income||0)-Number(e.expense||0)}),{income:0,expense:0,balance:Number(value.openingBalance||0)});
  const current=()=>isCurrent(token);
  const changed=()=>{pending=null;setDirty(true);};
  function memoButton(e,editing){return e.note||editing?'<button type="button" data-memo="'+esc(e.id)+'" aria-label="'+esc(e.description||'거래')+' '+(e.note?'메모보기':'메모 작성')+'">'+(e.note?'메모보기':'메모 작성')+'</button>':'—';}
  function openMemo(id){
    if(busy||!current())return;
    const entry=(draft||data).entries.find(e=>e.id===id);if(!entry)return;
    const editing=Boolean(EDITOR&&draft),box=$('ledgerMemo');
    box.innerHTML='<div class="ledger-heading"><h2 id="ledgerMemoTitle">'+(editing?'메모 작성':'메모보기')+'</h2><button type="button" id="ledgerMemoClose" aria-label="메모 닫기">닫기</button></div><p class="muted">'+esc(entry.date)+' · '+esc(entry.description||'거래')+'</p>'+(editing?'<label for="ledgerMemoText">메모 내용 (최대 5,000자)</label><textarea id="ledgerMemoText" maxlength="5000" rows="12">'+esc(entry.note)+'</textarea><p class="muted">적용한 뒤 장부의 저장 버튼을 눌러야 다른 회원에게 반영됩니다.</p><button type="button" class="primary" id="ledgerMemoApply">적용</button>':'<div class="ledger-note-paper">'+esc(entry.note)+'</div>');
    const canClose=()=>!editing||box.querySelector('#ledgerMemoText').value===entry.note||confirm('적용하지 않은 메모를 닫을까요?');
    box.querySelector('#ledgerMemoClose').onclick=()=>{if(canClose())box.close();};
    box.oncancel=e=>{if(!canClose())e.preventDefault();};
    if(editing)box.querySelector('#ledgerMemoText').oninput=()=>setDirty(true);
    if(editing)box.querySelector('#ledgerMemoApply').onclick=()=>{entry.note=box.querySelector('#ledgerMemoText').value;changed();box.close();render();};
    box.showModal();box.querySelector(editing?'#ledgerMemoText':'#ledgerMemoClose').focus();
  }
  function summary(value){const s=totals(value);return '<div class="ledger-summary"><div>시작 잔액<strong>'+money(value.openingBalance)+'</strong></div><div>총 수입<strong class="ledger-income">'+money(s.income)+'</strong></div><div>총 지출<strong class="ledger-expense">'+money(s.expense)+'</strong></div><div>현재 누계<strong>'+money(s.balance)+'</strong></div></div>';}
  function error(text){const el=$('ledgerError');if(el){el.textContent=text;el.focus();}}
  function render(){
    if(!current()||!data)return;
    const editing=Boolean(draft),value=draft||data;
    let balance=Number(value.openingBalance||0);
    const rows=ordered(value.entries).map(e=>{
      balance+=Number(e.income||0)-Number(e.expense||0);
      if(!editing)return '<tr><td>'+esc(e.date)+'</td><td>'+esc(e.description)+'</td><td class="ledger-income">'+(e.income?money(e.income):'—')+'</td><td class="ledger-expense">'+(e.expense?money(e.expense):'—')+'</td><td>'+money(balance)+'</td><td>'+memoButton(e,false)+'</td></tr>';
      const input=(field,type,label,max='')=>'<input aria-label="'+(e.index+1)+'행 '+label+'" data-id="'+esc(e.id)+'" data-field="'+field+'" type="'+type+'" '+max+' value="'+esc(e[field])+'">';
      return '<tr>'+['date','description','income','expense'].map((field,i)=>'<td>'+input(field,i===0?'date':i>1?'number':'text',['날짜','항목','수입','지출'][i],i===1?'maxlength="120"':i>1?'min="0" max="1000000000000" step="1" inputmode="numeric"':'required')+'</td>').join('')+'<td data-balance-id="'+esc(e.id)+'">'+money(balance)+'</td><td>'+memoButton(e,true)+'</td><td><button type="button" data-delete="'+esc(e.id)+'" aria-label="'+(e.index+1)+'행 삭제">삭제</button></td></tr>';
    }).join('');
    app.innerHTML='<a class="crumb home-return" href="#home">홈으로 가기</a><section class="panel ledger"><div class="ledger-heading"><h1>회계장부</h1><div class="ledger-actions">'+(editing?'<button type="button" id="ledgerCancel">취소</button><button type="button" id="ledgerSave" class="primary">저장</button>':(EDITOR?'<button type="button" id="ledgerEdit">편집</button>':'')+'<button type="button" id="ledgerRefresh">새로고침</button>')+'</div></div><p class="muted">회비 수입과 지출을 날짜순으로 확인합니다. 금액 단위: 원</p><div id="ledgerSummary">'+summary(value)+'</div>'+(editing?'<label class="ledger-opening">시작 잔액<input id="ledgerOpening" type="number" step="1" min="-1000000000000" max="1000000000000" value="'+esc(value.openingBalance)+'"></label><p class="muted">한 행에 수입 또는 지출 중 하나만 입력하세요. 날짜순으로 누계가 자동 계산되며, 같은 날짜는 입력 순서를 따릅니다. 삭제도 저장을 눌러야 반영됩니다.</p>':'<p class="muted">'+(EDITOR?'편집 버튼으로 장부를 수정할 수 있습니다.':'회원은 조회만 가능합니다.')+'</p>')+'<p id="ledgerError" class="login-error" role="alert" tabindex="-1"></p><div class="ledger-scroll" tabindex="0" role="region" aria-label="회계장부 표 — 작은 화면에서는 좌우로 이동"><table class="ledger-table"><thead><tr>'+['날짜','항목','수입','지출','누계','메모',...(editing?['관리']:[])].map(h=>'<th scope="col">'+h+'</th>').join('')+'</tr></thead><tbody>'+rows+'</tbody></table></div>'+(!value.entries.length?'<p class="empty">아직 등록된 거래가 없습니다.</p>':'')+(editing?'<button type="button" id="ledgerAdd">+ 거래 추가</button>':'')+'<p class="muted">'+(data.updatedAt?'마지막 저장: '+esc(new Date(data.updatedAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})):'등록된 장부가 없습니다. 운영진이 시작 잔액과 거래를 입력해주세요.')+'</p><dialog id="ledgerMemo" class="ledger-memo" aria-labelledby="ledgerMemoTitle"></dialog></section>';
    app.querySelectorAll('[data-memo]').forEach(el=>el.onclick=()=>openMemo(el.dataset.memo));
    if(editing){
      $('ledgerCancel').onclick=()=>{if(busy)return;if(!confirm('편집 내용을 취소할까요?'))return;draft=null;pending=null;setDirty(false);render();};
      $('ledgerSave').onclick=save;
      $('ledgerAdd').onclick=()=>{if(busy)return;if(draft.entries.length>=500){error('장부는 최대 500행까지 입력할 수 있습니다.');return;}draft.entries.push({id:crypto.randomUUID(),date:new Date(Date.now()+9*3600000).toISOString().slice(0,10),description:'',income:0,expense:0,note:''});changed();render();const inputs=app.querySelectorAll('[data-field="description"]');inputs[inputs.length-1]?.focus();};
      $('ledgerOpening').oninput=e=>{draft.openingBalance=e.target.value;changed();updateTotals();};
      app.querySelectorAll('[data-field]').forEach(el=>el.oninput=()=>{const entry=draft.entries.find(e=>e.id===el.dataset.id);if(entry){entry[el.dataset.field]=el.value;changed();updateTotals();}});
      app.querySelectorAll('[data-delete]').forEach(el=>el.onclick=()=>{if(busy||!confirm('이 행을 삭제할까요? 저장 전에는 취소할 수 있습니다.'))return;draft.entries=draft.entries.filter(e=>e.id!==el.dataset.delete);changed();render();});
    }else{
      if(EDITOR)$('ledgerEdit').onclick=()=>{draft=structuredClone(data);pending=null;render();};
      $('ledgerRefresh').onclick=async()=>{const previous=data,mine=token;try{await open(mine);}catch(e){if(current()&&token===mine&&!e.memberOnly){data=previous;render();error(e.message||'장부를 불러오지 못했습니다. 다시 시도해주세요.');}}};
    }
  }
  function updateTotals(){
    if(!current()||!draft)return;
    $('ledgerSummary').innerHTML=summary(draft);let balance=Number(draft.openingBalance||0);
    // Keep focused inputs stable while dates/amounts change. Sort visually on save.
    for(const e of ordered(draft.entries)){balance+=Number(e.income||0)-Number(e.expense||0);const cell=Array.from(app.querySelectorAll('[data-balance-id]')).find(el=>el.dataset.balanceId===e.id);if(cell)cell.textContent=money(balance);}
  }
  async function open(nextToken){
    token=nextToken;draft=null;pending=null;data=null;setDirty(false);
    const mine=nextToken,read=++readId;app.innerHTML='<p class="empty">회계장부를 불러오는 중…</p>';
    const response=await api('/api/ledger');if(!isCurrent(mine)||token!==mine||read!==readId)return;data=response.data;render();
  }
  async function save(){
    if(busy||!EDITOR||!draft||!current())return;
    const payload={openingBalance:Number(draft.openingBalance),entries:draft.entries.map(e=>({id:e.id,date:e.date,description:e.description.trim(),income:Number(e.income),expense:Number(e.expense),note:e.note.trim()}))};
    if(!Number.isSafeInteger(payload.openingBalance)||Math.abs(payload.openingBalance)>1e12||payload.entries.some(e=>!e.date||!e.description||![e.income,e.expense].every(n=>Number.isSafeInteger(n)&&n>=0&&n<=1e12)||(e.income>0)===(e.expense>0))){error('시작 잔액·날짜·항목을 확인하고, 각 행의 수입 또는 지출 중 한 곳에만 1원 이상의 정수를 입력해주세요.');return;}
    if(!pending)pending={...payload,version:data.version,operation:crypto.randomUUID()};
    const mine=token;busy=true;setSaving(true);app.querySelectorAll('button,input').forEach(el=>el.disabled=true);
    try{const response=await api('/api/ledger',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(pending)});if(!isCurrent(mine))return;data=response.data;draft=null;pending=null;setDirty(false);render();message('회계장부를 저장했습니다.');}
    catch(e){if(!isCurrent(mine)||e.memberOnly)return;error(e.status===409?'다른 운영진이 먼저 수정했거나 이미 저장되었습니다. 입력 내용을 별도로 보관한 뒤 취소하고 새로고침해주세요.':(e.message||'저장하지 못했습니다. 입력은 유지됩니다. 저장을 다시 눌러주세요.'));}
    finally{busy=false;setSaving(false);if(isCurrent(mine))app.querySelectorAll('button,input').forEach(el=>el.disabled=false);}
  }
  return {open};
}
