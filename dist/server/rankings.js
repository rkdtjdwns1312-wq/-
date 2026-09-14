const seedBands=[['S',150],['A+',120],['A',100],['B+',90],['B',80],['C+',70],['C',60],['D+',50],['D',40],['E+',30],['E',20],['E-',0]];
export function seedForPoints(points){return seedBands.find(([,minimum])=>points>=minimum)?.[0]||'E-';}
export function orderRankingRows(rows){
  return [...rows].sort((a,b)=>b.points-a.points||(a.points===20&&b.points===20?(Number(Boolean(a.floor_protected_at))-Number(Boolean(b.floor_protected_at))||String(a.floor_protected_at||'').localeCompare(String(b.floor_protected_at||''))):0)||a.rank-b.rank||a.name.localeCompare(b.name,'ko')).map((row,index)=>({...row,rank:index+1,seed:seedForPoints(row.points)}));
}
