# RPG 스킬 트리 시뮬레이터

## 프로젝트 개요

캐릭터의 스킬 트리를 구성하고, 스킬 조합과 캐릭터 스펙을 기반으로 **N초 동안의 데미지 총량을 시뮬레이션**하는 도구.

스킬 트리를 변형했을 때 데미지가 어떻게 변하는지 비교 출력하는 것이 핵심 기능.

---

## 아키텍처

```
[브라우저] ←HTTP/JSON→ [Node.js :5000] ←subprocess/JSON→ [C 실행파일]
 frontend/               server/app.js                   core/simulator
```

- **C 코어**: 트리 자료구조, 스킬 계산, 타임라인 시뮬레이터. 모든 비즈니스 로직의 유일한 위치.
- **Node.js (Express)**: HTTP ↔ subprocess 중계만 담당. 비즈니스 로직 없음.
- **프론트엔드**: 시각화와 입력 수집만 담당. 계산 로직 없음.

---

## 파일 구조

```
project/
├── core/
│   ├── main.c              # 진입점: stdin JSON 수신 → stdout JSON 출력
│   ├── skill.h / skill.c   # Skill 구조체, 레벨 계산
│   ├── tree.h / tree.c     # N-ary 트리: 삽입/삭제/순회/직렬화
│   ├── simulator.h / simulator.c  # 타임라인 시뮬레이터
│   ├── json_parser.h / json_parser.c  # cJSON 래퍼
│   ├── cJSON.h / cJSON.c   # 외부 라이브러리 (수정 금지)
│   └── Makefile
├── server/
│   ├── app.js              # Express 라우트
│   └── package.json
├── frontend/               # Vite + React
│   ├── src/
│   │   ├── main.jsx        # 진입점
│   │   ├── App.jsx         # 루트 컴포넌트, ThemeContext 제공
│   │   ├── components/
│   │   │   ├── SkillTree.jsx   # 트리 시각화 (SVG)
│   │   │   ├── StatsPanel.jsx  # 스펙 슬라이더
│   │   │   └── ResultPanel.jsx # 시뮬레이션 결과
│   │   └── styles/
│   │       ├── global.css      # CSS 변수 (다크/라이트 모드 포함)
│   │       └── animations.css  # 전환 애니메이션
│   ├── index.html
│   └── package.json        # vite + react 의존성
├── CLAUDE.md
└── MILESTONE.md
```

---

## 핵심 데이터 구조

### Skill 구조체 (C)

```c
#define MAX_CHILDREN 8
#define MAX_SKILL_LEVEL 5
#define SKILL_LEVEL_SCALE 0.20f   // 레벨당 20% 선형 증가

typedef struct Skill {
    int   id;
    char  name[64];
    float base_damage_coeff;   // 1레벨 기준 데미지 계수
    float base_cooldown;       // 1레벨 기준 쿨타임 (초)
    float base_cast_frames;    // 1레벨 기준 시전 시간 (초)
    int   current_level;       // 0(미습득) ~ 5(최대)
    int   is_unlocked;         // 1: 습득, 0: 미습득
    int   parent_id;           // -1이면 루트 노드
    struct Skill* children[MAX_CHILDREN];
    int   child_count;
} Skill;
```

### CharacterStats 구조체 (C)

```c
typedef struct CharacterStats {
    float attack_power;          // 기본 공격력
    float cooldown_reduction;    // 0.0 ~ 0.70 (상한 70%)
    float attack_speed;          // 100.0 ~ 200.0 (상한 200%)
} CharacterStats;
```

---

## 핵심 공식 (수정 금지)

```c
// 최종 쿨타임 (CDR 상한 70% → 계수 하한 0.3)
float get_final_cooldown(float base_cd, float cdr) {
    float factor = 1.0f - cdr;
    if (factor < 0.3f) factor = 0.3f;
    return base_cd * factor;
}

// 최종 시전 시간 (공격속도 상한 200%)
float get_final_cast(float base_cast, float aspd) {
    if (aspd > 200.0f) aspd = 200.0f;
    return base_cast / (aspd / 100.0f);
}

// 레벨별 선형 스케일링
float get_scaled_coeff(float base, int level) {
    return base * (1.0f + SKILL_LEVEL_SCALE * (level - 1));
}

// 스킬 우선순위 점수 (높을수록 먼저 사용)
float get_priority(Skill* s, CharacterStats* cs) {
    float dmg  = cs->attack_power * get_scaled_coeff(s->base_damage_coeff, s->current_level);
    float cd   = get_final_cooldown(s->base_cooldown, cs->cooldown_reduction);
    float cast = get_final_cast(s->base_cast_frames, cs->attack_speed);
    return dmg / (cd + cast);
}
```

---

## 시뮬레이터 로직 (전략 A + C)

```
t = 0.0
while t < N:
    후보 = [쿨타임 종료된 스킬 전체]
    후보에서 제거: t + cast_time > N 인 스킬   ← 전략 C (타임아웃 방지)
    후보를 priority 내림차순 정렬              ← 전략 A (DPS 최적화)

    if 후보 없음:
        t = min(next_available_time 전체 중 최솟값)  ← Idle 점프
        continue

    selected = 후보[0]
    damage += selected.damage
    t += selected.final_cast
    selected.next_available = t + selected.final_cooldown
```

---

## JSON 통신 포맷

### 입력 (프론트 → Node.js → C stdin)

```json
{
  "character": {
    "attack_power": 5000,
    "cooldown_reduction": 0.35,
    "attack_speed": 150.0
  },
  "skills": [
    {
      "id": 1,
      "name": "파이어볼",
      "base_damage_coeff": 3.5,
      "base_cooldown": 8.0,
      "base_cast_frames": 1.2,
      "current_level": 5,
      "parent_id": -1,
      "is_unlocked": true
    }
  ],
  "simulation_duration": 60
}
```

### 출력 (C stdout → Node.js → 프론트)

```json
{
  "total_damage": 284500.0,
  "timeline": [
    { "time": 0.0, "skill_id": 1, "skill_name": "파이어볼", "damage": 17500.0 },
    { "time": 4.9, "skill_id": null, "idle_duration": 2.1 }
  ],
  "skill_stats": [
    {
      "skill_id": 1,
      "use_count": 8,
      "total_damage": 140000.0,
      "contribution_pct": 49.2
    }
  ]
}
```

### 에러 출력

```json
{"error": "prerequisite_not_met", "skill_id": 3}
{"error": "invalid_input", "field": "cooldown_reduction"}
```

---

## Express 라우트 목록

| 메서드 | 경로            | 역할                       |
| ------ | --------------- | -------------------------- |
| GET    | `/ping`         | 헬스체크                   |
| GET    | `/tree/default` | 기본 스킬 트리 데이터 반환 |
| POST   | `/api/simulate` | 시뮬레이션 실행            |
| POST   | `/skill/toggle` | 스킬 잠금/해제             |

---

## 빌드 및 실행

```bash
# C 코어 빌드
cd core && make

# Node.js 서버 실행
cd server && npm install && node app.js

# C 코어 단독 테스트
echo '{"character":{"attack_power":5000,"cooldown_reduction":0.3,"attack_speed":150},"skills":[...],"simulation_duration":30}' | ./core/simulator
```

---

## 현재 진행 마일스톤

> 이 섹션은 작업 진행에 따라 직접 업데이트한다.

- [x] M0: 환경 세팅
- [ ] M1: C 코어 — 트리 자료구조
- [ ] M2: C 코어 — 스킬 수치 계산
- [ ] M3: C 코어 — 타임라인 시뮬레이터
- [ ] M4: C 코어 — JSON I/O 통합
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

### Node.js (Express)

- 비즈니스 로직을 서버에 작성하지 않는다. C 실행파일 호출과 응답 전달만.
- subprocess timeout은 5초로 고정.
- 모든 라우트는 JSON만 반환한다.

### 프론트엔드

- 계산 로직을 JS에 작성하지 않는다. 서버 응답 데이터를 화면에 표시하는 역할만.
- Vite + React 사용. 함수형 컴포넌트와 hooks만 사용 (클래스 컴포넌트 금지).
- `fetch()`로 Node.js API 호출. `async/await` 사용.
- 에러 응답 수신 시 사용자에게 에러 메시지 표시.
- **다크모드**: `ThemeContext`로 전역 테마 상태 관리. CSS 변수(`--bg`, `--text` 등)를 `data-theme` 속성으로 전환. JS에서 색상 직접 지정 금지.
- **애니메이션**: CSS `transition` / `@keyframes` 우선 사용. 복잡한 인터랙션(노드 등장, 결과 패널 진입)에만 제한적으로 적용. 애니메이션 제거 시 기능이 깨지면 안 됨.
- 상태 관리: `useState` / `useContext`만 사용. Redux 등 외부 상태 라이브러리 금지.

---

## 스코프 외 (구현하지 않는 것)

- 평타 DPS 계산
- 스킬 간 시너지/콤보
- 사용자 계정 및 서버 저장
- 다중 캐릭터
- 모바일 반응형
