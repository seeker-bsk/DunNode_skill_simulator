#include <stdio.h>
#include <string.h>
#include "simulator.h"

void prepare_auto_levels(SkillTree* tree, const CharacterStats* cs) {
    int eff_lv = get_effective_char_level(cs);
    for (int i = 0; i < tree->count; i++) {
        Skill* s = &tree->skills[i];
        switch (s->level_mode) {
            case LEVEL_MODE_AUTO_CHAR:
                s->current_level = eff_lv < s->master_level ? eff_lv : s->master_level;
                break;
            case LEVEL_MODE_AUTO_EVERY5:
                s->current_level = get_auto_every5_level(s, eff_lv);
                break;
            default:
                break;
        }
    }
}

void run_simulation(SkillTree* tree, const CharacterStats* cs,
                    float duration, SimulationResult* out) {
    memset(out, 0, sizeof(*out));
    if (!tree || !cs || duration <= 0.0f) return;

    float combined_cdr = get_combined_cdr(cs);

    /* 스킬별 다음 사용 가능 시각 (0.0 = 즉시 사용 가능) */
    float next_avail[MAX_SIM_SKILLS] = {0};
    int   active_count = tree->count < MAX_SIM_SKILLS ? tree->count : MAX_SIM_SKILLS;

    float t = 0.0f;

    while (t < duration - 1e-6f) {

        /* ── 전략 A: priority 최고 스킬 선택 ─────────────────────────── */
        int   best     = -1;
        float best_pri = 0.0f; /* 0 이하 priority 스킬(무데미지)은 선택 안 함 */

        for (int i = 0; i < active_count; i++) {
            const Skill* s = &tree->skills[i];
            if (s->current_level <= 0)         continue;  /* 미습득 */
            if (next_avail[i] > t + 1e-6f)     continue;  /* 쿨 미완료 */

            float cast = get_cast_time(s);
            if (t + cast > duration + 1e-6f)   continue;  /* 전략 C: 시간 초과 */

            /* cast_time=0 + cooldown=0 → 시간이 안 흘러 무한루프. 제외. */
            float enh_cdr_local = get_enhancement_cdr(s);
            float cdr_local     = get_combined_cdr(cs) + enh_cdr_local;
            if (cdr_local > 0.70f) cdr_local = 0.70f;
            if (cast < 1e-6f && get_final_cooldown(s, cdr_local) < 1e-6f) continue;

            float pri = get_priority(s, cs);
            if (pri > best_pri) { best_pri = pri; best = i; }
        }

        /* ── 사용 가능 스킬 없음 → idle 후 다음 쿨 완료 시점으로 점프 ── */
        if (best == -1) {
            float next_t = duration;
            for (int i = 0; i < active_count; i++) {
                const Skill* s = &tree->skills[i];
                if (s->current_level <= 0)     continue;
                if (next_avail[i] <= t + 1e-6f) continue; /* 이미 가능 → 위에서 처리됐어야 함 */
                float cast = get_cast_time(s);
                /* 전략 C 적용: 이 스킬이 쿨 끝난 후에도 시전 완료 불가면 건너뜀 */
                if (next_avail[i] + cast > duration + 1e-6f) continue;
                if (next_avail[i] < next_t) next_t = next_avail[i];
            }
            if (next_t >= duration - 1e-6f) break; /* 더 쓸 수 있는 스킬 없음 */

            /* idle 이벤트 */
            if (out->event_count < MAX_TIMELINE_EVENTS) {
                TimelineEvent* ev = &out->events[out->event_count++];
                ev->time          = t;
                ev->skill_idx     = -1;
                ev->damage        = 0.0f;
                ev->idle_duration = next_t - t;
            }
            t = next_t;
            continue;
        }

        /* ── 스킬 사용 ────────────────────────────────────────────────── */
        const Skill* s = &tree->skills[best];

        float bloom_dmg = 1.0f;
        if (s->bloom_type >= 1 && s->bloom_type <= 2) {
            float dm = s->bloom_options[s->bloom_type - 1].damage_mult;
            if (dm > 0.0f) bloom_dmg = dm;
        }
        /* 데미지 계수(%) 합산 — attack_power 미적용 */
        float dmg = get_damage_at_level(s, s->current_level)
                  * get_enhancement_mult(s)
                  * bloom_dmg
                  * s->passive_mult;

        /* 타임라인 이벤트 기록 */
        if (out->event_count < MAX_TIMELINE_EVENTS) {
            TimelineEvent* ev = &out->events[out->event_count++];
            ev->time          = t;
            ev->skill_idx     = best;
            ev->damage        = dmg;
            ev->idle_duration = 0.0f;
        }
        out->total_damage += dmg;

        t += get_cast_time(s);

        /* 강화 타입 2는 해당 스킬의 쿨타임에만 CDR +15% */
        float enh_cdr   = get_enhancement_cdr(s);
        float total_cdr = combined_cdr + enh_cdr;
        if (total_cdr > 0.70f) total_cdr = 0.70f;
        next_avail[best] = t + get_final_cooldown(s, total_cdr);

        /* 스킬별 통계 갱신 */
        int si = -1;
        for (int j = 0; j < out->stat_count; j++) {
            if (out->stats[j].skill_idx == best) { si = j; break; }
        }
        if (si == -1 && out->stat_count < MAX_SIM_SKILLS) {
            si = out->stat_count++;
            out->stats[si].skill_idx    = best;
            out->stats[si].use_count    = 0;
            out->stats[si].total_damage = 0.0f;
        }
        if (si != -1) {
            out->stats[si].use_count++;
            out->stats[si].total_damage += dmg;
        }
    }

    /* contribution_pct 최종 계산 */
    for (int i = 0; i < out->stat_count; i++) {
        out->stats[i].contribution_pct =
            out->total_damage > 0.0f
            ? out->stats[i].total_damage / out->total_damage * 100.0f
            : 0.0f;
    }
}
