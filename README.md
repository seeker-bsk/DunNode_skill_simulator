# DunNode — 던전앤파이터 스킬 시뮬레이터

> 한정된 SP로 최적의 스킬 트리를 구성하고,  
> 스킬 조합과 캐릭터 스펙을 기반으로 **N초 동안의 데미지 총량을 시뮬레이션**하는 도구.

---

## 목차

1. [개요](#개요)
2. [주요 기능](#주요-기능)
3. [아키텍처](#아키텍처)
4. [기술 스택](#기술-스택)
5. [시작하기](#시작하기)
6. [환경 변수](#환경-변수)
7. [데이터 파이프라인](#데이터-파이프라인)
8. [프로젝트 구조](#프로젝트-구조)
9. [지원 직업](#지원-직업)
10. [개발 마일스톤](#개발-마일스톤)

---

## 개요

DunNode는 **던전앤파이터(DNF)** 의 스킬 트리 구성 및 전투 시뮬레이션 도구입니다.  
모든 수치는 **만렙(115레벨) + 달인의 계약** 사용을 기준으로 계산됩니다.

| 핵심 목표 | 설명 |
|-----------|------|
| **SP 최적화** | 한정된 SP로 어떤 스킬 조합이 최고 DPS를 내는지 자동 계산 |
| **데미지 비교** | 스킬 트리를 변형했을 때 데미지가 얼마나 변하는지 % 단위로 비교 출력 |

---

## 주요 기능

### 스킬 트리
- SVG 기반 트리 시각화 (노드 클릭으로 레벨 조절)
- 트리 뷰 / 목록 뷰 전환
- 스킬 잠금(Lock) — 고정된 스킬을 최적화에서 제외
- 스킬 초기화 — 잠금 해제된 스킬 일괄 초기화

### 스킬 개화 & 강화
- 스킬 개화(Evolution) 선택 — 개화1 / 개화2 분기
- 스킬 강화(Enhancement) 선택 — 공격력 +55% 또는 공격력 +38% + CDR 15%

### 전투 시뮬레이터
- N초 동안의 타임라인 시뮬레이션 (우선순위 기반 스킬 로테이션)
- 총 데미지 계수 출력
- 스킬별 사용 횟수 · 기여도(%) 분석
- 아이콘 타임라인 시각화
- 이전 결과 대비 **데미지 변화율(%)** 실시간 표시

### 캐릭터 검색
- Neople 공식 API로 캐릭터 조회
- 스킬 레벨 · 개화/강화 · 쿨타임 감소 수치 자동 로드
- 검색 후 시뮬레이션 자동 1회 실행
- 최근 검색 기록 유지 (localStorage)

### UI/UX
- 다크 / 라이트 모드 지원
- 세션 유지 — 새로고침 후에도 스킬 트리 · 스탯 복원 (sessionStorage)
- Pretendard Variable 폰트

---

## 아키텍처

```
┌─────────────────────────────────────────────────────┐
│                    브라우저                           │
│         React (Vite)  ·  port 5173 (dev)             │
└───────────────────────┬─────────────────────────────┘
                        │ HTTP / JSON
┌───────────────────────▼─────────────────────────────┐
│              Node.js  ·  Express                     │
│                   port 5000                          │
│  - 스킬 데이터 제공     - 캐릭터 검색 프록시           │
│  - C 코어 subprocess 호출 (timeout 5s)               │
└───────────────────────┬─────────────────────────────┘
                        │ stdin/stdout (JSON)
┌───────────────────────▼─────────────────────────────┐
│                  C 실행파일                           │
│              core/simulator(.exe)                    │
│  - 트리 자료구조    - 스킬 수치 계산                  │
│  - 타임라인 시뮬레이터  - SP 최적화                   │
└─────────────────────────────────────────────────────┘
```

> **설계 원칙**  
> - 모든 시뮬레이션 비즈니스 로직은 **C 코어에만** 위치  
> - Node.js는 HTTP ↔ subprocess 중계 역할만 담당  
> - 프론트엔드는 데이터 시각화와 입력 수집만 담당 — 계산 로직 없음

---

## 기술 스택

| 레이어 | 기술 |
|--------|------|
| **C 코어** | C99 · cJSON · Makefile |
| **서버** | Node.js · Express · dotenv · nodemon |
| **프론트엔드** | React 19 · Vite 8 · react-icons |
| **스타일** | CSS Variables (다크/라이트 테마) · Pretendard Variable |
| **외부 API** | Neople 공식 Open API |

---

## 시작하기

### 사전 요구사항

- **Node.js** v18 이상
- **GCC** (Windows: MinGW, macOS: Xcode Command Line Tools, Linux: build-essential)
- **Neople Open API 키** — [Neople Developers](https://developers.neople.co.kr) 에서 발급

---

### 1. 저장소 클론

```bash
git clone https://github.com/<your-name>/DunNode_skill_simulator.git
cd DunNode_skill_simulator
```

---

### 2. C 코어 빌드

```bash
cd core
make
# → core/simulator (또는 Windows의 경우 core/simulator.exe) 생성
```

---

### 3. 환경 변수 설정

프로젝트 루트에 `.env` 파일을 생성합니다. ([환경 변수](#환경-변수) 섹션 참조)

```bash
cp .env.example .env
# .env 파일을 열어 NEOPLE_API_KEY 값을 입력
```

---

### 4. 스킬 데이터 준비

`data/skills/` 디렉토리에 `{jobGrowId}_merged.json` 파일이 필요합니다.  
직접 파이프라인을 실행하거나, 미리 준비된 파일을 복사합니다.

```bash
# API에서 수집 (base JSON 생성)
cd scripts
node fetch_skills.js --jobId=<jobId> --jobGrowId=<jobGrowId>

# base + manual → merged JSON 생성
node merge_skills.js --jobGrowId=<jobGrowId>
```

---

### 5. 서버 실행

```bash
cd server
npm install

# 개발 모드 (파일 변경 시 자동 재시작)
npm run dev

# 프로덕션 모드
node app.js
```

서버가 **http://localhost:5000** 에서 실행됩니다.

---

### 6. 프론트엔드 실행

```bash
cd frontend
npm install

# 개발 서버 (HMR)
npm run dev
# → http://localhost:5173

# 프로덕션 빌드
npm run build
```

> 개발 환경에서는 Vite dev server(5173)와 Express 서버(5000)를 **모두 실행**해야 합니다.  
> `vite.config.js`의 proxy 설정으로 API 요청이 5000으로 자동 전달됩니다.

---

### 빠른 실행 체크리스트

```
[ ] core/simulator 빌드 완료
[ ] .env에 NEOPLE_API_KEY 입력
[ ] data/skills/{jobGrowId}_merged.json 존재
[ ] npm install (server/, frontend/ 각각)
[ ] node app.js 실행
[ ] npm run dev 실행
[ ] http://localhost:5173 접속
```

---

## 환경 변수

`.env` 파일을 프로젝트 루트에 생성하고 아래 내용을 입력합니다.

```env
NEOPLE_API_KEY=your_api_key_here
```

| 변수명 | 필수 | 설명 |
|--------|------|------|
| `NEOPLE_API_KEY` | ✅ | Neople Open API 인증 키. 캐릭터 검색 및 스킬 데이터 수집에 사용 |

> ⚠️ `.env` 파일은 `.gitignore`에 포함되어 있으므로 절대 커밋하지 마세요.

---

## 데이터 파이프라인

스킬 데이터는 세 단계를 거쳐 생성됩니다.

```
Neople API
    │
    ▼  fetch_skills.js
{jobGrowId}_base.json      ← API 자동 수집 (수정 금지)
    │
    │  + 수동 작성
{jobGrowId}_manual.json    ← cast_time, SP 비용, 개화 수치 등
    │
    ▼  merge_skills.js
{jobGrowId}_merged.json    ← C 코어가 읽는 최종 파일
```

| 파일 | 설명 |
|------|------|
| `_base.json` | API에서 수집한 원본 데이터. **수정 금지** |
| `_manual.json` | 시전시간, SP 비용, 개화/강화 수치 등 수동 보완 |
| `_merged.json` | C 코어 입력용 최종 파일. `merge_skills.js`가 자동 생성 |

---

## 프로젝트 구조

```
DunNode_skill_simulator/
│
├── core/                          # C 코어 (시뮬레이션 엔진)
│   ├── main.c
│   ├── skill.h / skill.c          # 스킬 자료구조
│   ├── tree.h / tree.c            # 트리 자료구조
│   ├── simulator.h / simulator.c  # 타임라인 시뮬레이터
│   ├── json_parser.h / json_parser.c
│   ├── cJSON.h / cJSON.c          # 외부 JSON 라이브러리 (수정 금지)
│   └── Makefile
│
├── server/                        # Node.js Express 서버
│   ├── app.js
│   └── package.json
│
├── scripts/                       # 스킬 데이터 파이프라인
│   ├── fetch_skills.js            # Neople API → base JSON
│   └── merge_skills.js            # base + manual → merged JSON
│
├── data/
│   ├── jobs.json                  # 전체 직업 목록
│   └── skills/
│       ├── {jobGrowId}_base.json
│       ├── {jobGrowId}_manual.json
│       └── {jobGrowId}_merged.json
│
├── frontend/                      # React (Vite) 프론트엔드
│   ├── src/
│   │   ├── App.jsx
│   │   ├── components/
│   │   │   ├── Header.jsx
│   │   │   ├── HomePage.jsx       # 캐릭터 검색 / 직업 선택
│   │   │   ├── JobBanner.jsx
│   │   │   ├── SkillTree.jsx      # SVG 트리 시각화
│   │   │   ├── SkillListView.jsx
│   │   │   ├── BloomPanel.jsx     # 개화/강화 패널
│   │   │   ├── AnalysisPanel.jsx  # 시뮬레이션 결과 분석
│   │   │   └── StatsPanel.jsx     # 스펙 입력 + 시뮬 실행
│   │   ├── contexts/
│   │   │   └── ThemeContext.jsx
│   │   └── styles/
│   │       ├── global.css
│   │       └── animations.css
│   ├── index.html
│   └── package.json
│
├── media/                         # 이미지 에셋
│   ├── logo_dark.png
│   ├── logo_light.png
│   └── job_art/
│
├── .env                           # 환경 변수 (gitignore됨)
├── .gitignore
├── CLAUDE.md
├── MILESTONE.md
└── README.md
```

---

## 지원 직업

현재 스킬 데이터가 구축된 직업 목록입니다.  
`data/skills/` 에 `_merged.json` 파일을 추가하면 즉시 활성화됩니다.

| 캐릭터 | 지원 각성 직업 |
|--------|---------------|
| 귀검사(남) | 眞 웨펀마스터 · 眞 소울브링어 · 眞 버서커 · 眞 아수라 · 眞 검귀 |
| 귀검사(여) | 眞 소드마스터 · 眞 다크템플러 · 眞 데몬슬레이어 · 眞 베가본드 · 眞 블레이드 |
| 격투가(여) | 眞 넨마스터 · 眞 스트라이커 · 眞 스트리트파이터 · 眞 그래플러 |
| 격투가(남) | 眞 넨마스터 · 眞 스트라이커 · 眞 스트리트파이터 · 眞 그래플러 |
| 거너(남) | 眞 레인저 · 眞 런처 · 眞 메카닉 · 眞 스핏파이어 · 眞 어썰트 |
| 거너(여) | 眞 레인저 · 眞 런처 · 眞 메카닉 · 眞 스핏파이어 · 眞 패러메딕 |
| 마법사(여) | 眞 엘레멘탈마스터 · 眞 소환사 · 眞 배틀메이지 · 眞 마도학자 · 眞 인챈트리스 |
| 마법사(남) | 眞 엘레멘탈 바머 · 眞 빙결사 · 眞 블러드 메이지 · 眞 스위프트 마스터 · 眞 디멘션워커 |
| 프리스트(남) | 眞 크루세이더 · 眞 인파이터 · 眞 퇴마사 · 眞 어벤저 |
| 프리스트(여) | 眞 크루세이더 · 眞 이단심판관 · 眞 무녀 · 眞 미스트리스 |
| 도적 | 眞 로그 · 眞 사령술사 · 眞 쿠노이치 · 眞 섀도우댄서 |
| 나이트 | 眞 엘븐나이트 · 眞 카오스 · 眞 팔라딘 · 眞 드래곤나이트 |
| 마창사 | 眞 뱅가드 · 眞 듀얼리스트 · 眞 드래고니안 랜서 · 眞 다크 랜서 |
| 총검사 | 眞 히트맨 · 眞 요원 · 眞 트러블 슈터 · 眞 스페셜리스트 |
| 아처 | 眞 뮤즈 · 眞 트래블러 · 眞 헌터 · 眞 비질란테 · 眞 키메라 |
| 다크나이트 | 眞 다크나이트 |
| 크리에이터 | 眞 크리에이터 |

> 직업 목록은 jobs.json 기준이며, `_merged.json` 파일이 없는 직업은 UI에서 비활성화됩니다.

---

## 개발 마일스톤

| 단계 | 설명 | 상태 |
|------|------|------|
| M0 | 환경 세팅 + 설계 확정 | ✅ 완료 |
| M0.5 | 스킬 데이터 파이프라인 (fetch + merge) | ✅ 완료 |
| M1 | C 코어 — 트리 자료구조 | ✅ 완료 |
| M2 | C 코어 — 스킬 수치 계산 | ✅ 완료 |
| M3 | C 코어 — 타임라인 시뮬레이터 | ✅ 완료 |
| M4 | C 코어 — JSON I/O 통합 | ✅ 완료 |
| M5 | Node.js Express 서버 | ✅ 완료 |
| M6 | 프론트엔드 — 트리 시각화 | ✅ 완료 |
| M7 | 프론트엔드 — 스펙 패널 + 결과 출력 | ✅ 완료 |
| M7.5 | 프론트엔드 — 딜량 분석 패널 (차트 + 타임라인) | ✅ 완료 |
| M8 | 통합 테스트 | 🔄 진행 중 |
| M9 | 캐릭터 검색 — Neople API 자동 로드 | ✅ 완료 |
| M10 | 스킬 툴팁 — hover 포털 툴팁 + 개화/강화 선택 UI | ⏳ 예정 |

---

## 구현하지 않는 것

| 항목 | 제외 이유 |
|------|-----------|
| 평타 DPS 계산 | 스킬 계산과 분리된 별도 시스템 필요 |
| 스킬 간 시너지/콤보 | 1차 구현 범위 초과 |
| 사용자 계정 및 서버 저장 | 범위 초과 |
| 다중 캐릭터 지원 | 단일 캐릭터로 제한 |
| 모바일 반응형 | 데스크탑 브라우저 전용 |

---

## 라이선스

본 프로젝트는 학습 및 개인 사용 목적으로 제작되었습니다.  
던전앤파이터의 게임 데이터 및 이미지 저작권은 **㈜ 넥슨코리아 / 네오플** 에 있습니다.

---

<p align="center">
  Made with ☕ by LSD
</p>
