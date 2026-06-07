#ifndef SIMULATOR_H
#define SIMULATOR_H

#include "skill.h"
#include "tree.h"

/* 시뮬레이션 시간 60~300초 기준 여유분 */
#define MAX_TIMELINE_EVENTS 8192
#define MAX_SIM_SKILLS      256

/* 타임라인 이벤트 1건 */
typedef struct {
    float time;
    int   skill_idx;      /* tree->skills[] 인덱스, -1이면 idle */
    float damage;
    float idle_duration;  /* skill_idx == -1일 때만 유효 */
} TimelineEvent;

/* 스킬별 누적 통계 */
typedef struct {
    int   skill_idx;
    int   use_count;
    float total_damage;
    float contribution_pct;
} SkillStat;

typedef struct {
    float         total_damage;
    int           event_count;
    TimelineEvent events[MAX_TIMELINE_EVENTS];
    int           stat_count;
    SkillStat     stats[MAX_SIM_SKILLS];
} SimulationResult;

/*
 * AUTO 레벨 모드 스킬의 current_level을 캐릭터 스펙으로 설정.
 * LEVEL_MODE_SP / AUTO_LV1_SP 스킬은 건드리지 않음.
 */
void prepare_auto_levels(SkillTree* tree, const CharacterStats* cs);

/*
 * 타임라인 시뮬레이터 (전략 A + C).
 *   전략 A: 쿨다운 끝난 스킬 중 priority(DPS) 최고 우선 선택.
 *   전략 C: t + cast_time > duration 스킬은 후보 제외 (시간 초과 방지).
 * tree의 current_level이 설정된 상태에서 호출해야 한다.
 */
void run_simulation(SkillTree* tree, const CharacterStats* cs,
                    float duration, SimulationResult* out);

#endif /* SIMULATOR_H */
