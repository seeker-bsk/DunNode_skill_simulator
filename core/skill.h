#ifndef SKILL_H
#define SKILL_H

/* ── 전역 상수 ───────────────────────────────────────────────────────── */
#define MAX_CHILDREN           8
#define MAX_MASTER_LEVEL      70   /* SP 투자 가능 상한의 절대 최댓값 (배열 크기) */
#define MASTERY_CONTRACT_BONUS 5   /* 달인의 계약: 유효 캐릭터 레벨 +5 */
#define MAX_CHAR_LEVEL        115  /* 만렙 */

/* ── SkillLevelMode ──────────────────────────────────────────────────── */
typedef enum {
    LEVEL_MODE_SP,           /* 모든 레벨 SP 소모 (일반 스킬) */
    LEVEL_MODE_AUTO_CHAR,    /* 캐릭터 레벨 1:1 연동, SP 없음 (기본기 숙련 등) */
    LEVEL_MODE_AUTO_EVERY5,  /* 캐릭터 5레벨당 스킬 1레벨, SP 없음 (각성기) */
    LEVEL_MODE_AUTO_LV1_SP   /* 1레벨 자동 습득, 2레벨부터 SP 소모 */
} SkillLevelMode;

/* ── Skill 구조체 ────────────────────────────────────────────────────── */
typedef struct Skill {
    char  skill_id[64];
    char  name[64];

    /* 레벨 제한 */
    int   required_level;        /* lv1 습득 최소 캐릭터 레벨 (달인의 계약 적용 전) */
    int   required_level_range;  /* 스킬 레벨당 캐릭터 레벨 증가폭 */
    int   api_max_level;         /* API maxLevel (아이템 포함 절대 상한, 참고용) */
    int   master_level;          /* SP 투자 가능 상한 */
    int   current_level;         /* 현재 스킬 레벨 (0: 미습득) */
    int   sp_cost_per_level;     /* 레벨당 SP 소모 (LEVEL_MODE_SP / AUTO_LV1_SP) */
    int   sp_cost_lv1;           /* lv1 습득 비용. 0이면 sp_cost_per_level과 동일 */
    int   must_master;           /* 1이면 SP 할당 시 최우선 마스터 */
    int   is_job_skill;          /* 1이면 전직 이후 고유 스킬 (advanced_class 패시브 보너스 적용 대상) */
    SkillLevelMode level_mode;

    /* 데미지 (공격력 100% 기준 %, 히트수 합산 완료)
     * damage_per_level[i] = 스킬 레벨 (i+1)의 총 데미지%
     * API 실수치 직접 저장 — 보간 없음 */
    int   level_count;                        /* = master_level (유효 배열 길이) */
    float damage_per_level[MAX_MASTER_LEVEL]; /* index 0 = lv1 */
    float passive_mult;                       /* 패시브 공격력 보너스 곱산 결과 ∏(1+bonus_i), 기본값 1.0 */

    /* 타이밍 */
    float base_cooldown; /* 쿨타임 (초), 레벨 무관 고정 */
    float cast_time;     /* 시전 시간 (초), 공격속도 영향 없음 */

    /* 스킬 강화
     * can_enhance      : 직업별 강화 가능 여부 (manual.json의 enhancementDisabled로 제어)
     * enhancement_type : 0=미적용 / 1=1강 / 2=2강  (유저/옵티마이저가 선택)
     * enhancement_atk_1: 1강 공격력 배율 실수치 (e.g. 0.60 → +60%)
     * enhancement_atk_2: 2강 공격력 배율 실수치 (e.g. 0.43 → +43%)
     * CDR +15%는 type 2에 항상 고정 */
    int   can_enhance;
    int   enhancement_type;
    float enhancement_atk_1;
    float enhancement_atk_2;

    /* 스킬 개화
     * can_evolve      : 개화 가능 여부
     * bloom_type      : 0=미선택 / 1=개화1 / 2=개화2  (유저/옵티마이저가 선택)
     * bloom_options[] : [0]=개화1 수치, [1]=개화2 수치
     *                   각 필드 값이 0이면 해당 속성은 기본값 유지 */
    int   can_evolve;
    int   bloom_type;

    struct BloomOption {
        float cast_time;    /* 0이면 미변경 */
        float damage_mult;  /* 0이면 미변경 (1.0이 아니라 0이 "미변경"임에 주의) */
        float cooldown;     /* 0이면 미변경 */
    } bloom_options[2];     /* [0]=개화1, [1]=개화2 */

    /* 트리 구조 */
    char           pre_required_skill_id[64]; /* 선행 스킬 ID (없으면 빈 문자열) */
    int            parent_id;                 /* 부모 인덱스, -1이면 루트 */
    struct Skill*  children[MAX_CHILDREN];
    int            child_count;
} Skill;

/* ── CharacterStats 구조체 ───────────────────────────────────────────── */
typedef struct CharacterStats {
    float attack_power;             /* 기본 공격력 */
    float cooldown_reduction;       /* 직접 쿨타임 감소 (0.0 ~ 0.70) */
    float cooldown_recovery_speed;  /* 쿨타임 회복 속도 (n%, 양수) */
    float attack_speed;             /* 공격속도 (100.0 ~ 200.0) */
    int   char_level;               /* 캐릭터 레벨 */
    int   mastery_contract;         /* 달인의 계약 (0/1) */
    int   total_sp;                 /* 총 보유 SP */
} CharacterStats;

/* ── 함수 선언 ───────────────────────────────────────────────────────── */

/* M1: 레벨/데미지 조회 */
int   get_effective_char_level(const CharacterStats* cs);
int   get_investable_max(const Skill* s, int eff_lv);
int   get_auto_every5_level(const Skill* s, int eff_lv);
float get_damage_at_level(const Skill* s, int level);

/* M2: 스킬 수치 계산 */

/* 최종 CDR: 직접 감소 + 회복 속도, 상한 70% */
float get_combined_cdr(const CharacterStats* cs);

/* 강화 배율: enhancement_type 0→1.0, 1→1+atk1, 2→1+atk2 */
float get_enhancement_mult(const Skill* s);

/* 강화 CDR 보너스: type2→0.15, 나머지→0.0 */
float get_enhancement_cdr(const Skill* s);

/* 최종 쿨타임 (개화 쿨타임 + CDR 적용, 하한 70% 감소) */
float get_final_cooldown(const Skill* s, float combined_cdr);

/* 시전 시간 (개화 우선, 공격속도 영향 없음) */
float get_cast_time(const Skill* s);

/* 스킬 우선순위: DPS 기준 높을수록 먼저 사용 */
float get_priority(const Skill* s, const CharacterStats* cs);

/* M2: 표시용 포맷
 * format_pct: 1234567.8 → "1,234,568%"  (소수점 이하 반올림)
 * buf 최소 크기: 32 바이트 권장 */
void format_pct(char* buf, int bufsize, float value);

#endif /* SKILL_H */
