# 공모 한눈에 — 중장년 정책·지원사업 모음

중장년이 **공모·신청할 수 있는** 정부·지자체·공공기관의 지원사업을
매일 모아 **마감 임박 순**으로 보여주는 한 페이지 사이트입니다.
중장년 네트워크 **컴투게더**의 자매 사이트(`today-go`와 같은 구조)입니다.

```
gongmo/
├─ index.html                  # 사이트 본체(필터·검색·카드)
├─ assets/data/
│  ├─ programs.json            # 화면이 읽는 최종 데이터(자동 생성물)
│  └─ seed.json                # 운영팀 큐레이션 시드(상시 채널·직접 추가 공모)
├─ scripts/
│  ├─ collect.js               # 수집 오케스트레이터
│  └─ sources/bizinfo.js       # 기업마당 지원사업 API 소스(중장년 필터)
└─ .github/workflows/collect-daily.yml   # 매일 06:30 KST 자동 수집
```

## 어떻게 채워지나

1. **기업마당 API**(`scripts/sources/bizinfo.js`)가 전체 지원사업 공고를 받아
   `중장년·신중년·50+·재취업·사회공헌 …` 키워드로 거른다.
2. **seed.json**의 운영팀 큐레이션(상시 공모 채널·직접 등록 공고)을 항상 병합한다.
3. 종료된 공고 제거 → 중복 제거 → 상태(접수중/예정/상시)·마감 D-day 계산 →
   마감 임박 순 정렬 → `programs.json` 저장.
4. GitHub Actions가 매일 새벽 돌려 자동 커밋·푸시 → Netlify가 라이브 반영.

API 키가 없으면 **시드 카드만으로도 사이트가 비지 않는다**(`is_sample: true` 표시).

## API 키 연결(1회 · 약 10분)

기업마당 공고를 자동 수집하려면 인증키(`crtfcKey`) 하나만 발급해 넣으면 됩니다.
이 키는 **공공데이터포털이 아니라 기업마당(bizinfo.go.kr) 자체에서** 발급합니다.

1. [기업마당](https://www.bizinfo.go.kr) 회원가입·로그인.
2. 상단 **활용정보 → 정책정보 개방**(또는 [apiList.do](https://www.bizinfo.go.kr/apiList.do))
   → **지원사업정보 API → 사용 신청/인증키 신청**.
3. 활용 목적과 **활용 URL/IP**를 입력해 신청(서비스 URL에 Netlify 주소를 적으면 됨).
   승인되면 **이메일로 `crtfcKey`가 발급**된다.
4. GitHub 저장소 → **Settings → Secrets and variables → Actions →
   New repository secret** → 이름 `BIZINFO_API_KEY`, 값에 발급키 붙여넣기.
5. **Actions** 탭 → "중장년 공모 일일 자동 수집" → **Run workflow**로 즉시 1회 실행.

> 참고: 신청서에 IP를 적어도 보통 IP에 묶이지 않는다. 만약 GitHub Actions에서
> `인증키 거부` 오류가 나면 키가 IP에 묶인 것이므로, 로컬에서
> `BIZINFO_API_KEY=발급키 node scripts/collect.js`로 받아 커밋하는 방식으로 운영한다.

## 새 공모를 직접 올리고 싶을 때

`assets/data/seed.json`의 `programs` 배열에 항목을 추가하면 됩니다.
마감일을 넣으면 자동으로 D-day·정렬에 반영됩니다.

```json
{
  "title": "○○구 신중년 인생이모작 지원사업",
  "summary": "한 줄 설명",
  "field": "일자리",
  "organizer": "○○구청",
  "target": "만 50~64세 ○○구민",
  "apply_begin": "2026-07-01",
  "apply_end": "2026-07-20",
  "always": false,
  "period_text": "2026-07-01 ~ 2026-07-20",
  "url": "https://…",
  "tags": ["신중년", "이모작"],
  "source": "seed"
}
```

## 로컬 실행

```bash
node scripts/collect.js              # 시드만으로 생성
BIZINFO_API_KEY=발급키 node scripts/collect.js   # API 포함 생성
# 미리보기: 아무 정적 서버로 루트 열기
```

## 분야 분류

`일자리 · 교육 · 창업 · 사회공헌 · 복지 · 문화 · 금융 · 판로 · 기타`
— 공고의 지원분야·제목·요약에서 자동 분류(`scripts/sources/bizinfo.js`의 `mapField`).

## 원칙

- 표시 정보는 각 기관 공고를 옮긴 것 — **신청 전 원문에서 자격·기간·서류 확인**.
- 추측성·미확인 정보는 올리지 않는다. 시드는 **공식 채널·확인된 사업**만.
