/*
 * 소스: 조달청 나라장터 — 입찰공고정보서비스(용역)
 * ─────────────────────────────────────────────
 * 정부·지자체·공공기관이 발주하는 '용역' 입찰공고를 모은다.
 *
 * 2026-10-02부터 '중장년' 키워드로 고르지 않는다(운영팀 결정).
 *   전에는 공고명에 중장년·일자리·마을 같은 말이 있어야만 실었는데,
 *   이제는 면허·전문장비가 있어야만 하는 아주 특수한 용역만 빼고 전부 싣는다.
 *   무엇이 특수한지는 공고명 키워드가 아니라 조달청 공식 분류
 *   (pubPrcrmntLrgClsfcNm·pubPrcrmntMidClsfcNm)로 가른다 — 키워드는
 *   '세대'→'차세대', '마을'→'○○마을 해체공사' 식 오탐이 끊이지 않았다.
 *
 * '개인 공모'가 아니라 '단체·기업이 응찰하는' 영역이므로 applicant='기업·기관',
 * kind='용역입찰'(화면 기본에서는 빠지고 '종류' 칩으로 연다).
 * field에는 공식 대분류를 짧게 줄인 이름을 넣어 분야 칩으로 고를 수 있게 한다.
 *
 * 인증키(env.NARA_API_KEY)는 공공데이터포털에서
 *   "조달청_나라장터 입찰공고정보서비스"(15129394) 활용신청 → 발급되는
 *   일반 인증키(serviceKey). gov24와 같은 data.go.kr 계정 키를 써도 된다.
 *
 * 엔드포인트: https://apis.data.go.kr/1230000/ad/BidPublicInfoService/getBidPblancListInfoServc
 *   파라미터: serviceKey · inqryDiv=1(공고게시일시 기준) · inqryBgnDt · inqryEndDt
 *            (YYYYMMDDHHMM) · pageNo · numOfRows · type=json
 *   응답: { response:{ body:{ totalCount, items:[ … ] } } }
 *   필드: bidNtceNo(공고번호) · bidNtceOrd(차수) · ntceKindNm(등록/변경/재/취소공고)
 *     · bidNtceNm(공고명) · ntceInsttNm(공고기관) · dminsttNm(수요기관)
 *     · bidClseDt(입찰마감일시) · bidBeginDt(입찰개시) · bidNtceDt(공고일시)
 *     · bidNtceDtlUrl(상세URL) · asignBdgtAmt(배정예산) · presmptPrce(추정가격)
 *     · cntrctCnclsMthdNm(계약방법) · srvceDivNm(일반용역/기술용역)
 *     · pubPrcrmntLrgClsfcNm / pubPrcrmntMidClsfcNm(공공조달 대·중분류)
 *
 * 실측(2026-10-02, 공고게시 10일치): 4,372행 → 미마감 3,456행.
 *   대분류 분포 — 기술용역 916 · 행사·사업지원 532 · 연구조사 483 · ICT 424
 *   · 폐기물 287 · 임대·위탁·수리 223 · 교육·전문 206 · 여행·숙박·음식·운송·보험 202
 *   · 매체·디자인·홍보 101 · 시설물관리·청소 70 · 정보통신방송 11.
 */

const ENDPOINT = 'https://apis.data.go.kr/1230000/ad/BidPublicInfoService/getBidPblancListInfoServc';
const PER = 100;
const MAX_PAGES = 90;     // 최대 9,000행
const LOOKBACK_DAYS = 14; // 공고게시일 기준 조회 범위(수집이 주 1회라 10→14일)

// 빼는 것 ① 대분류 통째로 — 면허·전문장비·시설이 있어야만 하는 영역.
const EXCLUDE_LARGE = [
  '기술용역',                       // 설계·감리·측량·건설사업관리·안전점검
  '폐기물 처리 및 재활용서비스',
  '시설물관리 및 청소서비스',
  '임대*위탁 및 수리서비스',        // 장비 임대·수리, 공동주택 위수탁관리, 시설 민간위탁
  '정보통신방송서비스',             // 전용회선 등 통신사업자
];
// 빼는 것 ② 살리는 대분류 안의 일부 중분류 — 해당 업 면허가 있어야만 한다.
const EXCLUDE_MID = [
  '보험서비스',                     // 보험사
  '운송서비스',                     // 전세버스·화물 운수업
  '보건서비스',                     // 건강검진(의료기관)
  '기술시험,검사 및 분석',
  '문화재 조사/발굴 및 수리',
];

// 대분류 → 화면 분야 칩 이름
const FIELD_OF = {
  '행사관리 및 기타 사업 지원서비스': '행사·사업지원',
  '연구조사서비스': '연구·조사',
  '교육 및 전문직종/기술서비스': '교육·전문서비스',
  'ICT 서비스': 'ICT',
  '매체제작, 디자인, 홍보/마케팅 서비스': '홍보·디자인·매체',
  '여행*숙박*음식*운송 및 보험서비스': '여행·숙박·음식',
};

// 공식 분류로 '실을 용역인가'를 가른다. 수집 없이 필터만 검증할 수 있게 export.
function relevant(row = {}) {
  const large = (row.pubPrcrmntLrgClsfcNm || '').trim();
  const mid = (row.pubPrcrmntMidClsfcNm || '').trim();
  if ((row.srvceDivNm || '').trim() === '기술용역') return false;
  if (EXCLUDE_LARGE.includes(large)) return false;
  if (EXCLUDE_MID.includes(mid)) return false;
  return true;
}

const KST = () => new Date(Date.now() + 9 * 3600 * 1000);

function ymdhm(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}`;
}

function dateOnly(s = '') {
  const m = String(s).match(/(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function won(n) {
  const v = parseInt(String(n || '').replace(/[^0-9]/g, ''), 10);
  if (!v) return '';
  return v.toLocaleString('ko-KR') + '원';
}

async function fetchPage(key, bgn, end, page) {
  const url = `${ENDPOINT}?serviceKey=${encodeURIComponent(key)}`
    + `&inqryDiv=1&inqryBgnDt=${bgn}&inqryEndDt=${end}`
    + `&pageNo=${page}&numOfRows=${PER}&type=json`;
  const res = await fetch(url);
  const text = await res.text();
  if (text.startsWith('Unauthorized') || text.includes('SERVICE_KEY')) {
    throw new Error('인증키 거부/미등록 — NARA_API_KEY 확인 필요');
  }
  let json;
  try { json = JSON.parse(text); }
  catch (e) { throw new Error(`JSON 파싱 실패: ${text.slice(0, 100)}`); }
  const body = (json.response || {}).body || {};
  const items = body.items || [];
  const arr = Array.isArray(items) ? items : (items.item ? [].concat(items.item) : []);
  return { rows: arr, total: body.totalCount || 0 };
}

async function fetchEvents(env) {
  const key = env.NARA_API_KEY;
  if (!key) throw new Error('NARA_API_KEY 없음');

  const now = KST();
  const bgnDate = new Date(now.getTime() - LOOKBACK_DAYS * 86400000);
  const bgn = ymdhm(new Date(Date.UTC(bgnDate.getUTCFullYear(), bgnDate.getUTCMonth(), bgnDate.getUTCDate(), 0, 0)));
  const end = ymdhm(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59)));

  // 같은 공고가 차수(등록→변경→취소)별로 여러 행 온다. 공고번호별로 마지막
  // 차수만 남기고, 그 마지막이 취소공고면 버린다.
  const latest = new Map();
  for (let p = 1; p <= MAX_PAGES; p++) {
    const { rows } = await fetchPage(key, bgn, end, p);
    if (!rows.length) break;
    for (const r of rows) {
      const no = (r.bidNtceNo || '').trim() || `${r.bidNtceNm}|${r.ntceInsttNm}`;
      const prev = latest.get(no);
      if (!prev || String(r.bidNtceOrd || '') >= String(prev.bidNtceOrd || '')) latest.set(no, r);
    }
    if (rows.length < PER) break;
  }

  const todayStr = now.toISOString().slice(0, 10);
  const out = [];
  for (const [no, r] of latest) {
    const name = (r.bidNtceNm || '').trim();
    if (!name) continue;
    if ((r.ntceKindNm || '').includes('취소')) continue;
    if (!relevant(r)) continue;
    // 직접·우편 제출(직찰) 공고는 전자입찰 마감(bidClseDt)이 비어 있다(실측 12%).
    // 그때는 개찰일시를 마감으로 본다 — 제출은 그 전까지여야 한다.
    const direct = !(r.bidClseDt || '').trim();
    const closeAt = ((direct ? r.opengDt : r.bidClseDt) || '').trim();
    const end_ = dateOnly(closeAt);
    if (!end_ || end_ < todayStr) continue; // 마감 지났거나 알 수 없는 건 제외
    const budget = won(r.asignBdgtAmt || r.presmptPrce);
    const demand = (r.dminsttNm || '').trim();
    const large = (r.pubPrcrmntLrgClsfcNm || '').trim();
    const mid = (r.pubPrcrmntMidClsfcNm || '').trim();
    const method = (r.cntrctCnclsMthdNm || '').trim();
    out.push({
      uid: `nara:${no}`,   // 학교마다 같은 이름의 공고가 많다 — 공고명 대신 공고번호로 중복을 가린다
      title: name,
      summary: [demand && `수요기관 ${demand}`, budget && `추정/배정 ${budget}`, method].filter(Boolean).join(' · '),
      field: FIELD_OF[large] || '기타',
      organizer: (r.ntceInsttNm || '').trim(),
      executor: '',
      target: '응찰 단체·기업',
      applicant: '기업·기관',
      apply_begin: dateOnly(r.bidBeginDt) || dateOnly(r.bidNtceDt),
      apply_end: end_,
      always: false,
      period_text: `${direct ? '개찰(직접 제출)' : '마감'} ${closeAt.slice(0, 16)}`,
      created: dateOnly(r.bidNtceDt),
      url: (r.bidNtceDtlUrl || '').trim() || 'https://www.g2b.go.kr',
      tags: [mid && mid !== '기타' ? mid : '', method].filter(Boolean),
      kind: '용역입찰',
      source: 'narajangteo',
    });
  }
  return out;
}

module.exports = {
  relevant, // 필터만 따로 검증할 때 쓴다(수집은 실행되지 않음)
  id: 'narajangteo',
  label: '나라장터 — 용역 입찰(특수 용역 제외 전체)',
  requiresEnv: 'NARA_API_KEY',
  enabled: true,
  fetchEvents,
};
