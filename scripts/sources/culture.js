/*
 * 소스: 문화포털 (culture.go.kr) — 문화지원사업 캘린더에서 '공모전'만
 * ─────────────────────────────────────────────
 * 한국문화정보원이 전국 문화재단·진흥원·공공기관의 모집 공고를 한곳에 모은
 * "문화지원사업 캘린더"를 읽어, 그중 **응모해서 겨루는 공모전**만 추린다.
 *
 * 이 소스가 필요한 이유:
 *   기업마당·나라장터는 '지원사업/용역'이 중심이라 공모전이 거의 안 잡힌다
 *   (실측: 252건 중 공모전 성격 3건). 공모전은 대부분 문화재단이 주최하고,
 *   그 공고가 모이는 공식 창구가 바로 이 캘린더다.
 *
 * 인증키가 필요 없다. 목록 페이지 한 번이면 '진행중' 공고 전체가 내려온다
 *   (2026-09 실측 372건 · 문화·예술/체육·스포츠 등 4개 분야).
 *   신청기간·지역·신청링크는 목록에 없어서, 공모전 후보만 상세를 더 읽는다.
 *
 * 중장년 필터를 여기선 다르게 쓴다:
 *   지원사업과 달리 공모전은 대개 나이 제한이 없다("일반인 누구나").
 *   '중장년' 키워드로 거르면 0건이 되므로, 반대로
 *   **중장년이 응모할 수 없는 것**(청년·학생·어린이·외국인 전용)만 걷어낸다.
 */

const LIST_URL = 'https://www.culture.go.kr/portal/cltBnf/cltSupCalndr/list.do'
  + '?menuNo=200067&searchFldCd=01&hidSubType=W&viewTp=3&indRow=0';
const VIEW_BASE = 'https://www.culture.go.kr/portal/cltBnf/cltSup/view.do';
const UA = 'Mozilla/5.0 (compatible; gongmo-collector/1.0; +https://github.com/SHHan-0426)';

const MAX_DETAIL = 150;   // 상세를 읽을 최대 건수(예의상 상한)
const DETAIL_GAP = 300;   // 상세 요청 간격(ms) — 상대 서버 배려

// 응모해서 겨루는 '공모전'인지 판단.
// STRONG: 단어 자체로 공모전이 확실한 것.
const CONTEST_STRONG = /공모전|경진대회|콘테스트|공모대전|공모 ?축제|백일장|어워즈|어워드/;
// "○○ 공모" 형태 중 창작물을 받아 겨루는 것들.
const CONTEST_COMBO = /(아이디어|사연|수기|체험기|후기|영상|숏폼|사진|영상물|디자인|웹툰|만화|캐릭터|네이밍|이름|슬로건|표어|문예|시나리오|시놉시스|작품|작품집|공모작|포스터|굿즈|상품|정책|제안)\s*공모/;
// '공모'라는 말은 쓰지만 겨루는 공모전이 아닌 것(대관·입주·조달·선정 등) → 제외.
const NOT_CONTEST = /대관|입주(자|기업)?|공급기업|참여기업|입점|위탁|용역|소장품\s*구입|보증|사업자\s*선정|운영자\s*모집|강사\s*모집|수탁|임대|매각|채용|인턴/;

// 중장년이 응모할 수 없는 전용 공모 → 제외.
const AGE_LOCKED = /청년|대학생|초등|중학생|고등학생|초·?중·?고|학생부|어린이|아동|청소년|미취학|외국인\s*(대상|한정|만)|유학생|재외동포|20대|30대\s*이하/;
// 위 단어가 있어도 '누구나·전 국민·일반부'가 함께 있으면 전용이 아니다.
const OPEN_TO_ALL = /누구나|전\s*국민|일반부|제한\s*없(음|이)|연령\s*무관|국민\s*누구나/;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// 문화포털 본문에는 &middot; &lsquo; &#39; 같은 엔티티가 그대로 섞여 온다.
const ENTITIES = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  middot: '·', hellip: '…', ndash: '–', mdash: '—',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
  laquo: '«', raquo: '»', deg: '°', times: '×', bull: '•',
};

function decodeEntities(s = '') {
  return String(s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

function strip(s = '') {
  return decodeEntities(String(s).replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

async function getHtml(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'ko' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${url.slice(0, 80)}`);
  return res.text();
}

// 목록 페이지에서 공고 카드를 모두 뽑는다.
// 카드 한 장: 기관(logo) · 제목(tit__title) · 지원대상(support-txt) · 사업유형 배지 · 마감일 · rcrtSn
function parseList(html) {
  const blocks = html.match(/<div class="cs-list__content cs-list__content--type2">[\s\S]*?<\/li>/g) || [];
  const bySn = new Map();
  for (const b of blocks) {
    const sn = (b.match(/rcrtSn=(\d+)/) || [])[1];
    if (!sn || bySn.has(sn)) continue;   // 같은 공고가 분야별로 중복 노출된다
    // 기관명은 <a class="logo"> 또는 <div class="logo"> 두 형태로 나온다.
    const org = strip((b.match(/class="logo"[^>]*>([\s\S]*?)<\/(?:a|div)>/) || [])[1]);
    const title = strip((b.match(/class="tit__title">([\s\S]*?)<\/span>/) || [])[1]);
    if (!title) continue;
    bySn.set(sn, {
      sn,
      org,
      title,
      target: strip((b.match(/class="support-txt">([\s\S]*?)<\/span>/) || [])[1]),
      types: [...b.matchAll(/class="badge-box">([\s\S]*?)<\/div>/g)].map(m => strip(m[1])).filter(Boolean),
      deadline: (b.match(/class="d-day">[\s\S]*?class="num">([\d-]+)</) || [])[1] || null,
    });
  }
  return [...bySn.values()];
}

function isContest(it) {
  const t = it.title;
  if (NOT_CONTEST.test(t)) return false;
  return CONTEST_STRONG.test(t) || CONTEST_COMBO.test(t);
}

// 중장년이 응모 가능한가. 특정 연령·신분 전용이면 제외한다.
function openToMidlife(it) {
  const t = `${it.title} ${it.target}`;
  if (OPEN_TO_ALL.test(t)) return true;
  return !AGE_LOCKED.test(t);
}

// 문화포털 '지원대상'을 사이트 공통 신청주체로 옮긴다.
function applicantType(target = '') {
  if (/일반인/.test(target)) return '개인';
  if (/예술인|관련종사자/.test(target)) return '개인';
  if (/기업|단체/.test(target)) return '기업·기관';
  return '확인필요';
}

// 공모전 분야. 제목에서 무엇을 내는 공모인지 읽는다.
function mapField(title = '', types = []) {
  const t = title + ' ' + types.join(' ');
  if (/수기|사연|체험기|후기|문예|백일장|시나리오|소설|에세이|글쓰기|논문|평론|창작시|시\(詩\)|산문|기사/.test(t)) return '글·이야기';
  if (/사진|영상|숏폼|영화|웹툰|만화|일러스트|디자인|포스터|캐릭터|굿즈|건축|조경|미술|회화|공예/.test(t)) return '창작·디자인';
  if (/아이디어|정책|제안|해커톤|데이터|AI|창업/.test(t)) return '아이디어·정책';
  if (/음악|공연|연극|무용|국악|밴드|합창/.test(t)) return '공연·음악';
  return '문화·기타';
}

// "2026-08-26 ~ 2026-09-03" 형태의 신청기간을 파싱.
function parsePeriod(text = '') {
  const dates = [];
  const re = /(\d{4})[-.\/](\d{1,2})[-.\/](\d{1,2})/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    dates.push(`${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`);
  }
  return { begin: dates[0] || null, end: dates[1] || null };
}

// 상세 페이지에서 신청기간·지역·신청링크를 보충한다.
// 상세는 <div class="info"> 안의 정의 목록(기관명·사업유형·지원대상·지역·신청기간)과
// 'go-new' 링크(주최기관 원문)로 이뤄져 있다.
function parseDetail(html) {
  const info = (html.match(/<div class="info">([\s\S]*?)<\/ul>/) || [])[1] || '';
  const field = (label) => {
    const m = info.match(new RegExp(`<span class="ttl">${label}</span>([\\s\\S]*?)</li>`));
    const v = m ? strip(m[1]) : '';
    return v === '-' ? '' : v;    // 값이 없으면 '-'로 표시된다
  };
  // '신청사이트 바로가기'가 가리키는 주최기관 원문 링크
  const site = (html.match(/<a\s+href="(https?:\/\/[^"]+)"[^>]*>\s*(?:<[^>]*>\s*)*신청사이트/) || [])[1];
  return {
    period_text: field('신청기간'),
    region: field('지역'),
    apply_url: site ? decodeEntities(site) : null,
  };
}

// 본문이 이미지 한 장뿐인 공고가 많다. 그럴 때 페이지 하단의 안내 문구가
// 요약으로 끌려오지 않도록, 아래 문구가 나오면 거기서 잘라낸다.
const BOILERPLATE = /사업관련 자세한 문의|관심기관 미등록|신청사이트 바로가기|마이페이지 바로가기|첨부(된 파일|파일)|본 공고는 국문\/영문/;

// 상세 본문(#contentdata)에서 사람이 읽을 한 줄 요약을 만든다.
function summaryFrom(html) {
  const body = (html.match(/id="contentdata">([\s\S]*?)(?=<div class="foot|<div class="btn|관련기관 안내)/) || [])[1] || '';
  let text = strip(body.replace(/<script[\s\S]*?<\/script>/g, ''))
    // 태그를 지우면서 벌어진 괄호·문장부호 앞뒤 공백을 다시 붙인다
    .replace(/\(\s+/g, '(').replace(/\s+\)/g, ')')
    .replace(/\s+([,.·%])/g, '$1').replace(/·\s+/g, '·')
    .replace(/^[^가-힣A-Za-z0-9]+/, '');
  const cut = text.search(BOILERPLATE);
  if (cut >= 0) text = text.slice(0, cut).trim();
  return text.length >= 20 ? text.slice(0, 200) : '';
}

async function fetchEvents() {
  const list = parseList(await getHtml(LIST_URL));
  const cands = list.filter(it => isContest(it) && openToMidlife(it)).slice(0, MAX_DETAIL);

  const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  const out = [];
  for (const it of cands) {
    const url = `${VIEW_BASE}?viewTp=3&rcrtSn=${it.sn}&menuNo=200104`;
    let d = { period_text: '', region: '', apply_url: null };
    let summary = '';
    try {
      const html = await getHtml(url);
      d = parseDetail(html);
      summary = summaryFrom(html);
    } catch (e) {
      // 상세 하나가 실패해도 목록 정보만으로 카드를 낸다(빈 화면 방지 원칙).
    }
    const p = parsePeriod(d.period_text);
    const end = p.end || it.deadline || null;
    if (end && end < today) continue;   // 이미 마감

    out.push({
      kind: '공모전',
      title: it.title,
      summary,
      field: mapField(it.title, it.types),
      organizer: it.org,
      region: d.region || '',
      target: it.target || '제한 없음',
      applicant: applicantType(it.target),
      apply_begin: p.begin,
      apply_end: end,
      always: false,
      period_text: d.period_text || (end ? `~ ${end}` : ''),
      created: '',
      url,
      apply_url: d.apply_url,
      tags: ['공모전', ...it.types].filter(Boolean).slice(0, 4),
      source: 'culture',
    });
    await sleep(DETAIL_GAP);
  }
  return out;
}

module.exports = {
  id: 'culture',
  label: '문화포털 — 문화지원사업 캘린더(공모전 필터)',
  requiresEnv: null,   // 인증키 불필요
  enabled: true,
  fetchEvents,
  // 테스트용 내부 함수 공개
  _internal: { parseList, isContest, openToMidlife, mapField, parseDetail, parsePeriod },
};
