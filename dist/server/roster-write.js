import { orderRankingRows } from './rankings.js';

export const rosterRevision=async db=>(await db.prepare('SELECT revision FROM roster_write_revision WHERE id=1').first()).revision;
export function rosterConflict(){return Object.assign(new Error('다른 작업에서 회원 정보나 점수가 변경되었습니다. 최신 내용을 확인한 뒤 다시 시도해주세요.'),{conflict:true});}

// JSON rows use at most two bound parameters and one query per table, not per person.
// Table/column identifiers below are internal constants, never request input.
export function updateRows(db,table,idColumn,rows,columns,increments=[]){
  const source="json_each(?) AS incoming",id="json_extract(incoming.value,'$."+idColumn+"')";
  return db.prepare('UPDATE '+table+' SET ('+columns.join(',')+')=(SELECT '+columns.map(c=>"json_extract(incoming.value,'$."+c+"')").join(',')+' FROM '+source+' WHERE '+id+'='+table+'.'+idColumn+')'+increments.map(c=>','+c+'='+c+'+1').join('')+' WHERE '+idColumn+' IN (SELECT '+id+' FROM json_each(?) AS incoming)').bind(JSON.stringify(rows),JSON.stringify(rows));
}
export function insertRows(db,table,columns,rows){
  return db.prepare('INSERT INTO '+table+' ('+columns.join(',')+') SELECT '+columns.map(c=>"json_extract(value,'$."+c+"')").join(',')+' FROM json_each(?)').bind(JSON.stringify(rows));
}

// D1 executes a batch as one transaction. A stale snapshot makes the first
// statement violate NOT NULL, so no points, history or ranks are partly saved.
export async function commitRoster(db,revision,statements,memberChanges=null){
  if(memberChanges){
    const rows=(await db.prepare('SELECT * FROM ranking_members WHERE hidden=0').all()).results;
    const merged=new Map(rows.map(row=>[row.member_id,row]));
    for(const change of memberChanges)merged.set(change.member_id,{...merged.get(change.member_id),...change});
    const ordered=orderRankingRows([...merged.values()].filter(row=>!row.hidden)).map(row=>({...row,previous_rank:row.previous_rank==null||row.previous_rank===999999?row.rank:row.previous_rank}));
    statements.push(updateRows(db,'ranking_members','member_id',ordered,['rank','previous_rank']));
  }
  const claim=db.prepare('UPDATE roster_write_revision SET revision=CASE WHEN revision=? THEN revision+1 ELSE NULL END WHERE id=1').bind(revision);
  try{return await db.batch([claim,...statements]);}
  catch(error){if(await rosterRevision(db)!==revision)throw rosterConflict();throw error;}
}
