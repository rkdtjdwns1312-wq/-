// Current baseline from the first sheet of "콕끼리 시드 관리표.xlsx" (작성기준 2026-09-10).
// Only name, points and source rank are copied; the seed is always derived from
// points via seedForPoints(). The sheet's seed column had 주밤(115) and 로토(104)
// as A+, which the operator confirmed on 2026-09-12 should be A (points rule wins).
// The workbook's second sheet ("26-08-19 변경") is empty and is not used.
export const initialRankingRows=[
  ['호잇',123,1],['뚜기',121,2],['주밤',115,3],['로토',104,4],['두진',100,5],
  ['네오',99,6],['시오',99,7],['이코',95,8],['뉴키',93,9],['규현',93,10],
  ['단우',91,11],['오웬',91,12],['구름',89,13],['구구',88,14],['백구',88,15],
  ['디디',86,16],['야키',85,17],['피클렛',83,18],['철',81,19],['에스',80,20],
  ['새로',80,21],['이름',77,22],['콩콩',75,23],['후니',76,24],['슝슝이',75,25],
  ['솔찬',71,26],['대식',71,27],['아만',70,28],['현이',69,29],['제리',68,30],
  ['쿠쿠',62,31],['덕자',60,32],['윤오',48,33],['곽동칠',44,34],['맹규',43,35],
  ['리버',42,36],['야옹',42,37],['라임',40,38],['우민',40,39],['머우',35,40],
  ['동이',31,41],['엽이',31,42],['죠스',30,43],['구마',29,44],['우하',29,45],
  ['루피',28,46],['아몬드',28,47],['리들',28,48],['쵸이',24,49],['소고기',24,50],
  ['완태',23,51],['푸르른',22,53],['가나',22,54],['선풍기',21,55],['후토',21,56],
  ['마구',20,57],['소금',20,58],['박민',20,59],['말짱',20,60],['김바비',20,61],
  ['텐텐',20,62]
].map(([name,points,sourceRank])=>({name,points,sourceRank}));

const seedBands=[['S',150],['A+',120],['A',100],['B+',90],['B',80],['C+',70],['C',60],['D+',50],['D',40],['E+',30],['E',20],['E-',0]];
export function seedForPoints(points){return seedBands.find(([,minimum])=>points>=minimum)?.[0]||'E-';}
const normalizeName=name=>String(name??'').replace(/\(부재\)$/,'').trim();
const slug=name=>normalizeName(name).replace(/[^\p{L}\p{N}]+/gu,'-').replace(/^-|-$/g,'').toLowerCase()||'member';

export function rankingOnlyPeople(people){
  const existing=new Set(people.filter(p=>p.type==='member').map(p=>normalizeName(p.name)));
  return initialRankingRows.filter(row=>!existing.has(normalizeName(row.name))).map(row=>({id:`ranking-${slug(row.name)}`,name:row.name,seed:seedForPoints(row.points),type:'member'}));
}

export function buildInitialRankings(people){
  const members=people.filter(p=>p.type==='member');
  const byName=new Map(members.map(p=>[normalizeName(p.name),p]));
  const used=new Set(),rows=[];
  for(const base of initialRankingRows){
    const person=byName.get(normalizeName(base.name));
    const memberId=person?.id||`ranking-${slug(base.name)}`;
    if(used.has(memberId))continue;
    rows.push({memberId,name:base.name,points:base.points,seed:seedForPoints(base.points),sourceRank:base.sourceRank});
    used.add(memberId);
  }
  // Keep any newly-added member safe and visible until an operator gives them
  // a recorded result. The current source file contains all 61 members.
  for(const person of members){
    if(used.has(person.id))continue;
    rows.push({memberId:person.id,name:normalizeName(person.name),points:20,seed:seedForPoints(20),sourceRank:100000});
    used.add(person.id);
  }
  rows.sort((a,b)=>a.sourceRank-b.sourceRank||a.name.localeCompare(b.name,'ko'));
  return rows.map((row,index)=>({...row,rank:index+1,previousRank:index+1,attendance:0,wins:0,losses:0}));
}

export async function ensureRankingMembers(db,people){
  const initial=buildInitialRankings(people);
  await db.batch(initial.map(row=>db.prepare(`INSERT OR IGNORE INTO ranking_members
    (member_id,name,points,seed,rank,previous_rank,attendance,wins,losses,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(row.memberId,row.name,row.points,row.seed,row.rank,row.previousRank,row.attendance,row.wins,row.losses,'2026-09-10T00:00:00.000Z')));
}

export function orderRankingRows(rows){
  return [...rows].sort((a,b)=>b.points-a.points||a.rank-b.rank||a.name.localeCompare(b.name,'ko')).map((row,index)=>({...row,rank:index+1,seed:seedForPoints(row.points)}));
}
