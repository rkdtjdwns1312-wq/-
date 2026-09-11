// 콕끼리 옛 사이트(Codex Sites)의 공개 읽기 API에서 공지·대진표 데이터를 받아
// drizzle/0004_seed_posts_from_codex_site.sql 마이그레이션 파일을 생성합니다.
// GET 요청만 보냅니다(쓰기 요청 없음). Node 내장 fetch만 사용, 외부 패키지 없음.
//
// 사용법: node scripts/export-old-site.mjs [옛사이트주소]
//   (인자를 생략하면 아래 DEFAULT_OLD_SITE를 사용)

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const DEFAULT_OLD_SITE = 'https://kokkiri-badminton-draw.rkdtjdwns1312.chatgpt.site';
const OLD_SITE = (process.argv[2] || DEFAULT_OLD_SITE).replace(/\/+$/, '');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = path.join(__dirname, '..', 'drizzle', '0004_seed_posts_from_codex_site.sql');

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`GET ${url} 실패: HTTP ${res.status}`);
  }
  return res.json();
}

// kind별 게시글 목록을 hasMore가 false가 될 때까지 offset을 늘려가며 전부 받는다.
async function fetchAllPostSummaries(kind) {
  const items = [];
  let offset = 0;
  for (;;) {
    const body = await getJson(`${OLD_SITE}/api/posts?kind=${encodeURIComponent(kind)}&offset=${offset}`);
    const pageItems = body.items || [];
    items.push(...pageItems);
    if (!body.hasMore || pageItems.length === 0) break;
    offset += pageItems.length;
  }
  return items;
}

async function fetchPostDetail(id) {
  const body = await getJson(`${OLD_SITE}/api/posts/${encodeURIComponent(id)}`);
  return body.data;
}

async function fetchScheduleSingleton() {
  const body = await getJson(`${OLD_SITE}/api/schedule`);
  return body.data ?? null;
}

function sqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

// board_posts 행: unpack(row) = {...JSON.parse(row.payload), id, kind, version, createdAt:row.created_at, updatedAt:row.updated_at}
// 이므로 payload에는 id/kind/version/createdAt/updatedAt을 뺀 나머지 필드만 담는다.
function buildBoardPostInsert(post) {
  const { id, kind, version, createdAt, updatedAt, ...rest } = post;
  const payload = JSON.stringify(rest);
  const columns = 'id,kind,payload,version,last_operation,created_at,updated_at';
  const values = [
    sqlString(id),
    sqlString(kind),
    sqlString(payload),
    Number.isFinite(version) ? version : 1,
    sqlString('import-codex-site'),
    sqlString(createdAt),
    sqlString(updatedAt),
  ].join(',');
  return `INSERT OR IGNORE INTO board_posts (${columns}) VALUES (${values});`;
}

// schedules 행(id=1): payload에는 updatedAt을 뺀 나머지, updated_at 컬럼에 updatedAt을 넣는다.
function buildScheduleInsert(data) {
  const { updatedAt, ...rest } = data;
  const payload = JSON.stringify(rest);
  const columns = 'id,payload,updated_at';
  const values = [1, sqlString(payload), sqlString(updatedAt)].join(',');
  return `INSERT OR IGNORE INTO schedules (${columns}) VALUES (${values});`;
}

function nowKstStamp() {
  // 'sv-SE' 로캘은 'YYYY-MM-DD HH:mm:ss' 형태를 반환해 파싱 없이 그대로 쓰기 좋다.
  const kst = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' });
  return `${kst.replace(' ', 'T')}+09:00`;
}

async function main() {
  console.log(`옛 사이트: ${OLD_SITE}`);

  const [noticeSummaries, scheduleSummaries] = await Promise.all([
    fetchAllPostSummaries('notice'),
    fetchAllPostSummaries('schedule'),
  ]);
  console.log(`공지 목록: ${noticeSummaries.length}건, 대진표 게시글 목록: ${scheduleSummaries.length}건`);

  const summaries = [...noticeSummaries, ...scheduleSummaries];
  const posts = [];
  for (const summary of summaries) {
    const detail = await fetchPostDetail(summary.id);
    if (!detail) {
      throw new Error(`상세 데이터 없음: id=${summary.id}`);
    }
    posts.push(detail);
  }

  const scheduleSingleton = await fetchScheduleSingleton();

  const lines = [];
  lines.push(`-- 생성 시각(KST): ${nowKstStamp()}`);
  lines.push(`-- 원본: ${OLD_SITE}`);
  lines.push(
    `-- 공지 ${noticeSummaries.length}건, 대진표 게시글 ${scheduleSummaries.length}건, ` +
      `단일 대진표(/api/schedule) ${scheduleSingleton ? 1 : 0}건`,
  );
  lines.push('-- INSERT OR IGNORE 사용: 이미 같은 id가 있으면 건너뜁니다(재실행해도 기존 데이터를 덮어쓰지 않음).');
  lines.push('');

  if (scheduleSingleton) {
    lines.push(buildScheduleInsert(scheduleSingleton));
  }
  for (const post of posts) {
    lines.push(buildBoardPostInsert(post));
  }
  lines.push('');

  writeFileSync(OUTPUT_PATH, lines.join('\n'), 'utf8');

  console.log(`작성 완료: ${OUTPUT_PATH}`);
  console.log(
    `요약: schedules 행 ${scheduleSingleton ? 1 : 0}개, board_posts 행 ${posts.length}개 ` +
      `(공지 ${noticeSummaries.length}, 대진표 ${scheduleSummaries.length})`,
  );
}

main().catch((err) => {
  console.error('실패:', err.stack || err.message || err);
  process.exit(1);
});
