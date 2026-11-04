// Serialized into the page. Keep dependencies explicit and this factory self-contained.
export function createShuttleInventory({app,api,esc,EDITOR,isCurrent,setDirty,setSaving,message,onBack}){
  let token=0,data=null,draft=null,busy=false,pending=null,readId=0;
  const $=id=>app.querySelector('#'+id);
  const current=()=>isCurrent(token);
  const ordered=entries=>entries.map((entry,index)=>({...entry,index})).sort((a,b)=>a.date.localeCompare(b.date)||a.index-b.index);
  const today=()=>new Date(Date.now()+9*3600000).toISOString().slice(0,10);
  const changed=()=>{pending=null;setDirty(true);};
  const error=text=>{const el=$('inventoryError');if(el){el.textContent=text;el.focus();}};
  const reset=()=>{draft=null;pending=null;setDirty(false);};
  const signed=n=>(Number(n)>0?'+':'')+Number(n).toLocaleString('ko-KR')+'개';
  function rows(value,editing){
    let cumulative=0;
    return ordered(value.entries).map((entry,rowIndex)=>{
      cumulative+=Number(entry.change||0);
      if(!editing)return '<tr><td>'+esc(entry.date)+'</td><td class="inventory-change '+(entry.change>0?'inventory-in':'inventory-out')+'">'+signed(entry.change)+'</td><td class="inventory-total">'+cumulative.toLocaleString('ko-KR')+'개</td></tr>';
      return '<tr><td><input type="date" required aria-label="'+(rowIndex+1)+'행 날짜" data-inventory-id="'+esc(entry.id)+'" data-inventory-field="date" value="'+esc(entry.date)+'"></td><td><input type="number" required step="1" min="-1000000" max="1000000" inputmode="numeric" aria-label="'+(rowIndex+1)+'행 콕 변동 개수" data-inventory-id="'+esc(entry.id)+'" data-inventory-field="change" value="'+esc(entry.change)+'"></td><td class="inventory-total" data-inventory-total="'+esc(entry.id)+'">'+cumulative.toLocaleString('ko-KR')+'개</td><td><button type="button" data-inventory-delete="'+esc(entry.id)+'" aria-label="'+(rowIndex+1)+'행 삭제">삭제</button></td></tr>';
    }).join('');
  }
  function render(){
    if(!current()||!data)return;
    const editing=Boolean(draft),value=draft||data,stock=ordered(value.entries).reduce((sum,e)=>sum+Number(e.change||0),0);
    app.innerHTML='<button type="button" id="inventoryBack" class="crumb home-return">회계장부로 돌아가기</button><section class="panel ledger shuttle-inventory"><div class="ledger-heading"><div><h1>콕 재고 관리</h1><p class="inventory-current">현재 재고 <strong>'+stock.toLocaleString('ko-KR')+'개</strong></p></div><div class="ledger-actions">'+(editing?'<button type="button" id="inventoryCancel">취소</button><button type="button" id="inventorySave" class="primary">저장</button>':(EDITOR?'<button type="button" id="inventoryEdit">편집</button>':'')+'<button type="button" id="inventoryRefresh">새로고침</button>')+'</div></div><p class="muted">입고는 양수(예: +12), 사용·소진은 음수(예: -3)로 기록합니다. 첫 기록에는 현재 보유 개수를 양수로 입력하세요. 누계는 날짜순으로 자동 계산됩니다.</p>'+(editing?'<button type="button" id="inventoryAdd">+ 재고 변동 추가</button><p class="muted">같은 날짜의 기록은 입력한 순서대로 계산되며, 변경 내용은 저장해야 반영됩니다.</p>':'<p class="muted">'+(EDITOR?'편집 버튼으로 날짜별 재고 변동을 관리할 수 있습니다.':'회원은 조회만 가능합니다.')+'</p>')+'<p id="inventoryError" class="login-error" role="alert" tabindex="-1"></p><div class="inventory-scroll" role="region" tabindex="0" aria-label="콕 재고 날짜별 변동 표"><table class="inventory-table'+(editing?' editing':'')+'"><thead><tr><th scope="col">날짜</th><th scope="col">콕 변동 개수</th><th scope="col">누계</th>'+(editing?'<th scope="col">관리</th>':'')+'</tr></thead><tbody>'+rows(value,editing)+'</tbody></table></div>'+(!value.entries.length?'<p class="empty">아직 등록된 콕 재고 기록이 없습니다.</p>':'')+(data.updatedAt?'<p class="muted">마지막 저장: '+esc(new Date(data.updatedAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}))+'</p>':'')+'</section>';
    $('inventoryBack').onclick=()=>{if(busy||draft&&!confirm('저장하지 않은 재고 변경을 취소하고 돌아갈까요?'))return;readId++;reset();onBack();};
    if(!editing){
      if(EDITOR)$('inventoryEdit').onclick=()=>{draft=structuredClone(data);render();};
      $('inventoryRefresh').onclick=refresh;return;
    }
    $('inventoryCancel').onclick=()=>{if(busy||!confirm('재고 편집 내용을 취소할까요?'))return;reset();render();};
    $('inventorySave').onclick=save;
    $('inventoryAdd').onclick=()=>{if(busy)return;if(draft.entries.length>=1000){error('재고 기록은 최대 1,000행까지 입력할 수 있습니다.');return;}const id=crypto.randomUUID();draft.entries.push({id,date:today(),change:0});changed();render();app.querySelector('[data-inventory-id="'+id+'"][data-inventory-field="change"]')?.focus();};
    app.querySelectorAll('[data-inventory-field]').forEach(el=>el.oninput=()=>{const entry=draft.entries.find(row=>row.id===el.dataset.inventoryId);if(!entry)return;entry[el.dataset.inventoryField]=el.value;changed();updateTotals();});
    app.querySelectorAll('[data-inventory-delete]').forEach(el=>el.onclick=()=>{if(busy||!confirm('이 재고 기록을 삭제할까요? 저장 전에는 취소할 수 있습니다.'))return;draft.entries=draft.entries.filter(row=>row.id!==el.dataset.inventoryDelete);changed();render();});
  }
  function updateTotals(){
    if(!current()||!draft)return;let cumulative=0;
    for(const entry of ordered(draft.entries)){cumulative+=Number(entry.change||0);const cell=app.querySelector('[data-inventory-total="'+entry.id+'"]');if(cell)cell.textContent=cumulative.toLocaleString('ko-KR')+'개';}
    const currentOutput=app.querySelector('.inventory-current strong');if(currentOutput)currentOutput.textContent=cumulative.toLocaleString('ko-KR')+'개';
  }
  async function refresh(){
    if(busy)return;const mine=token,read=++readId;busy=true;app.querySelectorAll('button').forEach(el=>el.disabled=true);
    try{const response=await api('/api/shuttle-inventory');if(!current()||token!==mine||read!==readId)return;data=response.data;render();}
    catch(e){if(current()&&token===mine&&read===readId&&!e.memberOnly)error(e.message||'콕 재고를 불러오지 못했습니다. 다시 시도해주세요.');}
    finally{if(token===mine&&read===readId){busy=false;if(current())app.querySelectorAll('button').forEach(el=>el.disabled=false);}}
  }
  async function open(nextToken){
    token=nextToken;busy=false;reset();data=null;app.innerHTML='<p class="empty">콕 재고 기록을 불러오는 중…</p>';
    const mine=token,read=++readId;
    try{const response=await api('/api/shuttle-inventory');if(!current()||token!==mine||read!==readId)return;data=response.data;render();}
    catch(e){if(!current()||token!==mine||read!==readId||e.memberOnly)return;app.innerHTML='<p class="login-error">'+esc(e.message||'콕 재고를 불러오지 못했습니다.')+'</p><button type="button" id="inventoryRetry">다시 시도</button><button type="button" id="inventoryBack">회계장부로 돌아가기</button>';$('inventoryRetry').onclick=()=>open(token);$('inventoryBack').onclick=()=>{readId++;onBack();};}
  }
  async function save(){
    if(busy||!EDITOR||!draft||!current())return;
    const entries=draft.entries.map(entry=>({id:entry.id,date:entry.date,change:Number(entry.change)}));let cumulative=0,valid=true;
    for(const entry of ordered(entries)){cumulative+=entry.change;if(!entry.date||!Number.isSafeInteger(entry.change)||entry.change===0||Math.abs(entry.change)>1000000||cumulative<0)valid=false;}
    if(!valid){error('날짜와 0이 아닌 정수 변동 개수를 확인해주세요. 날짜순 누계는 0개보다 작아질 수 없습니다.');return;}
    if(!pending)pending={entries,version:data.version,operation:crypto.randomUUID()};
    const mine=token,read=readId;busy=true;setSaving(true);app.querySelectorAll('button,input').forEach(el=>el.disabled=true);
    try{const response=await api('/api/shuttle-inventory',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(pending)});if(!current()||token!==mine||read!==readId)return;data=response.data;reset();render();message('콕 재고 기록을 저장했습니다.');}
    catch(e){if(current()&&token===mine&&read===readId&&!e.memberOnly)error(e.status===409?'다른 운영진이 먼저 변경했습니다. 입력 내용을 별도로 보관한 뒤 취소하고 새로고침해주세요.':(e.message||'저장하지 못했습니다. 입력은 유지됩니다. 다시 저장해주세요.'));}
    finally{setSaving(false);if(token===mine&&read===readId){busy=false;if(current())app.querySelectorAll('button,input').forEach(el=>el.disabled=false);}}
  }
  return {open};
}
