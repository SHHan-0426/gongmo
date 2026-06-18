/*
 * 소스: 조달청 나라장터 — 입찰공고정보서비스(용역)
 * ─────────────────────────────────────────────
 * 정부·지자체·공공기관이 발주하는 '용역' 입찰공고 중, 중장년 네트워크나
 * 협동조합·단체가 실제 응찰할 만한 사회서비스성 용역만 추려 반환한다.
 *   예) 행사 운영대행 · 교육/연수 운영 · 조사·연구 · 공동체 역량강화 ·
 *       일자리/사회적경제 박람회 · 돌봄/복지 프로그램 운영
 *
 * '개인 공모'가 아니라 '단체·기업이 응찰하는' 영역이므로 applicant='기업·기관'.
 * (두두협동조합·컴투게더 같은 조직이 직접 수주할 수 있는 기회를 모으는 소스)
 *
 * 인증키(env.NARA_API_KEY)는 공공데이터포털에서
 *   "조달청_나라장터 입찰공고정보서비스"(15129394) 활용신청 → 발급되는
 *   일반 인증키(serviceKey). gov24와 같은 data.go.kr 계정 키를 써도 된다
 *   (해당 데이터 활용신청만 별도로 하면 됨).
 *
 * 엔드포인트: https://apis.data.go.kr/1230000/ad/BidPublicInfoService/getBidPblancListInfoServc
 *   파라미터: serviceKey · inqryDiv=1(공고게시일시 기준) · inqryBgnDt · inqryEndDt
 *            (YYYYMMDDHHMM) · pageNo · numOfRows · type=json
 *   응답: { response:{ body:{ totalCount, items:[ … ] } } }
 *   필드(2026-06 확인): bidNtceNm(공고명) · ntceInsttNm(공고기관) · dminsttNm(수요기관)
 *     · bidClseDt(입찰마감일시) · bidBeginDt(입찰개시) · bidNtceDt(공고일시)
 *     · bidNtceDtlUrl(상세URL) · asignBdgtAmt(배정예산) · presmptPrce(추정가격)
 *     · cntrctCnclsMthdNm(계약방법) · srvceDivNm(용역구분)
 *
 * ⚠ 나라장터 용역은 양이 매우 많다(7일 약 3,900건). 대부분 IT·건설·시설·장비라
 *    무관 → CORE 키워드 매칭 AND EXC 제외로 사회서비스성만 남긴다.
 *    공고게시일 기준 최근 LOOKBACK일치를 훑는다(긴 마감은 일부 놓칠 수 있음).
 */

const ENDPOINT = 'https://apis.data.go.kr/1230000/ad/BidPublicInfoService/getBidPblancListInfoServc';
const PER = 100;
const MAX_PAGES = 60;     // 최대 6,000건(최근 발주분 풀)
const LOOKBACK_DAYS = 10; // 공고게시일 기준 조회 범위

// 단체·협동조합이 수행 가능한 사회서비스성 용역 신호
const CORE = [
  '중장년', '신중년', '노인', '어르신', '고령', '시니어', '베이비부머',
  '은퇴', '퇴직', '경력', '일자리', '취업', '재취업', '전직',
  '돌봄', '복지', '사회적경제', '협동조합', '마을', '공동체', '자원봉사',
  '평생교육', '생애', '상담', '사회공헌', '커뮤니티', '주민', '세대',
  '인생', '문화예술', '마을기업', '역량강화', '박람회', '포럼', '축제',
];
// 명백히 무관(기술·건설·시설·장비·임차)
const EXC = [
  '건설', '토목', '전기', '소방', '정보시스템', '전산', '소프트웨어', '시스템',
  '클라우드', '네트워크', '인프라', '유지보수', '청소', '경비', '시설',
  '방역', '조경', '측량', '감리', '설계', '폐기물', '상하수도', '도로', '포장',
  '임차', '임대', '차량', '장비', '수리', '점검', '구매', '구입', '살수차',
  '정비', '인공지능', '빅데이터', '반도체', '국방', '보안', 'R&D',
  '유지관리', '교량', '항만', '플랜트', '발전소', '준설', '터널', '관로',
  '정수장', '하수', '기계설비', '해상', '댐', '전력', '통신망',
];

const KST = () => new Date(Date.now() + 9 * 3600 * 1000);

function ymdhm(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}`;
}

function dateOnly(s = '') {
  const m = String(s).match(/(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function relevant(name = '') {
  return CORE.some(k => name.includes(k)) && !EXC.some(k => name.includes(k));
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

  const todayStr = now.toISOString().slice(0, 10);
  const out = [];
  for (let p = 1; p <= MAX_PAGES; p++) {
    const { rows } = await fetchPage(key, bgn, end, p);
    if (!rows.length) break;
    for (const r of rows) {
      const name = (r.bidNtceNm || '').trim();
      if (!relevant(name)) continue;
      const end_ = dateOnly(r.bidClseDt);
      if (end_ && end_ < todayStr) continue; // 마감 지난 건 제외
      const budget = won(r.asignBdgtAmt || r.presmptPrce);
      const demand = (r.dminsttNm || '').trim();
      out.push({
        title: name,
        summary: [demand && `수요기관 ${demand}`, budget && `추정/배정 ${budget}`,
          (r.cntrctCnclsMthdNm || '').trim()].filter(Boolean).join(' · '),
        field: '용역입찰',
        organizer: (r.ntceInsttNm || '').trim(),
        executor: '',
        target: '응찰 단체·기업',
        applicant: '기업·기관',
        apply_begin: dateOnly(r.bidBeginDt) || dateOnly(r.bidNtceDt),
        apply_end: end_,
        always: false,
        period_text: (r.bidClseDt || '').trim() ? `마감 ${(r.bidClseDt || '').trim()}` : '',
        created: dateOnly(r.bidNtceDt),
        url: (r.bidNtceDtlUrl || '').trim() || 'https://www.g2b.go.kr',
        tags: ['나라장터', (r.cntrctCnclsMthdNm || '').trim()].filter(Boolean).slice(0, 3),
        source: 'narajangteo',
      });
    }
    if (rows.length < PER) break;
  }
  return out;
}

module.exports = {
  id: 'narajangteo',
  label: '나라장터 — 용역 입찰(단체·사회서비스 필터)',
  requiresEnv: 'NARA_API_KEY',
  enabled: true,
  fetchEvents,
};
