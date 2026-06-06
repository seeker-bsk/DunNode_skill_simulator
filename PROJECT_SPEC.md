# RPG 스킬 트리 DPS 시뮬레이터
## 프로젝트 전체 기획서

---

## 목차

1. [프로젝트 개요](#1-프로젝트-개요)
2. [기술 스택 및 아키텍처](#2-기술-스택-및-아키텍처)
3. [핵심 설계 결정 사항](#3-핵심-설계-결정-사항)
4. [자료구조 설계](#4-자료구조-설계)
5. [알고리즘 설계](#5-알고리즘-설계)
6. [기능 명세](#6-기능-명세)
7. [통신 프로토콜 (JSON I/O)](#7-통신-프로토콜-json-io)
8. [파일 구조](#8-파일-구조)
9. [개발 마일스톤](#9-개발-마일스톤)
10. [제약 조건 및 예외 처리](#10-제약-조건-및-예외-처리)

---

## 1. 프로젝트 개요

### 1-1. 한 줄 설명

캐릭터의 스킬 트리 구성과 스펙 수치를 바탕으로, N초 동안의 이론적 최대 DPS(Damage Per Second)를 시뮬레이션하는 웹 기반 도구.

### 1-2. 배경 및 목적

RPG 게임에서 플레이어는 스킬 트리를 구성할 때 다음과 같은 불편을 겪는다.

- 원하는 스킬이 트리 깊숙이 있어 몇 포인트가 필요한지 파악하기 어렵다.
- 스킬 구성을 바꿨을 때 실제 데미지가 어떻게 변하는지 게임 내에서 확인이 안 된다.
- 쿨타임, 시전 시간, 스펙 수치가 복합 적용될 때의 결과를 머릿속으로 계산하기 어렵다.

이 프로젝트는 트리 자료구조를 C로 직접 구현하고, 그 위에서 타임라인 기반 시뮬레이터를 돌려 위 문제를 해결하는 것을 목표로 한다.

### 1-3. 핵심 기능 요약

- 스킬 트리를 시각적으로 구성하고 스킬별 레벨(0~5)을 조정
- 캐릭터 스펙(공격력, 쿨타임 감소, 공격속도) 수치 변경
- N초 동안 최적 스킬 로테이션을 자동 계산하여 총 데미지 산출
- 스킬 구성 변경 전/후 데미지를 수치 및 퍼센트(%)로 비교

---

## 2. 기술 스택 및 아키텍처

### 2-1. 기술 스택

| 레이어 | 기술 | 역할 |
|---|---|---|
| **Core** | C (C99), cJSON | 트리 자료구조, 시뮬레이터, JSON I/O |
| **Server** | Node.js, Express | HTTP 서버, C 실행파일 subprocess 호출 |
| **Frontend** | HTML / CSS / Vanilla JS | UI 렌더링, 사용자 입력, 결과 표시 |

### 2-2. 전체 아키텍처

```
┌─────────────────────────────────────────────────────────┐
│                    브라우저 (Frontend)                    │
│              HTML / CSS / JavaScript                     │
│         트리 시각화 · 스펙 슬라이더 · 결과 출력           │
└───────────────────────┬─────────────────────────────────┘
                        │ HTTP (JSON)
                        │ POST /api/simulate
                        ▼
┌─────────────────────────────────────────────────────────┐
│              경량 서버 (Node.js + Express)                │
│          요청 파싱 → C 실행파일 호출 → 응답 반환          │
│               (비즈니스 로직 없음, 순수 중계)             │
└───────────────────────┬─────────────────────────────────┘
                        │ stdin/stdout (JSON 문자열)
                        │ subprocess 호출
                        ▼
┌─────────────────────────────────────────────────────────┐
│                  C 실행파일 (Core)                        │
│     트리 구조 · 시뮬레이터 · 스킬 계산 · 데미지 합산      │
│         stdin으로 JSON 수신 → stdout으로 JSON 출력        │
└─────────────────────────────────────────────────────────┘
```

### 2-3. 레이어별 역할 원칙

**C Core (핵심 로직만 담당)**
- 트리 노드 생성/삭제/탐색/순회
- 스킬 잠금 해제 및 연쇄 잠금 처리
- 타임라인 시뮬레이터 실행
- 데미지 계산 및 결과 JSON 직렬화

**Node.js/Express (중계자 역할만 담당)**
- HTTP 요청/응답 처리
- C 실행파일을 subprocess로 실행
- C의 stdout을 프론트에 그대로 전달
- 비즈니스 로직 없음

**Frontend (표현과 입력만 담당)**
- 스킬 트리 시각적 렌더링
- 사용자 입력 수집 후 JSON 변환
- Node.js에 HTTP 요청 전송
- 응답 수신 후 화면 업데이트

---

## 3. 핵심 설계 결정 사항

모든 결정 사항은 기획 단계에서 확정된 것이며, 구현 도중 임의 변경 금지.

### 3-1. 스킬 트리 구조

| 항목 | 결정 |
|---|---|
| 트리 종류 | N-ary Tree (부모 1 : 자식 N) |
| 선행 조건 구조 | **단일 부모**만 허용 (DAG 아님) |
| 스킬 레벨 범위 | 0 (미습득) ~ 5 (최대) |
| 선행 조건 기준 | **부모 스킬 5레벨** 달성 시 자식 스킬 해금 가능 |
| 스킬 해제 연쇄 | 스킬 해제 시 해당 서브트리 전체 자동 해제 |

### 3-2. 캐릭터 스펙 공식

| 스펙 | 범위 | 공식 |
|---|---|---|
| 공격력 | 0 이상, 상한 없음 | 데미지에 직접 곱산 |
| 쿨타임 감소 (CDR) | 0% ~ 70% | `최종 쿨타임 = 기본 쿨타임 × max(0.3, 1.0 - CDR)` |
| 공격속도 | 100% ~ 200% (초과분 무효) | `최종 시전시간 = 기본 시전시간 / (공격속도 / 100)` |

### 3-3. 스킬 레벨 스케일링

- **방식:** 선형 증가
- **공식:** `최종 계수 = 기본 계수 × (1 + 0.20 × (레벨 - 1))`
- **상수:** `SKILL_LEVEL_SCALE = 0.20` (코드 내 상수로 관리)

```
레벨 1: 기본 계수 × 1.00
레벨 2: 기본 계수 × 1.20
레벨 3: 기본 계수 × 1.40
레벨 4: 기본 계수 × 1.60
레벨 5: 기본 계수 × 1.80
```

### 3-4. 시뮬레이션 방식

- **방식:** 타임라인 이벤트 시뮬레이션 (Stateless, 요청마다 전체 재계산)
- **입력:** 시뮬레이션 지속 시간 N초 (사용자가 지정)
- **스킬 로테이션 정책:** 전략 A + C 조합

---

## 4. 자료구조 설계

### 4-1. Skill 구조체

```c
#define MAX_CHILDREN     10
#define MAX_SKILL_NAME   64
#define SKILL_LEVEL_MAX  5
#define SKILL_LEVEL_SCALE 0.20f

typedef struct Skill {
    // 식별 정보
    int  id;
    char name[MAX_SKILL_NAME];

    // 기본 수치 (레벨 1 기준)
    float base_damage_coeff;   // 데미지 계수 (공격력에 곱해지는 배율)
    float base_cooldown;       // 쿨타임 (초)
    float base_cast_frames;    // 시전 시간 (초)

    // 레벨 상태
    int current_level;         // 0 = 미습득, 1~5 = 습득
    int is_unlocked;           // 0 = 잠김, 1 = 해금됨

    // 트리 연결 정보
    int parent_id;             // 선행 스킬 ID (-1이면 루트)
    struct Skill* parent;      // 부모 포인터
    struct Skill* children[MAX_CHILDREN];
    int child_count;
} Skill;
```

### 4-2. CharacterStats 구조체

```c
typedef struct {
    float attack_power;        // 공격력 (0 이상)
    float cooldown_reduction;  // CDR (0.0 ~ 0.70)
    float attack_speed;        // 공격속도 (100.0 ~ 200.0)
} CharacterStats;
```

### 4-3. SimEvent 구조체 (타임라인 이벤트)

```c
typedef struct {
    float time;        // 스킬 사용 시각 (초)
    int   skill_id;    // 사용된 스킬 ID (-1이면 idle)
    float damage;      // 이 이벤트에서 발생한 데미지
    float idle_duration; // idle인 경우 대기 시간
} SimEvent;
```

### 4-4. SimResult 구조체 (시뮬레이션 결과)

```c
#define MAX_EVENTS 1024

typedef struct {
    float total_damage;

    // 타임라인 로그
    SimEvent events[MAX_EVENTS];
    int event_count;

    // 스킬별 집계
    int   skill_use_count[MAX_SKILLS];
    float skill_total_damage[MAX_SKILLS];
} SimResult;
```

### 4-5. SkillTree 구조체

```c
typedef struct {
    Skill* root;
    int    skill_count;
    Skill* skill_map[MAX_SKILLS]; // id로 O(1) 접근용 인덱스
} SkillTree;
```

---

## 5. 알고리즘 설계

### 5-1. 스킬 잠금 해제 로직

```
unlock_skill(tree, target_id):
    node = find_skill(tree, target_id)

    if node == NULL:
        return ERROR_NOT_FOUND

    if node.parent_id == -1:          // 루트 스킬은 조건 없이 해금 가능
        node.is_unlocked = 1
        return SUCCESS

    parent = find_skill(tree, node.parent_id)

    if parent.current_level < 5:      // 선행 스킬 5레벨 미달
        return ERROR_PREREQUISITE

    node.is_unlocked = 1
    return SUCCESS
```

### 5-2. 스킬 해제 (연쇄 잠금) 로직

```
lock_skill_subtree(node):
    node.is_unlocked = 0
    node.current_level = 0

    for each child in node.children:
        lock_skill_subtree(child)    // 후위 순회로 전체 서브트리 해제
```

### 5-3. 우선순위 점수 계산

```
priority_score(skill, stats):
    final_cd    = base_cooldown × max(0.3, 1.0 - CDR)
    final_cast  = base_cast / min(2.0, attack_speed / 100.0)
    final_coeff = base_coeff × (1.0 + 0.20 × (level - 1))
    damage      = final_coeff × attack_power

    return damage / (final_cd + final_cast)
    // = "이 스킬 한 사이클이 초당 기여하는 데미지"
```

### 5-4. 타임라인 시뮬레이션 (핵심 알고리즘)

```
run_simulation(tree, stats, duration):

    // 해금된 스킬만 추출 + 우선순위 점수 계산
    active_skills[] = extract_unlocked(tree)
    for each skill in active_skills:
        skill.priority = priority_score(skill, stats)
        skill.next_available = 0.0   // 처음엔 모두 즉시 사용 가능

    current_time = 0.0
    total_damage = 0.0
    events = []

    while current_time < duration:

        // 후보 목록 구성: 쿨타임 종료된 스킬
        candidates = [s for s in active_skills
                      if s.next_available <= current_time]

        // 전략 C: 시전 도중 타임아웃 나는 스킬 제거
        candidates = [s for s in candidates
                      if current_time + s.final_cast <= duration]

        if candidates is empty:
            // idle: 다음 쿨타임 종료 시각으로 점프
            next_time = min(s.next_available for s in active_skills)
            if next_time >= duration:
                break
            events.append(idle_event(current_time, next_time - current_time))
            current_time = next_time
            continue

        // 전략 A: 우선순위 점수 최고 스킬 선택
        chosen = max(candidates, key=lambda s: s.priority)

        // 스킬 사용
        damage = chosen.final_coeff × stats.attack_power
        events.append(skill_event(current_time, chosen.id, damage))
        total_damage += damage
        current_time += chosen.final_cast
        chosen.next_available = current_time + chosen.final_cd

    return SimResult(total_damage, events, skill_stats)
```

---

## 6. 기능 명세

### 6-1. 스킬 트리 조작

| 기능 | 조건 | 동작 |
|---|---|---|
| 스킬 레벨업 | 스킬이 해금됨 + 레벨 < 5 | current_level += 1 |
| 스킬 레벨다운 | 스킬이 해금됨 + 레벨 > 1 | current_level -= 1 |
| 스킬 해금 | 부모 스킬 레벨 == 5 (또는 루트 스킬) | is_unlocked = 1, level = 1 |
| 스킬 해제 | 스킬이 해금됨 | 해당 서브트리 전체 해제 |
| 스킬 레벨 0으로 설정 | 항상 | 해금 상태 유지, 레벨만 0으로 (비활성화) |

> **비활성화 정의:** `is_unlocked == 1`이어도 `current_level == 0`이면 시뮬레이션에서 제외.
> 해금과 레벨은 독립적으로 관리한다.

### 6-2. 캐릭터 스펙 조정

| 스펙 | 입력 방식 | 입력 범위 |
|---|---|---|
| 공격력 | 숫자 직접 입력 | 1 ~ 999,999 |
| 쿨타임 감소 | 슬라이더 | 0% ~ 70% (1% 단위) |
| 공격속도 | 슬라이더 | 100% ~ 200% (1% 단위) |

### 6-3. 시뮬레이션 실행

- 시뮬레이션 지속 시간 N을 사용자가 직접 입력 (단위: 초, 범위: 1 ~ 600)
- [시뮬레이션 실행] 버튼 클릭 시 현재 스킬 트리 상태 + 스펙을 서버로 전송
- 결과 수신 후 결과 패널 업데이트

### 6-4. 결과 표시

| 출력 항목 | 설명 |
|---|---|
| 총 데미지 | N초 동안 발생한 데미지 합계 |
| 스킬별 기여도 | 스킬명 / 사용 횟수 / 해당 스킬 총 데미지 / 전체 대비 % |
| 타임라인 로그 | 시간순 스킬 사용 기록 (시각 / 스킬명 / 데미지 / idle 구간) |
| 변경 비교 | 직전 시뮬레이션 대비 총 데미지 증감 수치 및 % |

### 6-5. 비교 기능 상세

```
이전 결과: 48,200
현재 결과: 61,500

표시:
  현재: 61,500
  이전: 48,200
  변화: +13,300 (▲ 27.6%)
```

- 이전 결과는 마지막 시뮬레이션 실행 시의 값을 프론트엔드 메모리에 보관
- 초기화 버튼 클릭 시 비교 기준 리셋

---

## 7. 통신 프로토콜 (JSON I/O)

### 7-1. 통신 방식

- **프로토콜:** Stateless (요청마다 전체 트리 상태를 JSON으로 주고받음)
- **이유:** 이 프로젝트 규모(스킬 수십 개)에서 성능 문제 없음. 상태 관리 단순화.

### 7-2. API 엔드포인트

| Method | Endpoint | 설명 |
|---|---|---|
| `POST` | `/api/simulate` | 시뮬레이션 실행 |
| `GET` | `/api/ping` | 서버 상태 확인 |

### 7-3. 요청 포맷 (Frontend → Node.js → C)

```json
{
  "character": {
    "attack_power": 5000.0,
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
    },
    {
      "id": 2,
      "name": "메테오",
      "base_damage_coeff": 8.0,
      "base_cooldown": 20.0,
      "base_cast_frames": 2.5,
      "current_level": 3,
      "parent_id": 1,
      "is_unlocked": true
    },
    {
      "id": 3,
      "name": "파이어스톰",
      "base_damage_coeff": 5.0,
      "base_cooldown": 12.0,
      "base_cast_frames": 1.8,
      "current_level": 0,
      "parent_id": 1,
      "is_unlocked": false
    }
  ],
  "simulation_duration": 60
}
```

### 7-4. 응답 포맷 (C → Node.js → Frontend)

```json
{
  "total_damage": 284500.0,
  "timeline": [
    {
      "time": 0.0,
      "skill_id": 1,
      "skill_name": "파이어볼",
      "damage": 17500.0,
      "is_idle": false
    },
    {
      "time": 0.8,
      "skill_id": 2,
      "skill_name": "메테오",
      "damage": 56000.0,
      "is_idle": false
    },
    {
      "time": 3.3,
      "skill_id": -1,
      "skill_name": null,
      "damage": 0.0,
      "idle_duration": 1.9,
      "is_idle": true
    }
  ],
  "skill_stats": [
    {
      "skill_id": 1,
      "skill_name": "파이어볼",
      "use_count": 8,
      "total_damage": 140000.0,
      "contribution_pct": 49.2
    },
    {
      "skill_id": 2,
      "skill_name": "메테오",
      "use_count": 3,
      "total_damage": 144500.0,
      "contribution_pct": 50.8
    }
  ],
  "simulation_duration": 60,
  "error": null
}
```

### 7-5. 에러 응답 포맷

```json
{
  "total_damage": 0.0,
  "timeline": [],
  "skill_stats": [],
  "error": "No unlocked skills with level > 0"
}
```

### 7-6. Express의 subprocess 호출 코드

```javascript
const express = require('express');
const { spawn } = require('child_process');
const app = express();
app.use(express.json());

const SIMULATOR_PATH = './core/simulator';
const TIMEOUT_MS = 5000;

app.post('/api/simulate', (req, res) => {
    let child;
    try {
        child = spawn(SIMULATOR_PATH);
    } catch (e) {
        return res.status(503).json({ error: 'Simulator binary not found' });
    }

    const timer = setTimeout(() => {
        child.kill();
        res.status(504).json({ error: 'Simulation timeout' });
    }, TIMEOUT_MS);

    let output = '';
    child.stdout.on('data', d => output += d);
    child.stdin.write(JSON.stringify(req.body));
    child.stdin.end();

    child.on('close', code => {
        clearTimeout(timer);
        if (res.headersSent) return;
        if (code !== 0) return res.status(500).json({ error: 'Simulator error' });
        res.type('json').send(output);
    });
});
```

---

## 8. 파일 구조

```
project/
│
├── core/                              ← C 코어
│   ├── main.c                         진입점: stdin 수신 / 계산 / stdout 출력
│   ├── skill.h                        Skill / CharacterStats 구조체 정의
│   ├── skill.c                        스킬 수치 계산 함수
│   ├── tree.h                         SkillTree 구조체 및 트리 함수 선언
│   ├── tree.c                         트리 생성/탐색/조작/해제 구현
│   ├── simulator.h                    SimEvent / SimResult 구조체 선언
│   ├── simulator.c                    타임라인 시뮬레이터 구현
│   ├── json_parser.h                  JSON 파싱/직렬화 선언
│   ├── json_parser.c                  cJSON 기반 파싱/직렬화 구현
│   ├── cJSON.h                        cJSON 라이브러리 헤더
│   ├── cJSON.c                        cJSON 라이브러리 소스
│   └── Makefile                       빌드 스크립트
│
├── server/                            ← Node.js 서버
│   ├── app.js                         라우트 정의 + subprocess 호출
│   └── package.json                   express
│
├── frontend/                          ← 웹 UI
│   ├── index.html                     메인 페이지
│   ├── style.css                      레이아웃 + 스타일
│   └── main.js                        트리 렌더링 + API 통신
│
├── CLAUDE.md                          Claude Code 프로젝트 컨텍스트
├── PROJECT_SPEC.md                    이 문서
└── MILESTONE.md                       개발 마일스톤
```

### 8-1. 각 C 파일의 책임 범위

| 파일 | 책임 |
|---|---|
| `skill.h / skill.c` | 구조체 정의, 스케일링 공식, 최종 수치 계산 |
| `tree.h / tree.c` | 노드 생성/삭제, 탐색, 잠금/해제, 메모리 관리 |
| `simulator.h / simulator.c` | 우선순위 계산, 타임라인 루프, 결과 집계 |
| `json_parser.h / json_parser.c` | 입력 JSON 파싱, 출력 JSON 직렬화 |
| `main.c` | stdin 읽기, 모듈 연결, stdout 출력, 종료 |

---

## 9. 개발 마일스톤

### Phase 1 — C Core: 자료구조 기초
**목표:** 트리를 메모리에 올리고 기본 조작이 되는 상태

- [ ] `Skill`, `CharacterStats` 구조체 정의
- [ ] 스킬 수치 계산 함수 구현 (스케일링, CDR, 공격속도)
- [ ] 트리 생성/삽입/탐색/해제 구현
- [ ] 잠금 해제 조건 검증 구현
- [ ] 서브트리 연쇄 해제 구현
- [ ] 샘플 트리 하드코딩 후 순회 출력으로 검증

**완료 기준:** Valgrind 메모리 누수 없이 트리 조작 전과정 정상 동작

---

### Phase 2 — C Core: 시뮬레이터
**목표:** N초 타임라인 시뮬레이션으로 총 데미지 계산

- [ ] 해금 스킬 추출 및 우선순위 점수 계산
- [ ] 타임라인 이벤트 루프 구현 (전략 A + C)
- [ ] idle 구간 처리
- [ ] 결과 집계 (총 데미지, 스킬별 통계)
- [ ] 손계산 케이스로 정확도 검증

**완료 기준:** 손계산 결과와 오차 0% 일치

---

### Phase 3 — C Core: JSON I/O
**목표:** stdin JSON 수신 → 계산 → stdout JSON 출력 파이프라인 완성

- [ ] cJSON 라이브러리 통합
- [ ] 입력 JSON 파서 구현
- [ ] 출력 JSON 직렬화 구현
- [ ] `main.c` 완성 (전체 파이프라인 연결)
- [ ] 터미널 pipe 테스트

**완료 기준:** `echo '{...}' | ./simulator` 명령으로 정상 JSON 출력

---

### Phase 4 — Node.js 서버
**목표:** C 실행파일을 감싸는 HTTP 서버 구축

- [ ] Node.js + Express 프로젝트 세팅
- [ ] `/api/simulate` 엔드포인트 구현
- [ ] subprocess 호출 및 결과 전달
- [ ] 에러 핸들링 (503, 504, 500)
- [ ] curl로 엔드포인트 테스트

**완료 기준:** curl POST 요청으로 정상 JSON 응답 확인

---

### Phase 5 — 프론트엔드 UI
**목표:** 사용자가 조작 가능한 웹 인터페이스 완성

- [ ] 전체 레이아웃 HTML/CSS 구성
- [ ] 스킬 트리 시각화 렌더링 (노드/연결선)
- [ ] 스킬 클릭 인터랙션 (레벨 조정, 해금/해제)
- [ ] 선행 조건 미충족 노드 비활성화 표시
- [ ] 캐릭터 스펙 입력 패널 (슬라이더 + 수치)
- [ ] 시뮬레이션 결과 패널 (총 데미지, 스킬별 기여, 타임라인)
- [ ] 변경 전/후 비교 표시 (Δ 수치 및 %)
- [ ] Node.js API 연동

**완료 기준:** 브라우저에서 전체 시나리오(스킬 구성 → 시뮬레이션 → 결과 확인 → 변경 → 재시뮬레이션) 정상 동작

---

### Phase 6 — 통합 테스트 및 마무리
**목표:** 전체 시스템 안정화

- [ ] 엣지 케이스 테스트
  - 해금된 스킬이 하나도 없을 때
  - 모든 스킬 쿨타임이 N초보다 긴 경우
  - CDR 70% 정확히 입력 시 하한 보정 확인
  - 공격속도 200% 초과 입력 시 상한 보정 확인
- [ ] C 메모리 누수 최종 점검 (Valgrind)
- [ ] README 작성 (빌드 및 실행 방법)

---

## 10. 제약 조건 및 예외 처리

### 10-1. C Core 예외 처리

| 상황 | 처리 방법 |
|---|---|
| 해금 스킬이 0개 | `error: "No unlocked skills"` JSON 반환 |
| 레벨 0인 스킬만 존재 | `error: "No active skills (all level 0)"` JSON 반환 |
| 모든 스킬 쿨타임 > duration | idle만 발생, total_damage = 0 반환 |
| JSON 파싱 실패 | `error: "Invalid input JSON"` JSON 반환, exitcode 1 |
| CDR > 0.70 입력 | 0.70으로 클램핑 후 계산 |
| 공격속도 > 200 입력 | 200으로 클램핑 후 계산 |
| 시뮬레이션 시간 <= 0 | `error: "Invalid duration"` JSON 반환 |

### 10-2. Node.js 서버 예외 처리

| 상황 | HTTP 상태코드 |
|---|---|
| C 실행파일 없음 | 503 |
| 시뮬레이션 5초 초과 | 504 |
| C exitcode != 0 | 500 (stderr 메시지 포함) |
| 잘못된 JSON 요청 | 400 |

### 10-3. 프론트엔드 예외 처리

| 상황 | 처리 방법 |
|---|---|
| 서버 응답 error 필드 존재 | 결과 패널에 오류 메시지 표시 |
| 네트워크 오류 | "서버에 연결할 수 없습니다" 표시 |
| 공격력 0 입력 | 입력 필드 빨간색 테두리 + 경고 |
| 시뮬레이션 시간 범위 초과 | 입력 클램핑 또는 경고 |

### 10-4. 상수 정의 (core/skill.h)

```c
#define MAX_CHILDREN        10
#define MAX_SKILLS         128
#define MAX_SKILL_NAME      64
#define MAX_EVENTS        1024
#define INPUT_BUFFER_SIZE 65536

#define SKILL_LEVEL_MAX     5
#define SKILL_LEVEL_SCALE   0.20f

#define CDR_MAX             0.70f
#define CDR_FLOOR           0.30f    // 최종 쿨타임 배율 하한
#define ASPD_MIN          100.0f
#define ASPD_MAX          200.0f

#define SIMULATION_DURATION_MIN   1
#define SIMULATION_DURATION_MAX 600
```

---

*문서 버전: v1.0*
*최종 수정: 기획 확정 시점*
