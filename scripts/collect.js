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
  return { ...p, status, dday, urgent: status === 'open' && dday !== null && dday <= 7 };
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

  // 시드(큐레이션) 병합 — 항상 포함
  const seed = loadSeed();
  summary.push({ source: 'seed', label: '운영팀 큐레이션(상시 채널·대표 사업)', count: seed.length });

  // 소스 간 중복 제거(공고명 기준). API 공고가 시드 항목보다 우선.
  const seen = new Set();
  const merged = [];
  for (const p of [...collected, ...seed]) {
    if (!p.title) continue;
    const key = normTitle(p.title);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(p);
  }

  const programs = merged
    .map(decorate)
    .sort((a, b) => {
      const [ar, av] = sortKey(a), [br, bv] = sortKey(b);
      return ar !== br ? ar - br : (av < bv ? -1 : av > bv ? 1 : 0);
    })
    .map((p, i) => ({ id: 'p' + (i + 1), ...p }));

  const apiCount = collected.length;
  const output = {
    generated_at: new Date().toISOString(),
    generated_at_kst: KST().toISOString().replace('T', ' ').replace(/\..+/, ' KST'),
    is_sample: apiCount === 0, // API 데이터가 0이면 시드만 — 샘플 표시
    sources: summary,
    count: programs.length,
    open_count: programs.filter(p => p.status === 'open').length,
    urgent_count: programs.filter(p => p.urgent).length,
    programs,
  };

  const outPath = path.join(__dirname, '..', 'assets', 'data', 'programs.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf-8');

  console.log(`[collect] 저장 완료 → ${outPath}`);
  console.log(`[collect] 총 ${programs.length}건(접수중 ${output.open_count} · 마감임박 ${output.urgent_count}) · 소스: ${summary.map(s => `${s.source}(${s.count})`).join(', ')}`);
}

main().catch(err => {
  console.error('[collect] 실패:', err);
  process.exit(1);
});
