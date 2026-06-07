#include <string.h>
#include "sp_allocator.h"
#include "skill.h"

/*
 * SP 배분 계층 보정값 (3단 계층 구조).
 *
 * UTIL_JOB_TIER: 전직 유틸/버프 스킬 (데미지 없음, is_job_skill=1)
 *   → 실제 게임에서 공격 스킬보다 먼저 찍는 스킬들.
 *   → damage_per_level이 비어 있어 DPS 지표가 없으므로 별도 최상위 계층 부여.
 *
 * JOB_TIER_BONUS: 전직 데미지 스킬 (데미지 있음, is_job_skill=1)
 *   → 공통 스킬보다 항상 우선, 유틸 전직보다는 후순위.
 *
 * 공통 스킬: priority 그대로 (0 이하면 제외).
 *
 * 새 직업 추가 시 is_job_skill 판정만 올바르면 코드 수정 없이 자동 적용.
 */
#define JOB_TIER_BONUS  1e9f
#define UTIL_JOB_TIER   (2.0f * JOB_TIER_BONUS)

/*
 * 스킬을 현재 레벨에서 1레벨 올리는 데 필요한 SP.
 * 반환값 -1: AUTO 스킬 (SP 소모 없음, 배분 대상 아님)
 * 반환값  0: AUTO_LV1_SP 스킬의 lv0→lv1 (무료 습득)
 */
static int sp_cost_to_levelup(const Skill* s) {
    if (s->level_mode == LEVEL_MODE_AUTO_CHAR ||
        s->level_mode == LEVEL_MODE_AUTO_EVERY5) return -1;

    if (s->level_mode == LEVEL_MODE_AUTO_LV1_SP && s->current_level == 0) return 0;

    /* LEVEL_MODE_SP: lv0→lv1은 sp_cost_lv1 우선, 이후는 sp_cost_per_level */
    if (s->current_level == 0 && s->sp_cost_lv1 > 0) return s->sp_cost_lv1;
    return s->sp_cost_per_level;
}

void allocate_sp(SkillTree* tree, const CharacterStats* cs, SpAllocResult* out) {
    memset(out, 0, sizeof(*out));
    if (!tree || !cs || cs->total_sp <= 0) return;

    int eff_lv    = get_effective_char_level(cs);
    int remaining = cs->total_sp;

    /* ── Pre: AUTO_LV1_SP 스킬 lv1 자동 습득 (SP 무관) ─────────────────── */
    for (int i = 0; i < tree->count; i++) {
        Skill* s = &tree->skills[i];
        if (s->level_mode != LEVEL_MODE_AUTO_LV1_SP || s->current_level != 0) continue;
        if (get_investable_max(s, eff_lv) >= 1) s->current_level = 1;
    }

    /* ── Phase 0: must_master 스킬 우선 마스터 ──────────────────────────── */
    for (int i = 0; i < tree->count; i++) {
        Skill* s = &tree->skills[i];
        if (!s->must_master) continue;
        int cap = get_investable_max(s, eff_lv);
        while (s->current_level < cap) {
            int cost = sp_cost_to_levelup(s);
            if (cost < 0) break;          /* AUTO 스킬: 건너뜀 */
            if (cost > remaining) break;  /* SP 부족 */
            remaining       -= cost;
            out->sp_used    += cost;
            s->current_level++;
        }
        if (cap > 0 && s->current_level >= cap) out->skills_mastered++;
    }

    /* ── Phase 1: 3단 계층 greedy (전직 유틸 → 전직 DPS → 공통 DPS) ──── */
    /*
     * 잠금 스킬: master_level = current_level이므로 cap 도달 상태로 처리됨.
     * 새 직업 추가 시: is_job_skill 판정만 올바르면 자동 적용.
     */
    for (;;) {
        int   best     = -1;
        float best_eff = 0.0f;

        for (int i = 0; i < tree->count; i++) {
            Skill* s   = &tree->skills[i];
            int    cap = get_investable_max(s, eff_lv);
            if (s->current_level >= cap) continue;

            int cost = sp_cost_to_levelup(s);
            if (cost < 0 || cost > remaining) continue;

            /* 다음 레벨의 priority 임시 평가 후 복구 */
            s->current_level++;
            float pri_next = get_priority(s, cs);
            s->current_level--;

            /*
             * 3단 계층 우선순위:
             *   1위 (UTIL_JOB_TIER=2e9): 전직 유틸/버프 스킬 (데미지 없음)
             *        level_count==0 → damage_per_level 비어 있음
             *        실제 게임 운영 패턴 반영: 버프/패시브 먼저 마스터
             *   2위 (JOB_TIER_BONUS+pri): 전직 데미지 스킬
             *        공통 스킬보다 항상 우선, 유틸보다는 후순위
             *   3위 (pri_next): 공통 스킬
             *        전직 스킬 소진 후 남은 SP에서 DPS 최적화
             */
            float eff;
            if (s->is_job_skill) {
                eff = (s->level_count == 0)
                    ? UTIL_JOB_TIER
                    : (JOB_TIER_BONUS + pri_next);
            } else {
                eff = pri_next;
            }

            if (eff > best_eff) { best_eff = eff; best = i; }
        }

        if (best == -1) break; /* 투자 가능한 스킬 없음 또는 SP 소진 */

        Skill* chosen = &tree->skills[best];
        int    cost   = sp_cost_to_levelup(chosen);
        remaining          -= cost;
        out->sp_used       += cost;
        chosen->current_level++;
    }

    /* ── Phase 2: 잔여 SP 소진 (목표: 50 이내) ─────────────────────────── */
    /*
     * Phase 1은 best_eff > 0 임계값 때문에 priority=0인 스킬
     * (공통 유틸/패시브 등, DPS 기여 없음)을 건너뛴다.
     * Phase 2에서 우선순위 무관하게 남은 SP를 투자해 잔여량을 최소화한다.
     * 잠금 스킬은 master_level=current_level이므로 cap 도달로 자동 제외.
     */
    int p2_changed;
    do {
        p2_changed = 0;
        for (int i = 0; i < tree->count; i++) {
            Skill* s   = &tree->skills[i];
            int    cap = get_investable_max(s, eff_lv);
            if (s->current_level >= cap) continue;
            int cost = sp_cost_to_levelup(s);
            if (cost < 0 || cost > remaining) continue;
            remaining       -= cost;
            out->sp_used    += cost;
            s->current_level++;
            p2_changed = 1;
        }
    } while (p2_changed && remaining > 50);

    out->sp_remaining = remaining;
}
