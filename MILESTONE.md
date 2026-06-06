# RPG 스킬 트리 시뮬레이터 — 개발 마일스톤

## 전체 구조 요약

```
[브라우저 UI] ←→ [Node.js 서버] ←→ [C 실행파일]
  HTML/CSS/JS       subprocess        트리 + 시뮬레이터
```

---

## Milestone 0 — 환경 세팅
**목표: 세 레이어가 각각 독립적으로 실행되는 것을 확인**

### 작업 목록
- [ ] 프로젝트 디렉토리 구조 생성
- [ ] C 빌드 환경 확인 (gcc + Makefile 작성)
- [ ] cJSON 라이브러리 추가 (cJSON.h + cJSON.c 복사)
- [ ] Node.js 환경 확인 + Express 설치 (`npm init` + `npm install express`)
- [ ] Express 서버 Hello World 실행 확인
- [ ] C 실행파일 Hello World 빌드 + 실행 확인
- [ ] Express → C subprocess 호출 + stdout 수신 통합 확인
- [ ] Vite + React 프론트엔드 scaffold (`npm create vite@latest frontend -- --template react`)

### 완료 기준
```
$ curl http://localhost:5000/ping
{"status": "ok", "c_core": "alive"}
```

### 디렉토리 구조
```
project/
├── core/
│   ├── main.c
│   ├── cJSON.h
│   ├── cJSON.c
│   └── Makefile
├── server/
│   ├── app.js
│   └── package.json
├── frontend/               # Vite + React
│   ├── src/
│   │   ├── main.jsx
│   │   ├── App.jsx
│   │   └── components/
│   ├── index.html
│   └── package.json
├── CLAUDE.md
└── MILESTONE.md
```

---

## Milestone 1 — C 코어: 트리 자료구조
**목표: 스킬 노드를 트리로 구성하고, 순회·출력이 가능한 상태**

### 작업 목록
- [ ] `skill.h` — Skill 구조체 정의
- [ ] `tree.h / tree.c` — 노드 생성, 자식 추가, 메모리 해제
- [ ] 트리 순회 함수 구현 (전위순회 기준)
- [ ] 선행 조건 검증 함수 — 부모 스킬 레벨 5 확인
- [ ] 스킬 해제(off) 시 서브트리 연쇄 해제 함수
- [ ] 트리 전체를 JSON으로 직렬화하는 함수

### 핵심 구조체
```c
typedef struct Skill {
    int   id;
    char  name[64];
    float base_damage_coeff;
    float base_cooldown;
    float base_cast_frames;
    int   current_level;        // 0(미습득) ~ 5
    int   is_unlocked;
    int   parent_id;            // -1이면 루트
    struct Skill* children[MAX_CHILDREN];
    int   child_count;
} Skill;
```

### 완료 기준
- 하드코딩된 샘플 트리(스킬 6개)를 JSON으로 출력
- 선행 조건 미충족 시 스킬 잠금 처리 동작 확인

---

## Milestone 2 — C 코어: 스킬 수치 계산
**목표: 스킬 레벨 + 캐릭터 스펙을 반영한 최종 수치 계산**

### 작업 목록
- [ ] `CharacterStats` 구조체 정의
- [ ] CDR 적용 공식 구현 — 하한 0.3
  ```
  final_cooldown = base_cd * MAX(0.3, 1.0 - cdr)
  ```
- [ ] 공격속도 적용 공식 구현 — 상한 200%
  ```
  final_cast = base_cast / MIN(2.0, attack_speed / 100.0)
  ```
- [ ] 레벨별 선형 스케일링 공식 구현
  ```
  scaled_coeff = base_coeff * (1.0 + 0.20 * (level - 1))
  ```
- [ ] 스킬별 최종 데미지 = attack_power × scaled_coeff
- [ ] 스킬별 우선순위 점수 계산
  ```
  priority = (attack_power × scaled_coeff) / (final_cooldown + final_cast)
  ```

### 완료 기준
- 스킬 하나에 대해 스펙 입력 → 최종 쿨타임/시전시간/데미지 출력 확인

---

## Milestone 3 — C 코어: 타임라인 시뮬레이터
**목표: N초 동안의 스킬 로테이션을 시뮬레이션하고 총 데미지를 계산**

### 작업 목록
- [ ] `simulator.h / simulator.c` 파일 생성
- [ ] 스킬별 `next_available_time` 배열 초기화
- [ ] 시뮬레이션 메인 루프 구현
  - 현재 시각 t에서 사용 가능한 스킬 목록 필터링
  - 전략 C: `t + cast_time > N`인 스킬 제외
  - 전략 A: 우선순위 점수 내림차순 정렬 후 최상위 선택
  - Idle 처리: 사용 가능한 스킬 없을 때 다음 쿨타임 종료 시각으로 점프
- [ ] 타임라인 이벤트 배열 기록
- [ ] 결과 JSON 직렬화

### 시뮬레이션 출력 포맷
```json
{
  "total_damage": 284500.0,
  "timeline": [
    {"time": 0.0, "skill_id": 1, "skill_name": "파이어볼", "damage": 17500.0},
    {"time": 1.2, "skill_id": 2, "skill_name": "메테오",   "damage": 40000.0},
    {"time": 4.9, "skill_id": null, "idle_duration": 2.1}
  ],
  "skill_stats": [
    {"skill_id": 1, "use_count": 8, "total_damage": 140000.0},
    {"skill_id": 2, "use_count": 3, "total_damage": 144500.0}
  ]
}
```

### 완료 기준
- 스킬 4개, 30초 시뮬레이션 실행 후 타임라인 JSON 출력 확인
- Idle 구간이 올바르게 기록되는지 확인

---

## Milestone 4 — C 코어: JSON I/O 통합
**목표: stdin으로 JSON을 받아서 처리하고, stdout으로 결과 JSON을 출력**

### 작업 목록
- [ ] `json_parser.c` — cJSON으로 입력 JSON 파싱 후 구조체 변환
- [ ] `main.c` — stdin 수신 → 파싱 → 시뮬레이션 → stdout 출력 흐름 완성
- [ ] 입력 JSON 유효성 검증 (필드 누락, 잘못된 값 감지)
- [ ] 에러 발생 시 에러 JSON 출력
  ```json
  {"error": "prerequisite_not_met", "skill_id": 3}
  ```

### 입력 포맷
```json
{
  "character": {
    "attack_power": 5000,
    "cooldown_reduction": 0.35,
    "attack_speed": 150.0
  },
  "skills": [...],
  "simulation_duration": 60
}
```

### 완료 기준
```bash
echo '{"character": {...}, "skills": [...], "simulation_duration": 30}' | ./simulator
# → 결과 JSON 출력
```

---

## Milestone 5 — Node.js 서버 구축
**목표: 프론트엔드 요청을 받아 C 실행파일을 호출하고 결과를 반환**

### 작업 목록
- [ ] `POST /simulate` 라우트 — 시뮬레이션 실행
- [ ] `POST /skill/toggle` 라우트 — 스킬 잠금/해제 요청
- [ ] `GET /tree/default` 라우트 — 기본 스킬 트리 데이터 반환
- [ ] `child_process.spawn`으로 C 실행파일 호출 + stdout 수신
- [ ] C 실행 에러 처리 (exit code !== 0)
- [ ] CORS 설정 (cors 패키지)

### Express 코어 패턴
```javascript
const { spawn } = require('child_process');

app.post('/simulate', (req, res) => {
    const child = spawn('./core/simulator');
    let output = '';
    const timer = setTimeout(() => { child.kill(); res.status(504).json({ error: 'timeout' }); }, 5000);
    child.stdout.on('data', d => output += d);
    child.stdin.write(JSON.stringify(req.body));
    child.stdin.end();
    child.on('close', code => {
        clearTimeout(timer);
        if (res.headersSent) return;
        if (code !== 0) return res.status(500).json({ error: 'simulator error' });
        res.type('json').send(output);
    });
});
```

### 완료 기준
```bash
curl -X POST http://localhost:5000/simulate \
  -H "Content-Type: application/json" \
  -d '{"character": {...}, "skills": [...], "simulation_duration": 30}'
# → 결과 JSON 반환
```

---

## Milestone 6 — 프론트엔드: 트리 시각화 (React)
**목표: React 컴포넌트로 스킬 트리를 시각화하고, 다크모드 토글 제공**

### 작업 목록
- [ ] `App.jsx`에 `ThemeContext` 설정 + `data-theme` 속성으로 CSS 변수 전환
- [ ] 다크/라이트 전환 토글 버튼 컴포넌트
- [ ] `global.css`에 CSS 변수 정의 (`--bg`, `--surface`, `--text`, `--accent`)
- [ ] `GET /tree/default` 호출 후 트리 데이터 수신 (useEffect + fetch)
- [ ] `SkillTree.jsx` — SVG로 노드/간선 렌더링
  - 노드: 스킬 이름 + 현재 레벨 표시
  - 간선: 부모-자식 연결선
  - 상태별 CSS 클래스 구분 (잠김/습득/최대레벨)
  - 노드 등장 시 fade-in 애니메이션 (`animations.css`)
- [ ] 노드 클릭 → 레벨 +1 / 우클릭 → 레벨 -1
- [ ] 선행 조건 미충족 노드는 클릭 비활성화

### 완료 기준
- 샘플 트리 6개 노드가 다크/라이트 양쪽에서 렌더링
- 토글 버튼으로 모드 전환 시 색상이 CSS 변수로 즉시 반영

---

## Milestone 7 — 프론트엔드: 스펙 패널 + 시뮬레이션 결과 (React)
**목표: 스펙 슬라이더 조작 → 시뮬레이션 요청 → 결과 애니메이션 출력**

### 작업 목록
- [ ] `StatsPanel.jsx` — 스펙 슬라이더 (useState로 값 관리)
  - CDR: 0% ~ 70% 범위
  - 공격속도: 100% ~ 200% 범위
- [ ] 시뮬레이션 시간 N 입력 필드
- [ ] [시뮬레이션 실행] 버튼 → `POST /simulate` 호출 (async/await)
- [ ] `ResultPanel.jsx` — 결과 출력
  - 총 데미지
  - 스킬별 사용 횟수 + 기여 데미지 + 기여 비율
  - 타임라인 이벤트 목록
  - 패널 진입 시 slide-up + fade-in 애니메이션
- [ ] 비교 모드: 이전 결과와 현재 결과를 나란히 표시 + % 증감 표기
  - 증가: 초록, 감소: 빨강 — CSS 클래스로만 처리

### 완료 기준
- 슬라이더 조작 → 시뮬레이션 → 결과 패널 애니메이션 진입 확인
- 다크모드에서도 % 증감 색상이 올바르게 표시

---

## Milestone 8 — 통합 테스트 + 마무리
**목표: 세 레이어 연동 전체 흐름 검증 + 버그 수정**

### 작업 목록
- [ ] 엣지 케이스 테스트
  - CDR 70% 상한 초과 입력
  - 공격속도 200% 초과 입력
  - 시뮬레이션 시간 N보다 시전시간이 긴 스킬 단독 존재
  - 모든 스킬이 동시에 쿨타임 중인 상황 (Idle 처리)
  - 선행 조건 스킬을 레벨 4에서 하위 스킬 해제 시도
- [ ] 메모리 누수 검증 (valgrind 또는 간이 검증)
- [ ] Node.js 타임아웃 처리 확인
- [ ] README.md 작성 (실행 방법, 빌드 방법)

---

## 마일스톤 의존성 차트

```
M0 (환경 세팅)
    ↓
M1 (트리 구조) → M2 (수치 계산) → M3 (시뮬레이터) → M4 (JSON I/O)
                                                            ↓
                                                      M5 (Node.js)
                                                            ↓
                                               M6 (트리 시각화)
                                                            ↓
                                               M7 (스펙 패널 + 결과)
                                                            ↓
                                               M8 (통합 테스트)
```

M1~M4는 순서대로 진행해야 한다.
M5는 M4가 완료된 후 시작.
M6, M7은 M5와 병렬 진행 가능 (Mock 데이터로 UI 먼저 개발).

---

## 스코프 외 (의도적으로 제외한 것들)

| 항목 | 제외 이유 |
|---|---|
| 사용자 계정/저장 기능 | 범위 초과, 파일 저장으로 대체 |
| 평타 DPS 계산 | 스킬 계산과 분리된 별도 시스템 필요 |
| 스킬 간 시너지/콤보 | 1차 구현 범위 초과 |
| 모바일 반응형 | 데스크탑 브라우저 기준으로 제한 |
| 다중 캐릭터 지원 | 단일 캐릭터로 제한 |
