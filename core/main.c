#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "cJSON.h"
#include "skill.h"
#include "tree.h"
#include "simulator.h"
#include "json_parser.h"
#include "optimizer.h"
#include "sp_allocator.h"

/* ── 유틸: 파일 전체 읽기 ────────────────────────────────────────────── */
static char* read_file(const char* path) {
    FILE* f = fopen(path, "rb");
    if (!f) { fprintf(stderr, "파일 열기 실패: %s\n", path); return NULL; }
    fseek(f, 0, SEEK_END);
    long size = ftell(f);
    rewind(f);
    char* buf = malloc((size_t)size + 1);
    if (!buf) { fclose(f); return NULL; }
    fread(buf, 1, (size_t)size, f);
    buf[size] = '\0';
    fclose(f);
    return buf;
}

/* ── merged.json → Skill[] 파싱 ─────────────────────────────────────── */
static int load_merged(const char* filepath, Skill** out, int* out_count) {
    char* raw = read_file(filepath);
    if (!raw) return 0;

    cJSON* root = cJSON_Parse(raw);
    free(raw);
    if (!root || !cJSON_IsArray(root)) {
        fprintf(stderr, "merged.json 파싱 실패\n");
        cJSON_Delete(root);
        return 0;
    }

    int n = cJSON_GetArraySize(root);
    Skill* skills = calloc((size_t)n, sizeof(Skill));
    if (!skills) { cJSON_Delete(root); return 0; }

    int count = 0;
    for (int i = 0; i < n; i++) {
        cJSON* sk = cJSON_GetArrayItem(root, i);
        Skill* s  = &skills[count];
        cJSON* j;

#define STR(field, key) \
    do { j = cJSON_GetObjectItem(sk, key); \
         if (j && j->valuestring) strncpy(s->field, j->valuestring, sizeof(s->field) - 1); \
    } while(0)
#define INT(field, key, def) \
    do { j = cJSON_GetObjectItem(sk, key); s->field = j ? j->valueint : (def); } while(0)
#define FLT(field, key, def) \
    do { j = cJSON_GetObjectItem(sk, key); s->field = j ? (float)j->valuedouble : (def); } while(0)

        STR(skill_id, "skill_id");
        STR(name,     "name");
        INT(required_level,       "required_level",       1);
        INT(required_level_range, "required_level_range", 1);
        INT(api_max_level,        "api_max_level",        1);
        INT(master_level,         "master_level",         1);
        INT(sp_cost_per_level,    "sp_cost_per_level",    1);
        INT(sp_cost_lv1,          "sp_cost_lv1",          0);
        INT(can_enhance,          "can_enhance",          0);
        INT(enhancement_type,     "enhancement_type",     0);
        FLT(enhancement_atk_1,    "enhancement_atk_1",   0.0f);
        FLT(enhancement_atk_2,    "enhancement_atk_2",   0.0f);
        INT(can_evolve,           "can_evolve",           0);
        INT(bloom_type,           "bloom_type",           0);
        INT(parent_id,            "parent_id",           -1);
        FLT(base_cooldown,        "base_cooldown",        0.0f);
        FLT(cast_time,            "cast_time",            0.0f);
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

        /* level_mode 문자열 → 열거형 */
        j = cJSON_GetObjectItem(sk, "level_mode");
        if (j && j->valuestring) {
            if      (strcmp(j->valuestring, "auto_char")    == 0) s->level_mode = LEVEL_MODE_AUTO_CHAR;
            else if (strcmp(j->valuestring, "auto_every5")  == 0) s->level_mode = LEVEL_MODE_AUTO_EVERY5;
            else if (strcmp(j->valuestring, "auto_lv1_sp")  == 0) s->level_mode = LEVEL_MODE_AUTO_LV1_SP;
            else                                                   s->level_mode = LEVEL_MODE_SP;
        }

        /* damage_per_level 배열 */
        j = cJSON_GetObjectItem(sk, "damage_per_level");
        if (j && cJSON_IsArray(j)) {
            int dpl = cJSON_GetArraySize(j);
            s->level_count = dpl < MAX_MASTER_LEVEL ? dpl : MAX_MASTER_LEVEL;
            for (int k = 0; k < s->level_count; k++) {
                cJSON* d = cJSON_GetArrayItem(j, k);
                s->damage_per_level[k] = d ? (float)d->valuedouble : 0.0f;
            }
        }

        count++;
    }

    cJSON_Delete(root);
    *out       = skills;
    *out_count = count;
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

/* ── --simulate 모드 ─────────────────────────────────────────────────── */
static int cmd_simulate(const char* filepath, float duration) {
    /* 스킬 로드 */
    Skill* skills = NULL;
    int    count  = 0;
    if (!load_merged(filepath, &skills, &count)) return 1;

    /* 테스트용 CharacterStats (눈마새 기준 대략적 수치) */
    CharacterStats cs = {0};
    cs.attack_power           = 5000000.0f;
    cs.cooldown_reduction     = 0.10f;
    cs.cooldown_recovery_speed= 40.0f;
    cs.attack_speed           = 150.0f;
    cs.char_level             = 115;
    cs.mastery_contract       = 1;
    cs.total_sp               = 600;

    /* SP 스킬: 테스트 목적으로 master_level 기준 만렙
     * (실제 배분은 M4 JSON I/O 통합 시 입력 current_level 사용) */
    for (int i = 0; i < count; i++) {
        Skill* s = &skills[i];
        if (s->level_mode == LEVEL_MODE_SP || s->level_mode == LEVEL_MODE_AUTO_LV1_SP) {
            int investable = get_investable_max(s, get_effective_char_level(&cs));
            s->current_level = investable;
        }
    }

    /* 트리 빌드 + AUTO 레벨 설정 */
    SkillTree* tree = tree_build(skills, count);
    if (!tree) { free(skills); return 1; }
    prepare_auto_levels(tree, &cs);

    /* 시뮬레이션 실행 */
    SimulationResult result;
    run_simulation(tree, &cs, duration, &result);

    /* ── 결과 출력 ───────────────────────────────────────────────────── */
    char total_buf[32];
    format_pct(total_buf, sizeof(total_buf), result.total_damage);

    printf("=== 시뮬레이션 결과 (%.0f초) ===\n", duration);
    printf("총 데미지: %s\n\n", total_buf);

    /* 스킬 통계 정렬 (데미지 내림차순) */
    qsort(result.stats, (size_t)result.stat_count, sizeof(SkillStat), cmp_stat_desc);

    printf("%-30s %6s  %12s  %7s\n", "스킬명", "사용수", "데미지",     "기여도");
    printf("%-30s %6s  %12s  %7s\n",
           "------------------------------", "------", "------------", "-------");
    for (int i = 0; i < result.stat_count; i++) {
        const SkillStat* st = &result.stats[i];
        const Skill*     s  = &tree->skills[st->skill_idx];
        char dmg_buf[32];
        format_pct(dmg_buf, sizeof(dmg_buf), st->total_damage);
        printf("%-30s %6d  %12s  %6.1f%%\n",
               s->name, st->use_count, dmg_buf, st->contribution_pct);
    }

    /* 타임라인 앞부분 20줄 미리보기 */
    int preview = result.event_count < 20 ? result.event_count : 20;
    printf("\n--- 타임라인 미리보기 (처음 %d건) ---\n", preview);
    for (int i = 0; i < preview; i++) {
        const TimelineEvent* ev = &result.events[i];
        if (ev->skill_idx == -1) {
            printf("  t=%6.2f  [idle %.2fs]\n", ev->time, ev->idle_duration);
        } else {
            const Skill* s = &tree->skills[ev->skill_idx];
            char dmg_buf[32];
            format_pct(dmg_buf, sizeof(dmg_buf), ev->damage);
            printf("  t=%6.2f  %-28s %s\n", ev->time, s->name, dmg_buf);
        }
    }
    printf("\n총 이벤트: %d건\n", result.event_count);

    tree_free(tree);
    return 0;
}

/* ── --list 모드: merged.json → 스킬 데미지 계수 목록 출력 ──────────── */
static int cmd_list(const char* filepath) {
    char* raw = read_file(filepath);
    if (!raw) return 1;

    cJSON* root = cJSON_Parse(raw);
    free(raw);
    if (!root) { fprintf(stderr, "JSON 파싱 실패\n"); return 1; }
    if (!cJSON_IsArray(root)) { fprintf(stderr, "merged.json이 배열이 아님\n"); cJSON_Delete(root); return 1; }

    printf("%-30s %12s  %12s  %s\n", "스킬명", "기본 계수", "강화 계수", "강화 종류");
    printf("%-30s %12s  %12s  %s\n",
           "------------------------------",
           "------------", "------------", "----------");

    int skill_count = cJSON_GetArraySize(root);
    for (int i = 0; i < skill_count; i++) {
        cJSON* sk = cJSON_GetArrayItem(root, i);

        cJSON* type_j = cJSON_GetObjectItem(sk, "type");
        if (!type_j || strcmp(type_j->valuestring, "active") != 0) continue;

        cJSON* name_j   = cJSON_GetObjectItem(sk, "name");
        cJSON* ml_j     = cJSON_GetObjectItem(sk, "master_level");
        cJSON* dpl_j    = cJSON_GetObjectItem(sk, "damage_per_level");
        cJSON* atk1_j   = cJSON_GetObjectItem(sk, "enhancement_atk_1");
        cJSON* atk2_j   = cJSON_GetObjectItem(sk, "enhancement_atk_2");
        cJSON* can_enh_j= cJSON_GetObjectItem(sk, "can_enhance");

        if (!name_j || !ml_j || !dpl_j || !cJSON_IsArray(dpl_j)) continue;

        int   master_level = ml_j->valueint;
        int   dpl_size     = cJSON_GetArraySize(dpl_j);
        if (dpl_size == 0) continue;

        int idx = master_level - 1;
        if (idx >= dpl_size) idx = dpl_size - 1;
        cJSON* dmg_j = cJSON_GetArrayItem(dpl_j, idx);
        if (!dmg_j) continue;

        float base_dmg = (float)dmg_j->valuedouble;
        float atk1 = atk1_j ? (float)atk1_j->valuedouble : 0.0f;
        float atk2 = atk2_j ? (float)atk2_j->valuedouble : 0.0f;
        int   can_enh = can_enh_j ? cJSON_IsTrue(can_enh_j) : 0;

        float enh_dmg = base_dmg * (can_enh && atk2 > 0 ? 1.0f + atk2
                                  : can_enh && atk1 > 0 ? 1.0f + atk1 : 1.0f);

        char base_buf[32], enh_buf[32];
        format_pct(base_buf, sizeof(base_buf), base_dmg);
        format_pct(enh_buf,  sizeof(enh_buf),  enh_dmg);

        char enh_label[48] = "-";
        if (can_enh) {
            if (atk2 > 0) snprintf(enh_label, sizeof(enh_label), "+%.0f%% / CDR+15%%", atk2 * 100);
            else if (atk1 > 0) snprintf(enh_label, sizeof(enh_label), "+%.0f%%", atk1 * 100);
        }

        printf("%-30s %12s  %12s  %s\n",
               name_j->valuestring, base_buf, enh_buf, enh_label);
    }

    cJSON_Delete(root);
    return 0;
}

/* ── --test 모드: M1+M2 스모크 테스트 ───────────────────────────────── */
static int cmd_test(void) {
    int failed = 0;

    Skill* skills = calloc(3, sizeof(Skill));
    if (!skills) { fprintf(stderr, "calloc 실패\n"); return 1; }

    strncpy(skills[0].skill_id, "id-root-a", 63);
    strncpy(skills[0].name,     "루트A",     63);
    skills[0].parent_id    = -1;
    skills[0].master_level = 3;
    skills[0].level_count  = 3;
    skills[0].damage_per_level[0] = 100.0f;
    skills[0].damage_per_level[1] = 200.0f;
    skills[0].damage_per_level[2] = 300.0f;
    skills[0].base_cooldown = 10.0f;
    skills[0].current_level = 3;
    skills[0].level_mode    = LEVEL_MODE_SP;
    skills[0].passive_mult  = 1.0f;

    strncpy(skills[1].skill_id, "id-child-a1", 63);
    strncpy(skills[1].name,     "자식A1",    63);
    skills[1].parent_id    = 0;
    skills[1].master_level = 2;
    skills[1].level_count  = 2;
    skills[1].damage_per_level[0] = 500.0f;
    skills[1].damage_per_level[1] = 900.0f;
    skills[1].base_cooldown = 15.0f;
    skills[1].current_level = 2;
    skills[1].level_mode    = LEVEL_MODE_SP;
    skills[1].passive_mult  = 1.0f;

    strncpy(skills[2].skill_id, "id-root-b", 63);
    strncpy(skills[2].name,     "루트B",     63);
    skills[2].parent_id    = -1;
    skills[2].master_level = 1;
    skills[2].level_count  = 1;
    skills[2].damage_per_level[0] = 999.0f;
    skills[2].base_cooldown = 5.0f;
    skills[2].current_level = 1;
    skills[2].level_mode    = LEVEL_MODE_SP;
    skills[2].passive_mult  = 1.0f;

    SkillTree* tree = tree_build(skills, 3);
    if (!tree) { free(skills); return 1; }

#define CHECK(cond, msg) do { \
    if (cond) { printf("[PASS] %s\n", msg); } \
    else { fprintf(stderr, "[FAIL] %s\n", msg); failed++; } \
} while(0)

    CHECK(tree->root_count == 2, "root_count == 2");

    Skill* rootA = tree_find_by_id(tree, "id-root-a");
    CHECK(rootA != NULL,                             "find 루트A");
    CHECK(rootA && rootA->child_count == 1,          "루트A child_count == 1");
    CHECK(rootA && rootA->children[0] &&
          strcmp(rootA->children[0]->name, "자식A1") == 0, "children[0] == 자식A1");

    CHECK(get_damage_at_level(rootA, 1)  == 100.0f,  "damage lv1");
    CHECK(get_damage_at_level(rootA, 3)  == 300.0f,  "damage lv3");
    CHECK(get_damage_at_level(rootA, 99) == 300.0f,  "damage lv99(범위초과)");

    CharacterStats cs = {0};
    cs.char_level = 115; cs.mastery_contract = 1;
    CHECK(get_effective_char_level(&cs) == 120, "effective_char_level == 120");

    char buf[32];
    format_pct(buf, sizeof(buf), 1234567.4f);
    CHECK(strcmp(buf, "1,234,567%") == 0, "format_pct 1,234,567%");
    format_pct(buf, sizeof(buf), 0.0f);
    CHECK(strcmp(buf, "0%") == 0,         "format_pct 0%");
    format_pct(buf, sizeof(buf), 999.0f);
    CHECK(strcmp(buf, "999%") == 0,       "format_pct 999%");

    /* M3 스모크 테스트: 30초 시뮬레이션 */
    cs.attack_power = 100.0f; /* 데미지 = damage_per_level% × 100 */
    SimulationResult result;
    run_simulation(tree, &cs, 30.0f, &result);
    CHECK(result.total_damage > 0.0f, "M3: total_damage > 0");
    CHECK(result.event_count > 0,     "M3: event_count > 0");
    CHECK(result.stat_count > 0,      "M3: stat_count > 0");

    /* 루트B (cooldown=5s, cast=0, dmg=999%): 30초/5초 = 6회 */
    int rootb_uses = 0;
    int rootb_idx  = -1;
    for (int i = 0; i < tree->count; i++) {
        if (strcmp(tree->skills[i].skill_id, "id-root-b") == 0) { rootb_idx = i; break; }
    }
    if (rootb_idx >= 0) {
        for (int i = 0; i < result.stat_count; i++) {
            if (result.stats[i].skill_idx == rootb_idx) { rootb_uses = result.stats[i].use_count; break; }
        }
    }
    CHECK(rootb_uses == 6, "M3: 루트B 30초 6회 사용");

#undef CHECK

    tree_free(tree);
    printf("\n%s (%d 실패)\n", failed == 0 ? "ALL PASS" : "SOME FAILED", failed);
    return failed > 0 ? 1 : 0;
}

/* ── JSON stdin/stdout 모드 (M4: 프로덕션 기본 모드) ────────────────── */
static int cmd_json_io(void) {
    SimulationInput input;
    if (!parse_simulation_input(&input)) return 1;

    /* tree_build가 skills 소유권을 가져감 → 이후 input.skills 직접 해제 금지 */
    SkillTree* tree = tree_build(input.skills, input.skill_count);
    if (!tree) {
        /* tree_build 실패 시 skills가 미해제 상태 → 여기서 해제 */
        free(input.skills);
        print_error_json("invalid_input", "field", "skills");
        return 1;
    }
    input.skills = NULL; /* 소유권 이전 완료, double-free 방지 */

    prepare_auto_levels(tree, &input.character);

    SpAllocResult sp_result;
    SpAllocResult* sp_ptr = NULL;

    OptResult opt_result;
    OptResult* opt_ptr = NULL;

    if (input.auto_optimize) {
        if (input.character.total_sp > 0) {
            allocate_sp(tree, &input.character, &sp_result);
            sp_ptr = &sp_result;
        }
        optimize_bloom_enhancement(tree, &input.character, &opt_result);
        opt_ptr = &opt_result;
    }

    SimulationResult result;
    run_simulation(tree, &input.character, input.simulation_duration, &result);

    print_simulation_result(&result, tree, opt_ptr, sp_ptr);

    tree_free(tree);
    return 0;
}

/* ── 진입점 ──────────────────────────────────────────────────────────── */
int main(int argc, char* argv[]) {
    if (argc >= 2 && strcmp(argv[1], "--test") == 0) {
        return cmd_test();
    }
    if (argc >= 2 && strncmp(argv[1], "--list=", 7) == 0) {
        return cmd_list(argv[1] + 7);
    }
    if (argc >= 2 && strncmp(argv[1], "--simulate=", 11) == 0) {
        float dur = 60.0f;
        if (argc >= 3) dur = (float)atof(argv[2]);
        return cmd_simulate(argv[1] + 11, dur);
    }
    /* 기본 모드: stdin JSON → 시뮬레이션 → stdout JSON */
    return cmd_json_io();
}
