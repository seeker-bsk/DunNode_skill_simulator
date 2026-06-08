#include <stdio.h>
#include <string.h>
#include "skill.h"

int get_effective_char_level(const CharacterStats* cs) {
    return cs->char_level + (cs->mastery_contract ? MASTERY_CONTRACT_BONUS : 0);
}

int get_investable_max(const Skill* s, int eff_lv) {
    if (eff_lv < s->required_level) return 0;
    int char_cap = (eff_lv - s->required_level) / s->required_level_range + 1;
    return char_cap < s->master_level ? char_cap : s->master_level;
}

int get_auto_every5_level(const Skill* s, int eff_lv) {
    if (eff_lv < s->required_level) return 0;
    int lv = (eff_lv - s->required_level) / 5 + 1;
    return lv < s->master_level ? lv : s->master_level;
}

float get_damage_at_level(const Skill* s, int level) {
    if (s->level_count <= 0) return 0.0f;
    int idx = level - 1;
    if (idx < 0)                idx = 0;
    if (idx >= s->level_count)  idx = s->level_count - 1;
    return s->damage_per_level[idx];
}

/* ── M2 ─────────────────────────────────────────────────────────────── */

float get_combined_cdr(const CharacterStats* cs) {
    float recovery_cdr = 1.0f - 100.0f / (100.0f + cs->cooldown_recovery_speed);
    float combined     = cs->cooldown_reduction + recovery_cdr;
    return combined > 0.70f ? 0.70f : combined;
}

/* 강화 배율: 스킬별 실수치 사용 */
float get_enhancement_mult(const Skill* s) {
    if (!s) return 1.0f;
    if (s->enhancement_type == 1) return 1.0f + s->enhancement_atk_1;
    if (s->enhancement_type == 2) return 1.0f + s->enhancement_atk_2;
    return 1.0f;
}

/* CDR +15%는 type 2에 항상 고정 (직업 무관) */
float get_enhancement_cdr(const Skill* s) {
    return (s && s->enhancement_type == 2) ? 0.15f : 0.0f;
}

/* bloom_options[bloom_type-1].cooldown이 0이면 base_cooldown 사용 */
float get_final_cooldown(const Skill* s, float combined_cdr) {
    float base_cd = s->base_cooldown;
    if (s->bloom_type >= 1 && s->bloom_type <= 2) {
        float bcd = s->bloom_options[s->bloom_type - 1].cooldown;
        if (bcd > 0.0f) base_cd = bcd;
    }
    float factor = 1.0f - combined_cdr;
    if (factor < 0.30f) factor = 0.30f;
    return base_cd * factor;
}

/* bloom_options[bloom_type-1].cast_time이 -1이면 base cast_time 사용, 0 이상이면 그 값 사용 (0 = 즉시시전) */
float get_cast_time(const Skill* s) {
    if (s->bloom_type >= 1 && s->bloom_type <= 2) {
        float ct = s->bloom_options[s->bloom_type - 1].cast_time;
        if (ct >= 0.0f) return ct;
    }
    return s->cast_time;
}

float get_priority(const Skill* s, const CharacterStats* cs) {
    if (s->current_level <= 0) return 0.0f;

    float bloom_dmg = 1.0f;
    if (s->bloom_type >= 1 && s->bloom_type <= 2) {
        float dm = s->bloom_options[s->bloom_type - 1].damage_mult;
        if (dm > 0.0f) bloom_dmg = dm;
    }

    /* 공격력 독립적인 계수(%) 기준 DPS — attack_power 곱하지 않음 */
    float dmg = get_damage_at_level(s, s->current_level)
              * get_enhancement_mult(s)
              * bloom_dmg
              * s->passive_mult;

    float enh_cdr   = get_enhancement_cdr(s);
    float total_cdr = get_combined_cdr(cs) + enh_cdr;
    if (total_cdr > 0.70f) total_cdr = 0.70f;

    float cd    = get_final_cooldown(s, total_cdr);
    float cast  = get_cast_time(s);
    float denom = cd + cast;
    return denom > 0.0f ? dmg / denom : 0.0f;
}

void format_pct(char* buf, int bufsize, float value) {
    long long iv = (long long)(value + 0.5f);
    if (iv <= 0) { snprintf(buf, bufsize, "0%%"); return; }

    /* 역순으로 3자리마다 쉼표 삽입 */
    char rev[48];
    int  pos    = 0;
    int  digits = 0;
    long long v = iv;
    while (v > 0) {
        if (digits > 0 && digits % 3 == 0) rev[pos++] = ',';
        rev[pos++] = (char)('0' + (int)(v % 10));
        v /= 10;
        digits++;
    }

    /* 뒤집어서 buf에 기록 */
    int len = pos;
    if (len + 2 >= bufsize) len = bufsize - 2;
    for (int i = 0; i < len; i++) buf[i] = rev[len - 1 - i];
    buf[len]     = '%';
    buf[len + 1] = '\0';
}
