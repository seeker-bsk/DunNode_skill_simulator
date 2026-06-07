#ifndef SP_ALLOCATOR_H
#define SP_ALLOCATOR_H

#include "skill.h"
#include "tree.h"

typedef struct {
    int sp_used;         /* 소비한 총 SP */
    int sp_remaining;    /* 잔여 SP */
    int skills_mastered; /* must_master 단계에서 investable_max까지 도달한 스킬 수 */
} SpAllocResult;

/*
 * SP 배분.
 *
 * 순서:
 *   Pre:     LEVEL_MODE_AUTO_LV1_SP 스킬 lv1 자동 습득 (SP 소모 없음)
 *   Phase 0: must_master == 1 스킬을 investable_max까지 우선 투자
 *   Phase 1: 남은 SP를 get_priority() 기준으로 1레벨씩 배분
 *            매 이터레이션마다 "다음 레벨의 priority"가 가장 높은 스킬에 1레벨 투자
 *
 * tree->skills[i].current_level을 직접 변경한다.
 * cs->total_sp가 0 이하면 아무것도 하지 않는다.
 */
void allocate_sp(SkillTree* tree, const CharacterStats* cs, SpAllocResult* out);

#endif /* SP_ALLOCATOR_H */
