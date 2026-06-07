#include <string.h>
#include <time.h>
#include "optimizer.h"
#include "skill.h"

/* 최대 탐색 버퍼 크기 */
#define MAX_EVOL_POOL 12
#define MAX_ENH_POOL  20

/* ── 평가 함수: 현재 tree 상태의 DPS 기대값 합산 ─────────────────────── */
static float quick_score(const SkillTree* tree, const CharacterStats* cs) {
    float total = 0.0f;
    for (int i = 0; i < tree->count; i++) {
        float p = get_priority(&tree->skills[i], cs);
        if (p > 0.0f) total += p;
    }
    return total;
}

/* ── 개화 재귀 탐색 ──────────────────────────────────────────────────── */
/*
 * start: evol_pool에서 다음에 고려할 시작 인덱스
 * chosen: 현재까지 선택된 개화 수
 * best_score / best_evol_*: 최고 결과 누적
 */
static void evol_recurse(SkillTree*          tree,
                         const CharacterStats* cs,
                         const int*          evol_pool,
                         int                 n_evol,
                         int                 start,
                         int                 chosen,
                         float*              best_score,
                         int*                best_idx,
                         int*                best_type,
                         int*                best_count)
{
    /* 현재 상태 평가 */
    float s = quick_score(tree, cs);
    if (s > *best_score) {
        *best_score  = s;
        *best_count  = chosen;
        /* 현재 tree에서 선택된 개화 스킬을 best에 저장 */
        int k = 0;
        for (int i = 0; i < n_evol && k < chosen; i++) {
            int bt = tree->skills[evol_pool[i]].bloom_type;
            if (bt != 0) { best_idx[k] = evol_pool[i]; best_type[k] = bt; k++; }
        }
    }

    if (chosen >= MAX_EVOLUTIONS) return;

    /* 추가 스킬 선택 시도 */
    for (int i = start; i < n_evol; i++) {
        Skill* sk = &tree->skills[evol_pool[i]];
        for (int t = 1; t <= 2; t++) {
            sk->bloom_type = t;
            evol_recurse(tree, cs, evol_pool, n_evol, i + 1, chosen + 1,
                         best_score, best_idx, best_type, best_count);
            sk->bloom_type = 0;
        }
    }
}

/* ── 강화 재귀 탐색 ──────────────────────────────────────────────────── */
static void enh_recurse(SkillTree*          tree,
                        const CharacterStats* cs,
                        const int*          enh_pool,
                        int                 n_enh,
                        int                 start,
                        int                 chosen,
                        float*              best_score,
                        int*                best_idx,
                        int*                best_type,
                        int*                best_count)
{
    float s = quick_score(tree, cs);
    if (s > *best_score) {
        *best_score = s;
        *best_count = chosen;
        int k = 0;
        for (int i = 0; i < n_enh && k < chosen; i++) {
            int et = tree->skills[enh_pool[i]].enhancement_type;
            if (et != 0) { best_idx[k] = enh_pool[i]; best_type[k] = et; k++; }
        }
    }

    if (chosen >= MAX_ENHANCEMENTS) return;

    for (int i = start; i < n_enh; i++) {
        Skill* sk = &tree->skills[enh_pool[i]];
        for (int t = 1; t <= 2; t++) {
            sk->enhancement_type = t;
            enh_recurse(tree, cs, enh_pool, n_enh, i + 1, chosen + 1,
                        best_score, best_idx, best_type, best_count);
            sk->enhancement_type = 0;
        }
    }
}

/* ── 메인 진입: 2-Phase 최적화 ──────────────────────────────────────── */
void optimize_bloom_enhancement(SkillTree* tree, const CharacterStats* cs, OptResult* out) {
    memset(out, 0, sizeof(*out));

    clock_t t_start = clock();

    /* ── 후보 풀 수집 ─────────────────────────────────────────────────── */
    int evol_pool[MAX_EVOL_POOL], n_evol = 0;
    int enh_pool[MAX_ENH_POOL],   n_enh  = 0;

    for (int i = 0; i < tree->count; i++) {
        const Skill* s = &tree->skills[i];
        if (s->current_level <= 0) continue;
        if (s->can_evolve  && n_evol < MAX_EVOL_POOL) evol_pool[n_evol++] = i;
        if (s->can_enhance && n_enh  < MAX_ENH_POOL)  enh_pool[n_enh++]  = i;
    }

    /* ── Phase 1: 개화 최적화 ────────────────────────────────────────── */
    /* 시작 전 모든 개화/강화 초기화 */
    for (int i = 0; i < tree->count; i++) {
        tree->skills[i].bloom_type       = 0;
        tree->skills[i].enhancement_type = 0;
    }

    float best_evol_score = -1.0f;
    int   best_evol_idx[MAX_EVOLUTIONS]  = {0};
    int   best_evol_type[MAX_EVOLUTIONS] = {0};
    int   best_evol_count = 0;

    evol_recurse(tree, cs, evol_pool, n_evol, 0, 0,
                 &best_evol_score, best_evol_idx, best_evol_type, &best_evol_count);

    /* 최적 개화 적용 */
    for (int i = 0; i < tree->count; i++) tree->skills[i].bloom_type = 0;
    for (int k = 0; k < best_evol_count; k++)
        tree->skills[best_evol_idx[k]].bloom_type = best_evol_type[k];

    /* ── Phase 2: 강화 최적화 (최적 개화 고정 상태) ─────────────────── */
    float best_enh_score = -1.0f;
    int   best_enh_idx[MAX_ENHANCEMENTS]  = {0};
    int   best_enh_type[MAX_ENHANCEMENTS] = {0};
    int   best_enh_count = 0;

    enh_recurse(tree, cs, enh_pool, n_enh, 0, 0,
                &best_enh_score, best_enh_idx, best_enh_type, &best_enh_count);

    /* 최적 강화 적용 */
    for (int i = 0; i < tree->count; i++) tree->skills[i].enhancement_type = 0;
    for (int k = 0; k < best_enh_count; k++)
        tree->skills[best_enh_idx[k]].enhancement_type = best_enh_type[k];

    /* ── 결과 저장 ────────────────────────────────────────────────────── */
    out->evol_count = best_evol_count;
    for (int k = 0; k < best_evol_count; k++) {
        out->evol_skill_idx[k]  = best_evol_idx[k];
        out->evol_bloom_type[k] = best_evol_type[k];
    }

    out->enh_count = best_enh_count;
    for (int k = 0; k < best_enh_count; k++) {
        out->enh_skill_idx[k] = best_enh_idx[k];
        out->enh_type[k]      = best_enh_type[k];
    }

    out->score      = best_enh_score;
    out->elapsed_ms = (float)(clock() - t_start) / (float)CLOCKS_PER_SEC * 1000.0f;
}
