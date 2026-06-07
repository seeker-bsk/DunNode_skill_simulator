#ifndef TREE_H
#define TREE_H

#include "skill.h"

/* ── SkillTree 구조체 ────────────────────────────────────────────────── */
/*
 * skills: 전체 스킬의 연속 배열 (tree가 소유, tree_free로 해제)
 * roots : parent_id == -1인 스킬 포인터 배열 (tree가 소유)
 *
 * 부모-자식 포인터(children[])는 tree_build 호출 시 skills 배열 내부를
 * 가리키도록 설정된다. skills 배열이 이동하면 포인터가 무효화되므로
 * tree_build 이후 skills를 realloc 하면 안 된다.
 */
typedef struct SkillTree {
    Skill*  skills;
    int     count;
    Skill** roots;
    int     root_count;
} SkillTree;

/*
 * tree_build: 미리 할당된 skills 배열로부터 트리를 구성한다.
 *   - 각 Skill의 parent_id를 기준으로 children[] 포인터를 연결한다.
 *   - skills 배열의 소유권이 tree로 이전된다 (tree_free가 해제).
 *   - 실패 시 NULL 반환 (stderr에 에러 메시지 출력).
 */
SkillTree* tree_build(Skill* skills, int count);

/* tree_free: tree 및 소유 중인 모든 메모리를 해제한다. */
void tree_free(SkillTree* tree);

/* tree_find_by_id: skill_id로 스킬을 찾아 반환한다. 없으면 NULL. */
Skill* tree_find_by_id(const SkillTree* tree, const char* skill_id);

#endif /* TREE_H */
