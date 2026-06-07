#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "tree.h"

SkillTree* tree_build(Skill* skills, int count) {
    if (!skills || count <= 0) {
        fprintf(stderr, "[tree] tree_build: skills가 NULL이거나 count <= 0\n");
        return NULL;
    }

    /* children[] 초기화 — JSON 파서가 설정하지 않았을 수 있으므로 여기서 보장 */
    for (int i = 0; i < count; i++) {
        skills[i].child_count = 0;
        for (int j = 0; j < MAX_CHILDREN; j++) {
            skills[i].children[j] = NULL;
        }
    }

    /* parent_id를 기준으로 children[] 포인터 연결 */
    for (int i = 0; i < count; i++) {
        int pid = skills[i].parent_id;
        if (pid < 0) continue; /* 루트 스킬 */

        if (pid >= count) {
            fprintf(stderr, "[tree] 경고: %s의 parent_id(%d)가 범위 초과 — 루트로 처리\n",
                    skills[i].name, pid);
            skills[i].parent_id = -1;
            continue;
        }

        Skill* parent = &skills[pid];
        if (parent->child_count >= MAX_CHILDREN) {
            fprintf(stderr, "[tree] 경고: %s의 자식 수가 MAX_CHILDREN(%d) 초과 — 무시\n",
                    parent->name, MAX_CHILDREN);
            continue;
        }
        parent->children[parent->child_count++] = &skills[i];
    }

    /* 루트 수집 */
    int root_count = 0;
    for (int i = 0; i < count; i++) {
        if (skills[i].parent_id == -1) root_count++;
    }

    Skill** roots = malloc((size_t)root_count * sizeof(Skill*));
    if (!roots) {
        fprintf(stderr, "[tree] tree_build: roots 할당 실패\n");
        return NULL;
    }
    int ri = 0;
    for (int i = 0; i < count; i++) {
        if (skills[i].parent_id == -1) roots[ri++] = &skills[i];
    }

    SkillTree* tree = malloc(sizeof(SkillTree));
    if (!tree) {
        fprintf(stderr, "[tree] tree_build: SkillTree 할당 실패\n");
        free(roots);
        return NULL;
    }
    tree->skills     = skills;
    tree->count      = count;
    tree->roots      = roots;
    tree->root_count = root_count;
    return tree;
}

void tree_free(SkillTree* tree) {
    if (!tree) return;
    free(tree->roots);
    free(tree->skills);
    free(tree);
}

Skill* tree_find_by_id(const SkillTree* tree, const char* skill_id) {
    if (!tree || !skill_id) return NULL;
    for (int i = 0; i < tree->count; i++) {
        if (strcmp(tree->skills[i].skill_id, skill_id) == 0)
            return &tree->skills[i];
    }
    return NULL;
}
