#!/usr/bin/env node
/*
 * 공모 한눈에 — 중장년 공모·지원사업 수집 오케스트레이터
 * ─────────────────────────────────────────────
 * scripts/sources/ 안의 모든 소스를 돌려 정규화 공고를 모은 뒤,
 * 종료분 제거 → 소스 간 중복 제거 → 상태(접수중/예정/상시) 계산 →
 * 마감 임박 순 정렬 → assets/data/programs.json 저장.
 *
 * 시드(큐레이션) 카드는 assets/data/seed.json 에 있고, 항상 함께 병합한다.
 * → API 키가 아직 없어도 사이트가 비지 않는다("빈 화면 노출 금지").
 *
 * 새 소스 추가법: scripts/sources/ 에 모듈 하나 만들고 (bizinfo.js 참고)
 *   { id, label, requiresEnv, enabled, fetchEvents(env) } 형태로 export →
 *   아래 SOURCES 배열에 require 추가. 끝.
 *
 * 로컬 테스트:  BIZINFO_API_KEY=xxxx node scripts/collect.js
 *              (키 없이 실행하면 시드 카드만으로 programs.json 생성)
 */

const fs = require('fs');
const path = require('path');

const SOURCES = [
  require('./sources/culture'),     // 문화포털 — 공모전(인증키 불필요)
  require('./sources/bizinfo'),     // 기업마당 — 기업지원 중심(개인 공모는 소수)
  require('./sources/narajangteo'), // 나라장터 — 단체·협동조합 응찰 용역(사회서비스)
  require('./sources/gov24'),       // 정부24·보조금24 — 개인 공공서비스(검증 결과 비활성)
];

const KST = () => new Date(Date.now() + 9 * 3600 * 1000);
const todayStr = KST().toISOString().slice(0, 10);

function normTitle(t) {
  return String(t || '').toLowerCase().replace(/[\s\[\]()·,.!?'"\-]/g, '');
}

function daysBetween(a, b) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}

// 공고 한 건의 상태/긴급도를 계산해 붙인다.
function decorate(p) {
  let status = 'unknown';   // open | upcoming | always | unknown
  let dday = null;          // 마감까지 남은 일수(접수중일 때)
  if (p.always || (!p.apply_begin && !p.apply_end)) {
    status = 'always';
  } else if (p.apply_begin && p.apply_begin > todayStr) {
    status = 'upcoming';
  } else if (p.apply_end) {
    status = 'open';
    dday = daysBetween(todayStr, p.apply_end);
  } else if (p.apply_begin && p.apply_begin <= todayStr) {
    status = 'open';
  }
  // kind 3축: '공모전'(작품·아이디어를 내고 겨룸) · '지원사업'(신청해서 받음)
  // · '용역입찰'(단체·법인이 응찰해 수주). 소스가 명시하지 않으면 소스로 추정한다
  // (kind 도입 이전에 수집돼 이월되는 공고가 지원사업으로 잘못 섞이지 않게).
  const kind = p.kind || (p.source === 'narajangteo' ? '용역입찰' : '지원사업');
  return { ...p, kind, status, dday, urgent: status === 'open' && dday !== null && dday <= 7 };
}

// 정렬: 접수중(마감 가까운 순) → 예정(시작 가까운 순) → 상시 → 기타
function sortKey(p) {
  if (p.status === 'open') return [0, p.apply_end || '9999-12-31'];
  if (p.status === 'upcoming') return [1, p.apply_begin || '9999-12-31'];
  if (p.status === 'always') return [2, p.created || '0000'];
  return [3, p.created || '0000'];
}

function loadSeed() {
  const seedPath = path.join(__dirname, '..', 'assets', 'data', 'seed.json');
  try {
    const raw = JSON.parse(fs.readFileSync(seedPath, 'utf-8'));
    return Array.isArray(raw.programs) ? raw.programs : [];
  } catch (e) {
    console.warn('[collect] 시드 없음/파싱 실패 — 건너뜀');
    return [];
  }
}

// 직전 결과(programs.json)를 읽는다. API 일시 장애로 이번 수집이 비거나
// 줄어도 '마감 안 지난' 이전 공고를 이월해 빈 화면을 막는다.
function loadPrevious() {
  const outPath = path.join(__dirname, '..', 'assets', 'data', 'programs.json');
  try {
    const prev = JSON.parse(fs.readFileSync(outPath, 'utf-8'));
    return Array.isArray(prev.programs) ? prev.programs : [];
  } catch (e) {
    return [];
  }
}

async function main() {
  const env = process.env;
  const collected = [];
  const summary = [];

  for (const s of SOURCES) {
    if (s.enabled === false) { summary.push({ source: s.id, label: s.label, count: 0, skipped: '준비 중' }); continue; }
    if (s.requiresEnv && !env[s.requiresEnv]) {
      summary.push({ source: s.id, label: s.label, count: 0, skipped: `${s.requiresEnv} 없음` });
      console.warn(`[collect] ${s.id} 건너뜀 — ${s.requiresEnv} 없음`);
      continue;
    }
    try {
      console.log(`[collect] ${s.id} 수집 시작…`);
      const evs = await s.fetchEvents(env);
      collected.push(...evs);
      summary.push({ source: s.id, label: s.label, count: evs.length });
      console.log(`[collect] ${s.id}: ${evs.length}건`);
    } catch (err) {
      summary.push({ source: s.id, label: s.label, count: 0, error: err.message });
      console.warn(`[collect] ${s.id} 실패: ${err.message}`);
    }
  }

  // 직전 결과에서 '마감 안 지난' API 공고만 이월(빈 화면·정보 증발 방지).
  // 단, 이번에 결과를 낸 소스의 옛 공고는 이월하지 않는다.
  //   그 소스는 멀쩡히 살아있으므로, 이번에 안 들어온 건 마감됐거나
  //   필터에서 일부러 뺀 것이다. 무조건 이월하면 필터를 좁혀도 걸러낸
  //   공고가 되살아난다(나라장터 트림 직후 실제로 77건이 돌아왔다).
  // 이월은 소스가 0건일 때 — 즉 키 누락·API 장애일 때만 의미가 있다.
  const liveSources = new Set(summary.filter(s => s.count > 0).map(s => s.source));
  const prevCarry = loadPrevious().filter(p =>
    p.source !== 'seed' && !liveSources.has(p.source) &&
    p.apply_end && p.apply_end >= todayStr
  );

  // 시드(큐레이션) 병합 — 항상 포함
  const seed = loadSeed();

  // 중복 제거(공고명 기준). 우선순위: 이번 수집 > 이월분 > 시드.
  const seen = new Set();
  const merged = [];
  let carriedIn = 0;
  for (const p of [...collected, ...prevCarry, ...seed]) {
    if (!p.title) continue;
    const key = normTitle(p.title);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(p);
  }
  // 실제 이월 반영 수 = 병합 결과 중 이번 collected에 없던 비시드 항목
  const collectedKeys = new Set(collected.map(p => normTitle(p.title)));
  carriedIn = merged.filter(p => p.source !== 'seed' && !collectedKeys.has(normTitle(p.title))).length;
  if (carriedIn) console.log(`[collect] 이전 공고 이월: ${carriedIn}건(이번 수집에 없던 미마감분)`);

  summary.push({ source: 'carryover', label: '이전 미마감 공고 이월(빈칸 방지)', count: carriedIn });
  summary.push({ source: 'seed', label: '운영팀 큐레이션(상시 채널·대표 사업)', count: seed.length });

  const programs = merged
    .map(decorate)
    .sort((a, b) => {
      const [ar, av] = sortKey(a), [br, bv] = sortKey(b);
      return ar !== br ? ar - br : (av < bv ? -1 : av > bv ? 1 : 0);
    })
    .map((p, i) => ({ id: 'p' + (i + 1), ...p }));

  const apiCount = collected.length;
  const feedCount = programs.filter(p => p.source !== 'seed').length; // 구체 공모(본문) 수
  const degraded = apiCount === 0;  // 이번 수집에서 API가 0건 → 이월/시드로 버틴 상태

  const output = {
    generated_at: new Date().toISOString(),
    generated_at_kst: KST().toISOString().replace('T', ' ').replace(/\..+/, ' KST'),
    is_sample: feedCount === 0,   // 본문(구체 공모)이 완전히 비었을 때만 샘플 표시
    degraded,                     // API 일시 장애로 이전 정보로 버티는 중
    sources: summary,
    count: programs.length,
    open_count: programs.filter(p => p.status === 'open').length,
    urgent_count: programs.filter(p => p.urgent).length,
    contest_count: programs.filter(p => p.kind === '공모전').length,
    programs,
  };

  // 안전장치: 이번 결과의 본문이 비었는데 직전 결과엔 본문이 있었다면,
  // 빈 데이터로 라이브를 덮지 않는다(이전 programs.json 유지하고 종료).
  const outPath = path.join(__dirname, '..', 'assets', 'data', 'programs.json');
  if (feedCount === 0) {
    const prevFeed = loadPrevious().filter(p => p.source !== 'seed').length;
    if (prevFeed > 0) {
      console.warn(`[collect] ⚠ 이번 본문 0건(직전 ${prevFeed}건) — 빈칸 방지로 이전 데이터 유지하고 종료(덮어쓰지 않음)`);
      return;
    }
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf-8');

  console.log(`[collect] 저장 완료 → ${outPath}`);
  console.log(`[collect] 총 ${programs.length}건(접수중 ${output.open_count} · 마감임박 ${output.urgent_count} · 공모전 ${output.contest_count}) · 소스: ${summary.map(s => `${s.source}(${s.count})`).join(', ')}`);
}

main().catch(err => {
  console.error('[collect] 실패:', err);
  process.exit(1);
});
