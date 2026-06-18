/*
 * 소스: 기업마당 (bizinfo.go.kr) — 지원사업정보 API
 * ─────────────────────────────────────────────
 * 중앙부처·지자체·공공기관의 최신 지원사업 공고 중 "중장년 관련"만
 * 키워드로 추려 정규화해서 반환한다.
 *
 * 인증키(env.BIZINFO_API_KEY)는 기업마당(bizinfo.go.kr) 자체에서 발급하는 crtfcKey.
 *   로그인 → 활용정보 > 정책정보 개방 > 지원사업정보 API 사용신청 → 이메일 발급.
 *
 * 엔드포인트: https://www.bizinfo.go.kr/uss/rss/bizinfoApi.do
 *   파라미터: crtfcKey · dataType=json · searchCnt · pageUnit · pageIndex
 *   응답 봉투: { jsonArray: [ … ] }
 *
 * 실제 응답 필드(2026-06 확인):
 *   pblancId(공고ID) · pblancNm(공고명) · bsnsSumryCn(요약) · trgetNm(지원대상)
 *   · jrsdInsttNm(소관기관) · excInsttNm(수행기관) · reqstBeginEndDe(접수기간 텍스트)
 *   · pldirSportRealmLclasCodeNm(지원분야 대분류) · creatPnttm(등록일시)
 *   · pblancUrl(상세 상대경로) · hashTags · inqireCo(조회수)
 *
 * 주의: bizinfo는 본래 기업·창업 지원이 중심이라 "중장년 직접 대상" 공고는
 *       전체의 일부다. 그래서 키워드 필터로 좁히고, 빈 화면은 사이트의
 *       시드 카드(programs.json 큐레이션)가 메운다.
 */

const ENDPOINT = 'https://www.bizinfo.go.kr/uss/rss/bizinfoApi.do';
const PAGE = 500;       // 페이지당 건수
const MAX_PAGES = 6;    // 최대 3,000건까지 훑는다(전체 공고 풀)

// 중장년 당사자가 공모·신청할 수 있는 사업을 가려내는 키워드.
// STRONG: 어디에 나와도 중장년 신호가 분명 → 본문 어디든 매칭.
// WEAK: 일반 사업 요약에도 우연히 섞이는 말(은퇴·퇴직·경력 등) →
//       제목·대상·해시태그에 나올 때만 매칭(오탐 억제).
const STRONG = [
  '중장년', '신중년', '중년', '4050', '5060', '4060',
  '50+', '50플러스', '50 플러스', '시니어', '실버',
  '베이비부머', '인생2막', '인생 2막', '인생이모작', '이모작',
  '후반생', '앙코르', '생애전환',
];
const WEAK = [
  '장년', '고령', '노년', '은퇴', '퇴직', '전직', '재취업', '경력단절',
];

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// 공고 요약의 HTML 태그 제거 + 엔티티 디코딩
function cleanText(s = '') {
  return String(s)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

// 분야 대분류명 → 사이트 공통 분야로 정규화
function mapField(raw = '', text = '') {
  const c = raw + ' ' + text;
  if (/창업|재창업|예비창업|창직/.test(c)) return '창업';
  if (/일자리|취업|재취업|채용|고용|인력|구직|전직/.test(c)) return '일자리';
  if (/교육|강좌|아카데미|역량|훈련|양성/.test(c)) return '교육';
  if (/사회공헌|자원봉사|공익활동/.test(c)) return '사회공헌';
  if (/복지|돌봄|건강|의료/.test(c)) return '복지';
  if (/문화|예술|콘텐츠/.test(c)) return '문화';
  if (/금융|자금|융자|보증|대출/.test(c)) return '금융';
  if (/수출|판로|마케팅|내수|글로벌/.test(c)) return '판로';
  return '기타';
}

// "20260601 ~ 20260630", "2026-06-01~2026-06-30", "2026.6.1 ~ 2026.6.30",
// "~ 예산 소진 시까지", "상시" 등을 견고하게 파싱.
function parsePeriod(text = '') {
  const t = String(text).replace(/\s/g, '');
  const dates = [];
  const re = /(\d{4})[-.\/]?(\d{1,2})[-.\/]?(\d{1,2})/g;
  let m;
  while ((m = re.exec(t)) !== null) {
    const y = m[1];
    const mo = m[2].padStart(2, '0');
    const d = m[3].padStart(2, '0');
    if (+mo >= 1 && +mo <= 12 && +d >= 1 && +d <= 31) dates.push(`${y}-${mo}-${d}`);
  }
  const isAlways = /상시|수시|소진|연중|마감시|예산범위/.test(t) && dates.length === 0;
  return {
    begin: dates[0] || null,
    end: dates[1] || (dates.length === 1 ? dates[0] : null),
    always: isAlways,
  };
}

// 신청 주체가 '개인'인지 '기업·기관'인지 추정.
// bizinfo는 기업지원 중심이라, 중장년 개인이 직접 신청 가능한 건만
// 골라 보려는 사용자를 위해 구분한다.
function applicantType(title = '', target = '') {
  const t = title + ' ' + target;
  const biz = /참여\s*기업|참가\s*기업|기업\s*모집|기업\s*컨설팅|사업장|참여\s*점포|참가\s*점포|기관\s*모집|참여\s*기관|중소기업|소상공인|소공인|법인/.test(t);
  const indiv = /참여자|참가자|예비\s*창업|입주|수강생|교육생|멘티|개인|시민|구직자|만\s*\d+세|참여\s*희망자/.test(t);
  if (indiv && !biz) return '개인';
  if (biz && !indiv) return '기업·기관';
  if (biz) return '기업·기관';
  return '확인필요';
}

function isMidlife(item) {
  const full = [
    item.pblancNm, item.bsnsSumryCn, item.trgetNm,
    item.hashtags, item.pldirSportRealmLclasCodeNm,
    item.pldirSportRealmMlsfcCodeNm,
  ].join(' ');
  if (STRONG.some(k => full.includes(k))) return true;
  // 약한 키워드는 제목·대상·해시태그에 나올 때만 인정
  const focus = [item.pblancNm, item.trgetNm, item.hashtags].join(' ');
  return WEAK.some(k => focus.includes(k));
}

function detailUrl(item) {
  const u = (item.pblancUrl || '').trim();
  if (u) return u.startsWith('http') ? u : `https://www.bizinfo.go.kr${u}`;
  if (item.pblancId) {
    return `https://www.bizinfo.go.kr/web/lay1/bbs/S1T122C128/AS/74/view.do?pblancId=${item.pblancId}`;
  }
  return 'https://www.bizinfo.go.kr/web/index.do';
}

async function fetchPage(key, pageIndex) {
  const url = `${ENDPOINT}?crtfcKey=${encodeURIComponent(key)}`
    + `&dataType=json&searchCnt=${PAGE}&pageUnit=${PAGE}&pageIndex=${pageIndex}`;
  const res = await fetch(url);
  const text = await res.text();
  if (text.includes('reqErr') || text.includes('인증키')) {
    throw new Error('인증키 거부 — BIZINFO_API_KEY 확인 필요');
  }
  let json;
  try { json = JSON.parse(text); }
  catch (e) { throw new Error(`JSON 파싱 실패: ${text.slice(0, 120)}`); }
  return json.jsonArray || [];
}

async function fetchEvents(env) {
  const key = env.BIZINFO_API_KEY;
  if (!key) throw new Error('BIZINFO_API_KEY 없음');

  const all = [];
  for (let p = 1; p <= MAX_PAGES; p++) {
    const rows = await fetchPage(key, p);
    if (!rows.length) break;
    all.push(...rows);
    if (rows.length < PAGE) break; // 마지막 페이지
    await sleep(250);
  }

  const todayStr = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  const out = [];
  for (const r of all) {
    if (!isMidlife(r)) continue;
    const period = parsePeriod(r.reqstBeginEndDe);
    // 종료된 공고 제외(끝 날짜가 오늘 이전). 상시·날짜불명은 남긴다.
    if (period.end && period.end < todayStr) continue;
    out.push({
      title: (r.pblancNm || '').trim(),
      summary: cleanText(r.bsnsSumryCn).slice(0, 200),
      field: mapField(r.pldirSportRealmLclasCodeNm, `${r.pblancNm} ${r.bsnsSumryCn}`),
      organizer: (r.jrsdInsttNm || r.excInsttNm || '').trim(),
      executor: (r.excInsttNm || '').trim(),
      target: (r.trgetNm || '제한 없음').trim() || '제한 없음',
      applicant: applicantType(r.pblancNm, r.trgetNm),
      apply_begin: period.begin,
      apply_end: period.end,
      always: period.always,
      period_text: (r.reqstBeginEndDe || '').trim() || (period.always ? '상시·예산 소진 시' : ''),
      created: (r.creatPnttm || '').slice(0, 10),
      url: detailUrl(r),
      tags: (r.hashtags || '').split(/[,#·\s]+/).filter(Boolean).slice(0, 5),
      source: 'bizinfo',
    });
  }
  return out;
}

module.exports = {
  id: 'bizinfo',
  label: '기업마당 — 지원사업정보(중장년 필터)',
  requiresEnv: 'BIZINFO_API_KEY',
  enabled: true,
  fetchEvents,
};
