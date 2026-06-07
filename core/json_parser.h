#ifndef JSON_PARSER_H
#define JSON_PARSER_H

#include "skill.h"
#include "simulator.h"
#include "optimizer.h"
#include "sp_allocator.h"

typedef struct {
    CharacterStats character;
    Skill*         skills;
    int            skill_count;
    float          simulation_duration;
    int            auto_optimize; /* 0=수동(입력 bloom/enhancement 사용) 1=자동 탐색 */
} SimulationInput;

/*
 * stdin에서 JSON을 읽어 SimulationInput을 채운다.
 * 실패 시 에러 JSON을 stdout에 출력하고 0 반환.
 * 성공 시 1 반환. out->skills는 호출자가 simulation_input_free()로 해제.
 */
int  parse_simulation_input(SimulationInput* out);

/* SimulationResult를 stdout에 JSON으로 출력.
 * opt / sp_alloc이 NULL이 아니면 optimization 블록도 함께 출력. */
void print_simulation_result(const SimulationResult* result,
                             const SkillTree*        tree,
                             const OptResult*        opt,
                             const SpAllocResult*    sp_alloc);

/* 에러 JSON stdout 출력. key/value는 추가 상세 필드 (NULL이면 생략) */
void print_error_json(const char* error_type,
                      const char* key, const char* value);

void simulation_input_free(SimulationInput* in);

#endif /* JSON_PARSER_H */
