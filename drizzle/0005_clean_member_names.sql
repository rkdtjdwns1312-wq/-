-- 생성 시각(KST): 2026-09-12T13:35:00+09:00
-- 회원 명단의 (부재) 표기 제거(요청 045): 덕자(부재)→덕자(member-35), 우민(부재)→우민(member-42)
-- ranking_members는 코드(ensureRankingMembers)가 INSERT OR IGNORE로 채우므로 이미 만들어진 기존 행은 이 UPDATE로 정리한다.
-- roster.js·rankings.js의 원본 이름도 함께 정리했으므로 새로 만들어지는 DB는 처음부터 깨끗하다.
UPDATE ranking_members SET name='덕자' WHERE member_id='member-35';
UPDATE ranking_members SET name='우민' WHERE member_id='member-42';
