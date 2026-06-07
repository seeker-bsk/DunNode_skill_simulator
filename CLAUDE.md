# DNF 스킬 트리 시뮬레이터

## 프로젝트 개요

던전앤파이터 캐릭터의 스킬 트리를 구성하고, 스킬 조합과 캐릭터 스펙을 기반으로 **N초 동안의 데미지 총량을 시뮬레이션**하는 도구.

**핵심 기능 두 가지:**
1. 한정된 SP로 어떻게 최적의 스킬트리를 구성할 것인지 계산 (SP 최적화)
2. 스킬 트리를 변형했을 때 데미지가 어떻게 변하는지 비교 출력

모든 수치는 **만렙(115레벨) + 달인의 계약** 사용을 기준으로 한다.

---

## 아키텍처

```
[브라우저] ←HTTP/JSON→ [Node.js :5000] ←subprocess/JSON→ [C 실행파일]
 frontend/               server/app.js                   core/simulator
```

- **C 코어**: 트리 자료구조, 스킬 계산, 타임라인 시뮬레이터. 모든 비즈니스 로직의 유일한 위치.
- **Node.js (Express)**: HTTP ↔ subprocess 중계 + 스킬 데이터 파이프라인 담당. 시뮬레이션 비즈니스 로직 없음.
- **프론트엔드**: 시각화와 입력 수집만 담당. 계산 로직 없음.

---

## 파일 구조

```
project/
├── core/
│   ├── main.c
│   ├── skill.h / skill.c
│   ├── tree.h / tree.c
│   ├── simulator.h / simulator.c
│   ├── json_parser.h / json_parser.c
│   ├── cJSON.h / cJSON.c          # 외부 라이브러리 (수정 금지)
│   └── Makefile
├── server/
│   ├── app.js
│   └── package.json
├── scripts/                        # 스킬 데이터 파이프라인 스크립트
│   ├── fetch_skills.js             # Neople API → base JSON 수집
│   └── merge_skills.js             # base + manual → merged JSON 생성
├── data/
│   └── skills/
│       ├── {jobGrowId}_base.json   # API 자동 수집 (수정 금지)
│       ├── {jobGrowId}_manual.json # 수동 입력 (cast_time, SP비용, 개화 수치 등)
│       └── {jobGrowId}_merged.json # C 코어가 읽는 최종 파일
├── frontend/
│   ├── src/
│   │   ├── main.jsx
│   │   ├── App.jsx                 # 루트 컴포넌트, ThemeContext 제공
│   │   ├── components/
│   │   │   ├── SkillTree.jsx       # 트리 시각화 (SVG)
│   │   │   ├── StatsPanel.jsx      # 스펙 슬라이더
│   │   │   └── ResultPanel.jsx     # 시뮬레이션 결과
│   │   └── styles/
│   │       ├── global.css          # CSS 변수 (다크/라이트 모드 포함)
│   │       └── animations.css
│   ├── index.html
│   └── package.json
├── reports/                        # 파싱 결과 참고 자료 (개발용)
├── CLAUDE.md
└── MILESTONE.md
```

---

## 핵심 데이터 구조

### SkillLevelMode 열거형 (C)

```c
typedef enum {
    LEVEL_MODE_SP,          // 모든 레벨 SP 소모 (일반 스킬)
    LEVEL_MODE_AUTO_CHAR,   // 캐릭터 레벨 1:1 연동, SP 없음 (기본기 숙련 등)
    LEVEL_MODE_AUTO_EVERY5, // 캐릭터 5레벨당 스킬 1레벨, SP 없음 (각성기)
    LEVEL_MODE_AUTO_LV1_SP  // 1레벨 자동 습득, 2레벨부터 SP 소모
} SkillLevelMode;
```

### Skill 구조체 (C)

```c
#define MAX_CHILDREN      8
#define MAX_MASTER_LEVEL  70  // SP 투자 가능 상한의 절대 상한 (배열 크기)
#define MASTERY_CONTRACT_BONUS 5  // 달인의 계약: 유효 캐릭터 레벨 +5
#define MAX_CHAR_LEVEL    115 // 만렙

typedef struct Skill {
    char  skill_id[64];           // Neople API 스킬 ID
    char  name[64];

    /* 레벨 제한 */
    int   required_level;         // 스킬 lv1 습득 최소 캐릭터 레벨 (달인의 계약 적용 전)
    int   required_level_range;   // 스킬 레벨당 캐릭터 레벨 증가폭
    int   api_max_level;          // API maxLevel (아이템 포함 절대 상한, 참고용)
    int   master_level;           // SP 투자 가능 상한
                                  //   기본값: api_max_level - 10
                                  //   예외: manual JSON의 masterLevelOverride 적용
    int   current_level;          // 현재 스킬 레벨 (0: 미습득)
    int   sp_cost_per_level;      // 레벨당 SP 소모 (LEVEL_MODE_SP, AUTO_LV1_SP에서만 유효)
    SkillLevelMode level_mode;

    /* 데미지 (공격력 100% 기준 %, 히트수 및 다중 타격 합산 완료)
     * damage_per_level[i] = 스킬 레벨 (i+1)의 총 데미지%
     * 인덱스 0 = lv1, 인덱스 master_level-1 = lvmax
     * 선형 보간 없이 API 실수치를 레벨별로 직접 저장 */
    int   level_count;                         // = master_level (유효 배열 길이)
    float damage_per_level[MAX_MASTER_LEVEL];  // [0..level_count-1]

    /* 타이밍 */
    float base_cooldown;          // 쿨타임 (초), 레벨 무관 고정
    float cast_time;              // 시전 시간 (초), 공격속도 영향 없음

    /* 스킬 강화 (enhancement) */
    int   enhancement_type;       // 0: 없음 / 1: 공격력+55% / 2: 공격력+38%+CDR15%

    /* 스킬 개화 (bloom/evolution) */
    int   bloom_type;             // 0: 없음 / 1: 개화1 선택 / 2: 개화2 선택
    float bloomed_cast_time;      // bloom_type != 0일 때 시전 시간 (0이면 미변경)
    float bloomed_damage_mult;    // bloom_type != 0일 때 데미지 배율 (0이면 미변경)
    float bloomed_cooldown;       // bloom_type != 0일 때 쿨타임 (0이면 미변경)

    /* 트리 구조 */
    char  pre_required_skill_id[64]; // 선행 스킬 ID (없으면 빈 문자열)
    int   parent_id;              // 트리 부모 인덱스, -1이면 루트
    struct Skill* children[MAX_CHILDREN];
    int   child_count;
} Skill;
```

### CharacterStats 구조체 (C)

```c
typedef struct CharacterStats {
    float attack_power;              // 기본 공격력
    float cooldown_reduction;        // 직접 쿨타임 감소 (0.0 ~ 0.70)
    float cooldown_recovery_speed;   // 쿨타임 회복 속도 (n%, 양수)
                                     // CDR 환산식: 1 - 100/(100+n)
    float attack_speed;              // 공격속도 (100.0 ~ 200.0)
    int   char_level;                // 캐릭터 레벨 (만렙 115)
    int   mastery_contract;          // 달인의 계약 (0/1)
    int   total_sp;                  // 총 보유 SP (만렙 기준, 추후 확정)
} CharacterStats;
```

---

## 핵심 공식

```c
/* 유효 캐릭터 레벨 */
int get_effective_char_level(CharacterStats* cs) {
    return cs->char_level + (cs->mastery_contract ? MASTERY_CONTRACT_BONUS : 0);
}

/* SP 투자 가능 상한 레벨 (캐릭터 레벨 병목 반영) */
int get_investable_max(Skill* s, int eff_lv) {
    if (eff_lv < s->required_level) return 0;
    int char_cap = (eff_lv - s->required_level) / s->required_level_range + 1;
    return char_cap < s->master_level ? char_cap : s->master_level;
}

/* auto_every5 스킬 현재 레벨 (각성기) */
int get_auto_every5_level(Skill* s, int eff_lv) {
    if (eff_lv < s->required_level) return 0;
    int lv = (eff_lv - s->required_level) / 5 + 1;
    return lv < s->master_level ? lv : s->master_level;
}

/* 최종 CDR (직접 감소 + 회복 속도, 상한 70%) */
float get_combined_cdr(CharacterStats* cs) {
    float recovery_cdr = 1.0f - 100.0f / (100.0f + cs->cooldown_recovery_speed);
    float combined = cs->cooldown_reduction + recovery_cdr;
    if (combined > 0.70f) combined = 0.70f;
    return combined;
}

/* 최종 쿨타임 */
float get_final_cooldown(Skill* s, float combined_cdr) {
    float base_cd = (s->bloom_type != 0 && s->bloomed_cooldown > 0.0f)
                    ? s->bloomed_cooldown : s->base_cooldown;
    float factor = 1.0f - combined_cdr;
    if (factor < 0.30f) factor = 0.30f;
    return base_cd * factor;
}

/* 시전 시간 (공격속도 영향 없음) */
float get_cast_time(Skill* s) {
    if (s->bloom_type != 0 && s->bloomed_cast_time > 0.0f)
        return s->bloomed_cast_time;
    return s->cast_time;
}

/* 레벨별 데미지 직접 조회 (API 실수치, 보간 없음) */
float get_damage_at_level(Skill* s, int level) {
    int idx = level - 1;
    if (idx < 0)                idx = 0;
    if (idx >= s->level_count)  idx = s->level_count - 1;
    return s->damage_per_level[idx];
}

/* 강화 배율 */
float get_enhancement_mult(int enhancement_type) {
    if (enhancement_type == 1) return 1.55f;
    if (enhancement_type == 2) return 1.38f;
    return 1.0f;
}

/* 강화 CDR 보너스 */
float get_enhancement_cdr(int enhancement_type) {
    if (enhancement_type == 2) return 0.15f;
    return 0.0f;
}

/* 스킬 우선순위 점수 (높을수록 먼저 사용) */
float get_priority(Skill* s, CharacterStats* cs) {
    float bloom_dmg  = (s->bloom_type != 0 && s->bloomed_damage_mult > 0.0f)
                       ? s->bloomed_damage_mult : 1.0f;
    float dmg = cs->attack_power
              * get_damage_at_level(s, s->current_level) / 100.0f
              * get_enhancement_mult(s->enhancement_type)
              * bloom_dmg;

    float enh_cdr  = get_enhancement_cdr(s->enhancement_type);
    float total_cdr = get_combined_cdr(cs) + enh_cdr;
    if (total_cdr > 0.70f) total_cdr = 0.70f;

    float cd   = get_final_cooldown(s, total_cdr);
    float cast = get_cast_time(s);
    return dmg / (cd + cast);
}
```

**master_level 계산 (데이터 파이프라인에서 처리):**
```
master_level = api_max_level - 10          // 기본
master_level = api_max_level               // masterLevelOverride: "same_as_max"
master_level = masterLevelOverride 값      // masterLevelOverride: 정수 명시
```

**실제 SP 투자 가능 레벨:**
```
investable = min(master_level, char_cap)
char_cap   = (effective_char_level - required_level) / required_level_range + 1
```

---

## 데이터 파이프라인

스킬 데이터는 Neople 공식 API에서 수집 후 수동 보완을 거쳐 최종 파일을 생성한다.

### API 엔드포인트

```
# 직업별 스킬 목록
GET https://api.neople.co.kr/df/skills/{jobId}?jobGrowId={jobGrowId}&apikey={apikey}

# 개별 스킬 상세
GET https://api.neople.co.kr/df/skills/{jobId}/{skillId}?apikey={apikey}
```

API 키는 환경 변수 `NEOPLE_API_KEY`로 관리한다. 코드에 하드코딩 금지.

### {jobGrowId}_base.json — API 자동 수집 (수정 금지)

- **jobGrowId는 반드시 眞(각성) 직업** 기준을 사용한다. 하위 전직 ID 사용 금지.
- `levelData`는 **전 레벨** 저장. 선형 보간 없이 레벨별 정확한 수치를 유지한다.

```json
{
  "skillId": "faf9cd66281078b51be2ee0b0f6c5530",
  "name": "데드 식스",
  "type": "active",
  "requiredLevel": 20,
  "requiredLevelRange": 2,
  "maxLevel": 60,
  "preRequiredSkill": null,
  "levelData": [
    { "level": 1,  "coolTime": 3.5, "castingTime": null, "optionValue": { "value1": 6670 } },
    { "level": 2,  "coolTime": 3.5, "castingTime": null, "optionValue": { "value1": 7590 } },
    "...",
    { "level": 60, "coolTime": 3.5, "castingTime": null, "optionValue": { "value1": 53360 } }
  ],
  "optionDesc": "공격력 : {value1}%",
  "evolution": null,
  "enhancement": [
    { "type": 1, "status": [{ "name": "스킬 공격력 증가", "value": "55%" }] },
    { "type": 2, "status": [{ "name": "스킬 공격력 증가", "value": "38%" }, { "name": "스킬 쿨타임 감소", "value": "15%" }] }
  ]
}
```

### {jobGrowId}_manual.json — 수동 입력

```json
{
  "skillId": "faf9cd66281078b51be2ee0b0f6c5530",
  "levelMode": "sp",
  "castTime": 0.0,
  "spCostPerLevel": 1,
  "masterLevelOverride": null,

  "damageSources": [
    {
      "valueKey": "value1",
      "hitKey": null,
      "comment": "주 공격력 1타"
    }
  ]
}
```

다중 타격 예시 (히트수 × 데미지):
```json
"damageSources": [
  {
    "valueKey": "value2",
    "hitKey": "value1",
    "comment": "1타~2타 공격력(value2) × 히트수(value1회)"
  },
  {
    "valueKey": "value3",
    "hitKey": null,
    "comment": "피니시 공격력 1타"
  }
]
```

**damageSources 필드 전체 목록:**

| 필드 | 타입 | 설명 |
|------|------|------|
| `valueKey` | string | 데미지 수치를 가진 optionValue 키 (예: `"value1"`) |
| `hitKey` | string\|null | 히트수 optionValue 키. null이면 1타로 처리 |
| `hitCount` | int (선택) | hitKey 대신 사용하는 고정 히트수 (optionValue에 없는 경우) |
| `damageMultiplier` | float (선택) | 무기/조건 제한으로 인한 데미지 비율 보정 (예: 0.8 = 80%) |
| `comment` | string | 근거 기록용 설명 |

**merge 시 레벨 L의 contribution 계산:**
```
hit = optionValue[hitKey][L]  (hitKey가 있고 값이 "-"가 아닌 경우)
    = hitCount                 (hitCount가 있는 경우)
    = 1                        (둘 다 없는 경우)

contribution[L] = optionValue[valueKey][L] × hit × (damageMultiplier ?? 1.0)
                  단, optionValue[valueKey][L] = "-" 이면 0으로 처리
```

개화 수치 보완 (evolution이 있는 스킬만 작성):
```json
"evolutionOverrides": {
  "1": {
    "castTime": 0.25,
    "damageMult": -50,
    "coolTime": 20,
    "comment": "패스트 뉴클리어: 시전시간 50% 감소, 쿨타임 20초, 공격력 50% 감소"
  },
  "2": {
    "damageMult": 50,
    "coolTime": 60,
    "comment": "더 그레이티스트: 쿨타임 60초, 공격력 50% 증가"
  }
}
```

**damageMult / coolTime 작성 기준:**
- `damageMult`: 퍼센트 변화량 정수 입력. 60 = 공격력 +60%, -50 = 공격력 -50%. null이면 변화 없음.
- `coolTime`: 변경 후 절대 쿨타임(초) 입력. "쿨타임 n초로 변경" → n 입력. null이면 변화 없음.
- `castTime`: 변경 후 절대 시전시간(초) 입력. null이면 변화 없음.

**필드 작성 기준:**
- `evolution`이 null인 스킬: `evolutionOverrides` 필드 생략
- `enhancement`가 null인 스킬: merge 시 `enhancement_type = 0` 자동 처리
- `levelMode`가 `auto_char` / `auto_every5`인 스킬: `spCostPerLevel` 필드 생략

### {jobGrowId}_merged.json — C 코어 입력용 최종 파일

merge_skills.js가 base + manual을 합산하여 생성. C 코어가 이 파일을 읽는다.

**merge 처리 내용:**
1. `masterLevelOverride` 적용 → `master_level` 확정
2. `damageSources` 기반으로 레벨 1 ~ master_level 전체의 `damage_per_level[]` 배열 계산
   - 각 레벨 L: `total[L] = Σ contribution(src, L)` (위 contribution 공식 적용)
   - optionValue 값이 "-"인 레벨은 0으로 처리 → 계단함수 동작 자동 반영
3. `enhancement`의 `status` 배열 파싱 → `enhancement_type` 정수 변환
4. `evolutionOverrides` 수치 → `bloomed_*` 필드 변환

---

## 시뮬레이터 로직 (전략 A + C)

```
effective_char_level = char_level + (mastery_contract ? 5 : 0)
각 스킬의 current_level 결정:
  LEVEL_MODE_AUTO_CHAR    → current_level = min(effective_char_level, master_level)
  LEVEL_MODE_AUTO_EVERY5  → current_level = get_auto_every5_level()
  LEVEL_MODE_SP / AUTO_LV1_SP → SP 배분 결과

t = 0.0
while t < N:
    후보 = [쿨타임 종료된 스킬 전체]
    후보에서 제거: t + cast_time > N 인 스킬      ← 전략 C (타임아웃 방지)
    후보를 priority 내림차순 정렬                 ← 전략 A (DPS 최적화)

    if 후보 없음:
        t = min(next_available_time 전체 중 최솟값)
        continue

    selected = 후보[0]
    damage += selected.damage
    t += get_cast_time(selected)
    selected.next_available = t + get_final_cooldown(selected, combined_cdr)
```

---

## JSON 통신 포맷

### 입력 (프론트 → Node.js → C stdin)

```json
{
  "character": {
    "attack_power": 500000,
    "cooldown_reduction": 0.30,
    "cooldown_recovery_speed": 40.0,
    "attack_speed": 150.0,
    "char_level": 115,
    "mastery_contract": true,
    "total_sp": 0
  },
  "skills": [
    {
      "skill_id": "faf9cd66281078b51be2ee0b0f6c5530",
      "name": "데드 식스",
      "required_level": 20,
      "required_level_range": 2,
      "api_max_level": 60,
      "master_level": 50,
      "current_level": 51,
      "sp_cost_per_level": 1,
      "level_mode": "sp",
      "damage_per_level": [6670.0, 7590.0, "...", 53360.0],
      "base_cooldown": 3.5,
      "cast_time": 0.0,
      "enhancement_type": 0,
      "bloom_type": 0,
      "bloomed_cast_time": 0.0,
      "bloomed_damage_mult": 0.0,
      "bloomed_cooldown": 0.0,
      "parent_id": -1,
      "pre_required_skill_id": ""
    }
  ],
  "simulation_duration": 60
}
```

### 출력 (C stdout → Node.js → 프론트)

```json
{
  "total_damage": 284500000.0,
  "timeline": [
    { "time": 0.0, "skill_id": "faf9...", "skill_name": "데드 식스", "damage": 17500000.0 },
    { "time": 4.9, "skill_id": null, "idle_duration": 2.1 }
  ],
  "skill_stats": [
    {
      "skill_id": "faf9...",
      "use_count": 8,
      "total_damage": 140000000.0,
      "contribution_pct": 49.2
    }
  ]
}
```

### 에러 출력

```json
{"error": "prerequisite_not_met", "skill_id": "faf9..."}
{"error": "invalid_input", "field": "cooldown_reduction"}
{"error": "insufficient_sp", "required": 120, "available": 95}
```

---

## Express 라우트 목록

| 메서드 | 경로                        | 역할                          |
| ------ | --------------------------- | ----------------------------- |
| GET    | `/ping`                     | 헬스체크                      |
| GET    | `/tree/:jobGrowId`          | 직업별 스킬 트리 데이터 반환  |
| POST   | `/api/simulate`             | 시뮬레이션 실행               |
| POST   | `/skill/toggle`             | 스킬 잠금/해제                |
| POST   | `/skills/rebuild/:jobGrowId`| 스킬 데이터 재빌드 (merge)    |

---

## 빌드 및 실행

```bash
# C 코어 빌드
cd core && make

# 스킬 데이터 수집 (API → base JSON)
cd scripts && node fetch_skills.js --jobId=<jobId> --jobGrowId=<jobGrowId>

# 스킬 데이터 병합 (base + manual → merged)
cd scripts && node merge_skills.js --jobGrowId=<jobGrowId>

# Node.js 서버 실행
cd server && npm install && node app.js

# C 코어 단독 테스트
echo '{...}' | ./core/simulator
```

---

## 현재 진행 마일스톤

> 이 섹션은 작업 진행에 따라 직접 업데이트한다.

- [x] M0: 환경 세팅 + 설계 확정
- [x] M0.5: 스킬 데이터 파이프라인 (fetch_skills.js + manual JSON + merge_skills.js)
- [x] M1: C 코어 — 트리 자료구조
- [x] M2: C 코어 — 스킬 수치 계산
- [x] M3: C 코어 — 타임라인 시뮬레이터
- [x] M4: C 코어 — JSON I/O 통합
- [ ] M5: Node.js 서버
- [ ] M6: 프론트엔드 — 트리 시각화
- [ ] M7: 프론트엔드 — 스펙 패널 + 결과 출력
- [ ] M8: 통합 테스트

---

## 코딩 규칙

### C 코어

- C99 표준 사용
- 모든 malloc에 대해 free 짝 보장. 트리 해제는 후위순회로 처리.
- 함수명: `snake_case`. 파일명도 `snake_case`.
- 에러 발생 시 반드시 에러 JSON을 stdout으로 출력하고 `return 1`로 종료.
- cJSON.h / cJSON.c는 수정하지 않는다.
- 매직 넘버 사용 금지. 상수는 `#define`으로 core 최상단에 정의.
- 데미지 집계 로직(damageSources 합산, 히트수 곱연산)은 코드 내 주석으로 계산 과정을 상세히 기술한다.

### Node.js (Express)

- 시뮬레이션 비즈니스 로직을 서버에 작성하지 않는다. C 실행파일 호출과 응답 전달만.
- 스킬 데이터 파이프라인(fetch/merge)은 scripts/에서만 처리한다.
- subprocess timeout은 5초로 고정.
- 모든 라우트는 JSON만 반환한다.
- API 키는 환경 변수로 관리. 코드에 하드코딩 금지.

### 프론트엔드

- 계산 로직을 JS에 작성하지 않는다. 서버 응답 데이터를 화면에 표시하는 역할만.
- Vite + React 사용. 함수형 컴포넌트와 hooks만 사용 (클래스 컴포넌트 금지).
- `fetch()`로 Node.js API 호출. `async/await` 사용.
- 에러 응답 수신 시 사용자에게 에러 메시지 표시.
- **다크모드**: `ThemeContext`로 전역 테마 상태 관리. CSS 변수(`--bg`, `--text` 등)를 `data-theme` 속성으로 전환. JS에서 색상 직접 지정 금지.
- **애니메이션**: CSS `transition` / `@keyframes` 우선 사용. 애니메이션 제거 시 기능이 깨지면 안 됨.
- 상태 관리: `useState` / `useContext`만 사용. Redux 등 외부 상태 라이브러리 금지.

---

## 스코프 외 (구현하지 않는 것)

- 평타 DPS 계산
- 스킬 간 시너지/콤보
- 사용자 계정 및 서버 저장
- 다중 캐릭터
- 모바일 반응형
