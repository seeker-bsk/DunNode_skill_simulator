#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "cJSON.h"
#include "json_parser.h"
#include "tree.h"

/* ── stdin 전체 읽기 ─────────────────────────────────────────────────── */
static char* read_stdin_all(void) {
    size_t cap = 65536, len = 0;
    char*  buf = malloc(cap);
    if (!buf) return NULL;

    int c;
    while ((c = getchar()) != EOF) {
        if (len + 1 >= cap) {
            cap *= 2;
            char* tmp = realloc(buf, cap);
            if (!tmp) { free(buf); return NULL; }
            buf = tmp;
        }
        buf[len++] = (char)c;
    }
    buf[len] = '\0';
    return buf;
}

/* ── level_mode 문자열 → 열거형 ─────────────────────────────────────── */
static SkillLevelMode parse_level_mode(const char* s) {
    if (!s)                            return LEVEL_MODE_SP;
    if (strcmp(s, "auto_char")   == 0) return LEVEL_MODE_AUTO_CHAR;
    if (strcmp(s, "auto_every5") == 0) return LEVEL_MODE_AUTO_EVERY5;
    if (strcmp(s, "auto_lv1_sp") == 0) return LEVEL_MODE_AUTO_LV1_SP;
    return LEVEL_MODE_SP;
}

/* ── 단일 스킬 JSON 오브젝트 → Skill 구조체 ─────────────────────────── */
static void parse_skill_obj(const cJSON* sk, Skill* s) {
    cJSON* j;

#define STR(field, key) \
    do { j = cJSON_GetObjectItem(sk, key); \
         if (j && j->valuestring) strncpy(s->field, j->valuestring, sizeof(s->field) - 1); \
    } while(0)
#define INT(field, key, def) \
    do { j = cJSON_GetObjectItem(sk, key); s->field = j ? j->valueint : (def); } while(0)
#define FLT(field, key, def) \
    do { j = cJSON_GetObjectItem(sk, key); s->field = j ? (float)j->valuedouble : (def); } while(0)

    STR(skill_id,              "skill_id");
    STR(name,                  "name");
    INT(required_level,        "required_level",       1);
    INT(required_level_range,  "required_level_range", 1);
    INT(api_max_level,         "api_max_level",        0);
    INT(master_level,          "master_level",         1);
    INT(current_level,         "current_level",        0);
    INT(sp_cost_per_level,     "sp_cost_per_level",    1);
    INT(sp_cost_lv1,           "sp_cost_lv1",          0);
    INT(must_master,           "must_master",          0);
    INT(is_job_skill,          "is_job_skill",         0);
    INT(can_enhance,           "can_enhance",          0);
    INT(enhancement_type,      "enhancement_type",     0);
    FLT(enhancement_atk_1,     "enhancement_atk_1",   0.0f);
    FLT(enhancement_atk_2,     "enhancement_atk_2",   0.0f);
    INT(can_evolve,            "can_evolve",           0);
    INT(bloom_type,            "bloom_type",           0);
    INT(parent_id,             "parent_id",           -1);
    FLT(base_cooldown,         "base_cooldown",        0.0f);
    FLT(cast_time,             "cast_time",            0.0f);
    FLT(passive_mult,          "passive_mult",         1.0f);
    STR(pre_required_skill_id, "pre_required_skill_id");

    /* bloom_option_1 / bloom_option_2 */
    cJSON* bo;
    bo = cJSON_GetObjectItem(sk, "bloom_option_1");
    if (bo) {
        cJSON* f;
        f = cJSON_GetObjectItem(bo, "cast_time");   s->bloom_options[0].cast_time   = f ? (float)f->valuedouble : 0.0f;
        f = cJSON_GetObjectItem(bo, "damage_mult"); s->bloom_options[0].damage_mult = f ? (float)f->valuedouble : 0.0f;
        f = cJSON_GetObjectItem(bo, "cooldown");    s->bloom_options[0].cooldown    = f ? (float)f->valuedouble : 0.0f;
    }
    bo = cJSON_GetObjectItem(sk, "bloom_option_2");
    if (bo) {
        cJSON* f;
        f = cJSON_GetObjectItem(bo, "cast_time");   s->bloom_options[1].cast_time   = f ? (float)f->valuedouble : 0.0f;
        f = cJSON_GetObjectItem(bo, "damage_mult"); s->bloom_options[1].damage_mult = f ? (float)f->valuedouble : 0.0f;
        f = cJSON_GetObjectItem(bo, "cooldown");    s->bloom_options[1].cooldown    = f ? (float)f->valuedouble : 0.0f;
    }

#undef STR
#undef INT
#undef FLT

    j = cJSON_GetObjectItem(sk, "level_mode");
    s->level_mode = parse_level_mode(j ? j->valuestring : NULL);

    j = cJSON_GetObjectItem(sk, "damage_per_level");
    if (j && cJSON_IsArray(j)) {
        int dpl = cJSON_GetArraySize(j);
        s->level_count = dpl < MAX_MASTER_LEVEL ? dpl : MAX_MASTER_LEVEL;
        for (int k = 0; k < s->level_count; k++) {
            cJSON* d = cJSON_GetArrayItem(j, k);
            s->damage_per_level[k] = d ? (float)d->valuedouble : 0.0f;
        }
    }
}

/* ── 에러 JSON stdout 출력 ───────────────────────────────────────────── */
void print_error_json(const char* error_type, const char* key, const char* value) {
    cJSON* obj = cJSON_CreateObject();
    cJSON_AddStringToObject(obj, "error", error_type);
    if (key && value) cJSON_AddStringToObject(obj, key, value);
    char* s = cJSON_PrintUnformatted(obj);
    if (s) { puts(s); free(s); }
    cJSON_Delete(obj);
}

/* ── stdin JSON → SimulationInput 파싱 ──────────────────────────────── */
int parse_simulation_input(SimulationInput* out) {
    memset(out, 0, sizeof(*out));

    char* raw = read_stdin_all();
    if (!raw) { print_error_json("invalid_input", "field", "json"); return 0; }

    cJSON* root = cJSON_Parse(raw);
    free(raw);
    if (!root) { print_error_json("invalid_input", "field", "json"); return 0; }

    /* ── character ──────────────────────────────────────────────────── */
    cJSON* char_j = cJSON_GetObjectItem(root, "character");
    if (!char_j || !cJSON_IsObject(char_j)) {
        cJSON_Delete(root);
        print_error_json("invalid_input", "field", "character");
        return 0;
    }

    CharacterStats* cs = &out->character;
    cJSON* j;

#define CS_FLT(field, key, def) \
    do { j = cJSON_GetObjectItem(char_j, key); cs->field = j ? (float)j->valuedouble : (def); } while(0)
#define CS_INT(field, key, def) \
    do { j = cJSON_GetObjectItem(char_j, key); cs->field = j ? j->valueint : (def); } while(0)

    CS_FLT(attack_power,            "attack_power",            100000.0f);
    CS_FLT(cooldown_reduction,      "cooldown_reduction",      0.0f);
    CS_FLT(cooldown_recovery_speed, "cooldown_recovery_speed", 0.0f);
    CS_FLT(attack_speed,            "attack_speed",            100.0f);
    CS_INT(char_level,              "char_level",              115);
    CS_INT(total_sp,                "total_sp",                0);
    j = cJSON_GetObjectItem(char_j, "mastery_contract");
    /* boolean true 또는 정수 1(비-영) 모두 허용 */
    cs->mastery_contract = j ? (cJSON_IsTrue(j) || (cJSON_IsNumber(j) && j->valueint != 0)) : 0;

#undef CS_FLT
#undef CS_INT

    if (cs->cooldown_reduction < 0.0f || cs->cooldown_reduction > 0.70f) {
        cJSON_Delete(root);
        print_error_json("invalid_input", "field", "cooldown_reduction");
        return 0;
    }
    if (cs->char_level <= 0) {
        cJSON_Delete(root);
        print_error_json("invalid_input", "field", "char_level");
        return 0;
    }

    /* ── skills ─────────────────────────────────────────────────────── */
    cJSON* skills_j = cJSON_GetObjectItem(root, "skills");
    if (!skills_j || !cJSON_IsArray(skills_j)) {
        cJSON_Delete(root);
        print_error_json("invalid_input", "field", "skills");
        return 0;
    }

    int n = cJSON_GetArraySize(skills_j);
    if (n <= 0) {
        cJSON_Delete(root);
        print_error_json("invalid_input", "field", "skills");
        return 0;
    }

    Skill* skills = calloc((size_t)n, sizeof(Skill));
    if (!skills) {
        cJSON_Delete(root);
        print_error_json("invalid_input", "field", "skills");
        return 0;
    }

    for (int i = 0; i < n; i++) {
        cJSON* sk = cJSON_GetArrayItem(skills_j, i);
        parse_skill_obj(sk, &skills[i]);
    }

    out->skills      = skills;
    out->skill_count = n;

    /* ── simulation_duration ────────────────────────────────────────── */
    j = cJSON_GetObjectItem(root, "simulation_duration");
    out->simulation_duration = j ? (float)j->valuedouble : 60.0f;
    if (out->simulation_duration <= 0.0f) {
        free(skills);
        out->skills = NULL;
        cJSON_Delete(root);
        print_error_json("invalid_input", "field", "simulation_duration");
        return 0;
    }

    /* auto_optimize (선택, 기본 0) */
    j = cJSON_GetObjectItem(root, "auto_optimize");
    out->auto_optimize = (j && cJSON_IsTrue(j)) ? 1 : 0;

    cJSON_Delete(root);
    return 1;
}

/* ── SkillStat 비교 함수 (qsort용, 데미지 내림차순) ─────────────────── */
static int cmp_stat_desc(const void* a, const void* b) {
    const SkillStat* sa = (const SkillStat*)a;
    const SkillStat* sb = (const SkillStat*)b;
    if (sb->total_damage > sa->total_damage) return  1;
    if (sb->total_damage < sa->total_damage) return -1;
    return 0;
}

/* ── SimulationResult → stdout JSON 출력 ────────────────────────────── */
void print_simulation_result(const SimulationResult* result,
                             const SkillTree*        tree,
                             const OptResult*        opt,
                             const SpAllocResult*    sp_alloc) {
    cJSON* root = cJSON_CreateObject();
    cJSON_AddNumberToObject(root, "total_damage", (double)result->total_damage);

    /* optimization 블록 (auto_optimize 시에만) */
    if (opt || sp_alloc) {
        cJSON* opt_j = cJSON_AddObjectToObject(root, "optimization");

        /* sp_allocation 서브블록 + 배분 후 스킬별 현재 레벨 */
        if (sp_alloc) {
            cJSON* sp_j = cJSON_AddObjectToObject(opt_j, "sp_allocation");
            cJSON_AddNumberToObject(sp_j, "sp_used",         sp_alloc->sp_used);
            cJSON_AddNumberToObject(sp_j, "sp_remaining",    sp_alloc->sp_remaining);
            cJSON_AddNumberToObject(sp_j, "skills_mastered", sp_alloc->skills_mastered);

            /* 프론트엔드 UI 동기화: SP 배분 후 각 스킬의 최종 current_level */
            cJSON* lvls = cJSON_AddArrayToObject(opt_j, "skill_levels");
            for (int i = 0; i < tree->count; i++) {
                const Skill* s = &tree->skills[i];
                cJSON* item = cJSON_CreateObject();
                cJSON_AddStringToObject(item, "skill_id",      s->skill_id);
                cJSON_AddNumberToObject(item, "current_level", s->current_level);
                cJSON_AddItemToArray(lvls, item);
            }
        }

        if (opt) {
            cJSON_AddNumberToObject(opt_j, "elapsed_ms", (double)opt->elapsed_ms);

            cJSON* evols = cJSON_AddArrayToObject(opt_j, "evolutions");
            for (int k = 0; k < opt->evol_count; k++) {
                const Skill* s = &tree->skills[opt->evol_skill_idx[k]];
                cJSON* item = cJSON_CreateObject();
                cJSON_AddStringToObject(item, "skill_id",   s->skill_id);
                cJSON_AddStringToObject(item, "skill_name", s->name);
                cJSON_AddNumberToObject(item, "bloom_type", opt->evol_bloom_type[k]);
                cJSON_AddItemToArray(evols, item);
            }

            cJSON* enhs = cJSON_AddArrayToObject(opt_j, "enhancements");
            for (int k = 0; k < opt->enh_count; k++) {
                const Skill* s = &tree->skills[opt->enh_skill_idx[k]];
                cJSON* item = cJSON_CreateObject();
                cJSON_AddStringToObject(item, "skill_id",        s->skill_id);
                cJSON_AddStringToObject(item, "skill_name",      s->name);
                cJSON_AddNumberToObject(item, "enhancement_type", opt->enh_type[k]);
                float atk = opt->enh_type[k] == 1 ? s->enhancement_atk_1 : s->enhancement_atk_2;
                cJSON_AddNumberToObject(item, "atk_bonus_pct", (double)(atk * 100.0f));
                cJSON_AddItemToArray(enhs, item);
            }
        }
    }

    /* timeline */
    cJSON* timeline = cJSON_AddArrayToObject(root, "timeline");
    for (int i = 0; i < result->event_count; i++) {
        const TimelineEvent* ev = &result->events[i];
        cJSON* item = cJSON_CreateObject();
        cJSON_AddNumberToObject(item, "time", (double)ev->time);

        if (ev->skill_idx == -1) {
            cJSON_AddNullToObject(item, "skill_id");
            cJSON_AddNumberToObject(item, "idle_duration", (double)ev->idle_duration);
        } else {
            const Skill* s = &tree->skills[ev->skill_idx];
            cJSON_AddStringToObject(item, "skill_id",   s->skill_id);
            cJSON_AddStringToObject(item, "skill_name", s->name);
            cJSON_AddNumberToObject(item, "damage",     (double)ev->damage);
        }
        cJSON_AddItemToArray(timeline, item);
    }

    /* skill_stats: 데미지 내림차순 정렬 후 출력 */
    int stat_count = result->stat_count < MAX_SIM_SKILLS ? result->stat_count : MAX_SIM_SKILLS;
    SkillStat sorted[MAX_SIM_SKILLS];
    memcpy(sorted, result->stats, (size_t)stat_count * sizeof(SkillStat));
    qsort(sorted, (size_t)stat_count, sizeof(SkillStat), cmp_stat_desc);

    cJSON* skill_stats = cJSON_AddArrayToObject(root, "skill_stats");
    for (int i = 0; i < stat_count; i++) {
        const SkillStat* st = &sorted[i];
        const Skill*     s  = &tree->skills[st->skill_idx];
        cJSON* item = cJSON_CreateObject();
        cJSON_AddStringToObject(item, "skill_id",         s->skill_id);
        cJSON_AddStringToObject(item, "skill_name",       s->name);
        cJSON_AddNumberToObject(item, "use_count",        st->use_count);
        cJSON_AddNumberToObject(item, "total_damage",     (double)st->total_damage);
        cJSON_AddNumberToObject(item, "contribution_pct", (double)st->contribution_pct);
        cJSON_AddItemToArray(skill_stats, item);
    }

    char* text = cJSON_PrintUnformatted(root);
    if (text) { puts(text); free(text); }
    cJSON_Delete(root);
}

/* ── SimulationInput 메모리 해제 ────────────────────────────────────── */
void simulation_input_free(SimulationInput* in) {
    free(in->skills);
    in->skills      = NULL;
    in->skill_count = 0;
}
