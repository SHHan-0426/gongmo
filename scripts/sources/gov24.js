/*
 * 소스: 정부24 · 보조금24 — 대한민국 공공서비스(혜택) 정보 (gov24 v3)
 * ─────────────────────────────────────────────
 * 중앙부처·지자체·공공기관이 제공하는 '개인이 신청하는' 공공서비스(혜택·지원금)
 * 중 중장년 관련 + 신청기한이 있는 것만 정규화해서 반환한다.
 * bizinfo가 기업지원 편중이라, 개인이 직접 공모·신청 가능한 사업을 보강하는 소스.
 *
 * 인증키(env.GOV24_API_KEY)는 공공데이터포털(data.go.kr)에서
 *   "행정안전부_대한민국 공공서비스(혜택) 정보"(15113968) 활용신청 → 발급되는
 *   일반 인증키(serviceKey). data.go.kr 계정 인증키는 계정 단위라,
 *   today-go의 DATAGO_API_KEY와 같은 키를 써도 되지만(해당 데이터 활용신청 필요),
 *   구분을 위해 별도 env 이름을 둔다.
 *
 * 엔드포인트: https://api.odcloud.kr/api/gov24/v3/serviceList
 *   파라미터: serviceKey · page · perPage(최대 100)
 *   응답: { currentCount, data:[ … ], totalCount, page, perPage }
 *   data 항목(한글 키): 서비스명 · 서비스목적요약 · 신청기한 · 지원내용 · 지원대상
 *     · 소관기관명 · 부서명 · 사용자구분 · 신청방법 · 상세조회URL · 지원유형 · 서비스ID
 *
 * ⚠ 검증 결과(2026-06-18, 실키로 전수 점검): 전체 10,957건 중 중장년 매칭 328건
 *   (개인 288)이나, 신청기한에 '실제 미래 마감일'이 있는 건 단 3건이고 그마저
 *   상시성 복지 혜택(무더위 안전숙소·농기계구입비·고령운전자 면허반납)이었다.
 *   나머지는 전부 '상시신청·접수기관별 상이' 복지 혜택 → 이 소스는 '복지 혜택
 *   디렉터리'이지 '마감 있는 공모 피드'가 아니다. 우리 목표(그때그때 공모하는
 *   정책사업)와 맞지 않아 메인 피드에서 제외한다(enabled:false).
 *
 *   → 코드는 보존: 향후 '중장년 상시 혜택' 별도 탭을 만들 경우 그대로 활용 가능.
 *      되살리려면 enabled:true + 복지 혜택 노이즈 필터(수술·검진·돌봄·연금 등 제외)
 *      를 추가할 것. 응답 필드명은 본 모듈과 일치함을 확인했다.
 */

const ENDPOINT = 'https://api.odcloud.kr/api/gov24/v3/serviceList';
const PER = 100;
const MAX_PAGES = 60;     // 최대 6,000건까지 훑는다(전체 공공서비스 풀)

// 중장년 신호(개인 대상이므로 연령·생애 키워드 위주)
const MIDLIFE = [
  '중장년', '신중년', '중년', '장년', '50+', '50플러스', '4050', '5060', '4060',
  '시니어', '실버', '고령', '노년', '베이비부머', '은퇴', '퇴직', '전직',
  '재취업', '인생이모작', '이모작', '후반생', '생애전환', '경력단절',
  '만 50세', '만50세', '만 40세', '만40세', '50세 이상', '60세 이상',
];

function pick(o, ...keys) {
  for (const k of keys) if (o[k] != null && o[k] !== '') return o[k];
  return '';
}

function mapField(text = '') {
  if (/창업|재창업|창직/.test(text)) return '창업';
  if (/일자리|취업|재취업|채용|고용|구직|전직/.test(text)) return '일자리';
  if (/교육|강좌|평생교육|훈련|역량/.test(text)) return '교육';
  if (/사회공헌|자원봉사|공익/.test(text)) return '사회공헌';
  if (/복지|돌봄|건강|의료|연금|수당|바우처/.test(text)) return '복지';
  if (/문화|예술|관광/.test(text)) return '문화';
  if (/금융|자금|융자|대출|보증/.test(text)) return '금융';
  return '기타';
}

// 신청기한 텍스트 → {begin,end,always}
function parsePeriod(text = '') {
  const t = String(text).replace(/\s/g, '');
  const dates = [];
  const re = /(\d{4})[-.\/]?(\d{1,2})[-.\/]?(\d{1,2})/g;
  let m;
  while ((m = re.exec(t)) !== null) {
    const mo = m[2].padStart(2, '0'), d = m[3].padStart(2, '0');
    if (+mo >= 1 && +mo <= 12 && +d >= 1 && +d <= 31) dates.push(`${m[1]}-${mo}-${d}`);
  }
  const always = /상시|수시|연중|접수기관|소진|예산범위|자세/.test(t) && dates.length === 0;
  return { begin: dates[0] || null, end: dates[1] || dates[0] || null, always };
}

function cleanText(s = '') {
  return String(s).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ').trim();
}

async function fetchPage(key, page) {
  const url = `${ENDPOINT}?page=${page}&perPage=${PER}&serviceKey=${encodeURIComponent(key)}`;
  const res = await fetch(url);
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); }
  catch (e) { throw new Error(`JSON 파싱 실패: ${text.slice(0, 120)}`); }
  if (json.code && json.code < 0) throw new Error(`인증 오류: ${json.msg || json.code}`);
  return json.data || [];
}

async function fetchEvents(env) {
  const key = env.GOV24_API_KEY;
  if (!key) throw new Error('GOV24_API_KEY 없음');

  const all = [];
  for (let p = 1; p <= MAX_PAGES; p++) {
    const rows = await fetchPage(key, p);
    if (!rows.length) break;
    all.push(...rows);
    if (rows.length < PER) break;
  }

  const todayStr = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  const out = [];
  for (const r of all) {
    const name = pick(r, '서비스명');
    const purpose = pick(r, '서비스목적요약', '지원내용');
    const target = pick(r, '지원대상');
    const userType = pick(r, '사용자구분');
    const hay = `${name} ${purpose} ${target}`;
    if (!MIDLIFE.some(k => hay.includes(k))) continue;

    const period = parsePeriod(pick(r, '신청기한'));
    if (period.end && period.end < todayStr) continue; // 종료분 제외

    // 사용자구분이 '개인'이면 개인, '법인/단체/기업'이면 기업·기관
    let applicant = '확인필요';
    if (/개인/.test(userType)) applicant = '개인';
    else if (/법인|단체|기업|기관/.test(userType)) applicant = '기업·기관';
    else applicant = '개인'; // 보조금24는 대부분 개인 대상

    out.push({
      title: cleanText(name),
      summary: cleanText(purpose).slice(0, 200),
      field: mapField(`${pick(r, '지원유형')} ${name} ${purpose}`),
      organizer: cleanText(pick(r, '소관기관명', '부서명')),
      executor: '',
      target: cleanText(target) || '개인',
      applicant,
      apply_begin: period.begin,
      apply_end: period.end,
      always: period.always,
      period_text: cleanText(pick(r, '신청기한')) || (period.always ? '상시·접수기관별' : ''),
      created: cleanText(pick(r, '수정일시')).slice(0, 10),
      url: cleanText(pick(r, '상세조회URL')) || 'https://www.gov.kr/portal/rcvfvrSvc/main',
      tags: [pick(r, '지원유형')].filter(Boolean),
      source: 'gov24',
    });
  }
  return out;
}

module.exports = {
  id: 'gov24',
  label: '정부24·보조금24 — 공공서비스(중장년·개인 필터)',
  requiresEnv: 'GOV24_API_KEY',
  enabled: false,   // 검증 결과 '복지 혜택 디렉터리'라 메인 피드 제외(위 주석 참고)
  fetchEvents,
};
