#ifndef OPTIMIZER_H
#define OPTIMIZER_H

#include "skill.h"
#include "tree.h"

/* 개화 최대 선택 수 / 강화 최대 선택 수 */
#define MAX_EVOLUTIONS   5
#define MAX_ENHANCEMENTS 3

/* 탐색 결과 */
typedef struct {
    /* 선택된 개화 */
    int evol_skill_idx[MAX_EVOLUTIONS]; /* tree->skills[] 인덱스 */
    int evol_bloom_type[MAX_EVOLUTIONS];/* 1 or 2 */
    int evol_count;

    /* 선택된 강화 */
    int enh_skill_idx[MAX_ENHANCEMENTS]; /* tree->skills[] 인덱스 */
    int enh_type[MAX_ENHANCEMENTS];      /* 1 or 2 */
    int enh_count;

    float score;      /* quick_score 최고값 */
    float elapsed_ms; /* 탐색 소요 시간 */
} OptResult;

/*
 * tree의 스킬에 대해 최적 개화+강화 조합을 탐색한다.
 *
 * 알고리즘 (2-Phase):
 *   Phase 1: 개화 후보 (3^n_evol 재귀, ≤MAX_EVOLUTIONS 제약) → 최고 조합 선택
 *   Phase 2: Phase 1 결과 고정 후 강화 후보 (재귀, ≤MAX_ENHANCEMENTS 제약) → 최고 조합 선택
 *
 * 결과는 out에 저장되고, tree의 bloom_type / enhancement_type을 직접 변경한다.
 * (tree의 current_level이 이미 설정된 상태에서 호출)
 */
void optimize_bloom_enhancement(SkillTree* tree, const CharacterStats* cs, OptResult* out);

#endif /* OPTIMIZER_H */
