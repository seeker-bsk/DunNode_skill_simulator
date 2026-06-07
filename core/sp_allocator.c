#include <string.h>
#include "sp_allocator.h"
#include "skill.h"

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

    /* ── Phase 1: 남은 SP를 DPS 기준으로 1레벨씩 배분 ──────────────────── */
    /*
     * 매 이터레이션마다 투자 가능한 스킬 중 "다음 레벨의 priority"가
     * 가장 높은 스킬에 1레벨을 투자한다. priority = 0인 스킬(passive 등)은
     * best_pri 초기값 0.0f보다 크지 않으므로 자동 제외된다.
     */
    for (;;) {
        int   best     = -1;
        float best_pri = 0.0f;

        for (int i = 0; i < tree->count; i++) {
            Skill* s  = &tree->skills[i];
            int    cap = get_investable_max(s, eff_lv);
            if (s->current_level >= cap) continue;

            int cost = sp_cost_to_levelup(s);
            if (cost < 0 || cost > remaining) continue;

            /* 다음 레벨의 priority 임시 평가 후 복구 */
            s->current_level++;
            float pri = get_priority(s, cs);
            s->current_level--;

            if (pri > best_pri) { best_pri = pri; best = i; }
        }

        if (best == -1) break; /* 투자 가능한 스킬 없음 또는 SP 소진 */

        Skill* chosen = &tree->skills[best];
        int    cost   = sp_cost_to_levelup(chosen);
        remaining          -= cost;
        out->sp_used       += cost;
        chosen->current_level++;
    }

    out->sp_remaining = remaining;
}
