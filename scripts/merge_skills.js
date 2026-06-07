'use strict';

const fs   = require('fs');
const path = require('path');

/* 만렙(115) + 달인의 계약(+5) 기준 유효 캐릭터 레벨 */
const EFF_MAX_LV = 120;

function parseArgs() {
  const args = {};
  for (const arg of process.argv.slice(2)) {
    const m = arg.match(/^--(\w+)=(.+)$/);
    if (m) args[m[1]] = m[2];
  }
  return args;
}

/* "-" 또는 숫자가 아닌 값 → null 처리 */
function numOrNull(v) {
  if (v === null || v === undefined || v === '-' || v === '') return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

/* master_level 확정 */
function resolveMasterLevel(base, manual) {
  const apiMax = base.maxLevel;
  const ov     = manual.masterLevelOverride;
  if (ov === 'same_as_max') return apiMax;
  if (typeof ov === 'number') return ov;
  return Math.max(1, apiMax - 10);
}

/*
 * 스킬 레벨 L에서 단일 damageSources 항목의 contribution 계산.
 *
 * contribution = optionValue[valueKey] × hit × damageMultiplier
 *   hit = optionValue[hitKey]  (hitKey 있고 값이 숫자인 경우)
 *       = src.hitCount         (hitCount 있는 경우)
 *       = 1                    (둘 다 없는 경우)
 *   optionValue[valueKey] = "-" → contribution = 0
 */
function contribution(src, optVal) {
  const raw = numOrNull(optVal[src.valueKey]);
  if (raw === null) return 0;

  let hit = 1;
  if (src.hitKey) {
    const hv = numOrNull(optVal[src.hitKey]);
    if (hv !== null) hit = hv;
  } else if (typeof src.hitCount === 'number') {
    hit = src.hitCount;
  }

  const mult = typeof src.damageMultiplier === 'number' ? src.damageMultiplier : 1.0;
  return raw * hit * mult;
}

/*
 * damage_per_level[] 배열 계산.
 * levelData는 전 레벨이 저장된 배열 (base.json의 levelData).
 * master_level 범위까지만 계산한다.
 */
function buildDamagePerLevel(levelData, damageSources, masterLevel) {
  /* level → optionValue 맵 구성 */
  const lvMap = new Map();
  for (const entry of levelData) {
    lvMap.set(entry.level, entry.optionValue ?? {});
  }

  const result = [];
  for (let lv = 1; lv <= masterLevel; lv++) {
    const optVal = lvMap.get(lv) ?? {};
    let total = 0;
    for (const src of damageSources) {
      total += contribution(src, optVal);
    }
    result.push(parseFloat(total.toFixed(4)));
  }
  return result;
}

/*
 * 강화 정보 해석.
 * manual.enhancementDisabled = true → can_enhance: false, 모든 수치 0.
 * 그 외: base.enhancement 배열에서 type별 공격력 % 실수치를 파싱해 저장.
 * enhancement_type은 항상 0 (유저/옵티마이저가 선택).
 *
 * 직업별로 강화 불가 스킬이 다를 수 있으므로 enhancementDisabled는
 * manual.json에서 수동으로 관리한다.
 */
function resolveEnhancement(base, manual) {
  const noEnh = { can_enhance: false, enhancement_type: 0,
                  enhancement_atk_1: 0, enhancement_atk_2: 0 };

  if (manual.enhancementDisabled) return noEnh;
  if (!Array.isArray(base.enhancement) || base.enhancement.length === 0) return noEnh;

  const parseAtk = (enh) => {
    const stat = enh?.status?.find(s => s.name.includes('공격력'));
    return stat ? parseFloat(stat.value) / 100 : 0;
  };

  const t1 = base.enhancement.find(e => e.type === 1);
  const t2 = base.enhancement.find(e => e.type === 2);
  const atk1 = parseAtk(t1);
  const atk2 = parseAtk(t2);

  if (atk1 === 0 && atk2 === 0) return noEnh;
  return { can_enhance: true, enhancement_type: 0, enhancement_atk_1: atk1, enhancement_atk_2: atk2 };
}

/*
 * evolutionOverrides → bloom_option_1 / bloom_option_2 변환.
 * bloom_type은 항상 0 (유저/옵티마이저가 선택).
 * 값이 null인 항목은 0으로 저장 (0 = "해당 속성 미변경"을 의미).
 */
function resolveEvolution(manual) {
  const noBloom = {
    can_evolve:    false,
    bloom_type:    0,
    bloom_option_1: { cast_time: 0, damage_mult: 0, cooldown: 0 },
    bloom_option_2: { cast_time: 0, damage_mult: 0, cooldown: 0 }
  };

  const ev = manual.evolutionOverrides;
  if (!ev) return noBloom;

  const opt = (key) => {
    const o = ev[key] ?? {};
    /* damageMult: 퍼센트 변화량 입력 (60 = +60% → ×1.6, -50 = -50% → ×0.5)
     * null이면 0 저장 → C 코어에서 "변화 없음(×1.0)"으로 해석 */
    const dm = o.damageMult;
    const damage_mult = (dm != null) ? 1.0 + dm / 100.0 : 0;
    /* coolTime: 절대값(초) 입력. null이면 0 → 변화 없음 */
    return {
      cast_time:   o.castTime ?? 0,
      damage_mult,
      cooldown:    o.coolTime ?? 0
    };
  };

  return {
    can_evolve:     true,
    bloom_type:     0,
    bloom_option_1: opt('1'),
    bloom_option_2: opt('2')
  };
}

/*
 * is_job_skill 결정.
 * manual.json에 isJobSkill boolean이 있으면 그것을 우선한다.
 * 없으면 required_level 기준 자동 분류:
 *   < 15 → 공통 스킬 (0)
 *   > 15 → 전직 스킬 (1)
 *   = 15 → 판단 불가, 경고 후 0 반환
 */
function resolveIsJobSkill(base, manual, warnings) {
  if (typeof manual.isJobSkill === 'boolean') return manual.isJobSkill ? 1 : 0;
  if (base.requiredLevel < 15) return 0;
  if (base.requiredLevel > 15) return 1;
  warnings.push(`is_job_skill 미지정 (requiredLevel=15): ${base.name} — manual.json에 "isJobSkill": true/false 추가 권장`);
  return 0;
}

/*
 * 패시브 보너스 목록 수집.
 * passiveSkillAtkBonus가 있는 스킬의 master_level 수치를 읽어
 * { scope, skillIds, bonusPct } 형태로 반환한다.
 */
function collectPassiveBonuses(baseArr, manMap) {
  const result = [];
  for (const base of baseArr) {
    const manual = manMap.get(base.skillId);
    if (!manual?.passiveSkillAtkBonus) continue;

    const pb = manual.passiveSkillAtkBonus;
    const ml = resolveMasterLevel(base, manual);
    const range = base.requiredLevelRange ?? 1;
    const charCap = Math.floor((EFF_MAX_LV - base.requiredLevel) / range) + 1;
    const investable = Math.min(ml, Math.max(0, charCap));
    if (investable <= 0) continue;

    const lvEntry = base.levelData.find(d => d.level === investable)
                 ?? base.levelData[base.levelData.length - 1];
    const bonusPct = numOrNull(lvEntry?.optionValue?.[pb.valueKey]);
    if (bonusPct === null) continue;

    result.push({
      scope:    pb.scope,       /* 'all' | 'advanced_class' | 'skill_list' */
      skillIds: pb.skillIds ?? [],
      bonusPct                  /* 예: 30 → +30% */
    });
  }
  return result;
}

/*
 * 단일 스킬에 대한 passive_mult 계산.
 * passive_mult = ∏(1 + bonusPct_i / 100)  (적용 대상 패시브만)
 */
function computePassiveMult(skillId, isJobSkill, passiveBonuses) {
  let mult = 1.0;
  for (const pb of passiveBonuses) {
    let applies = false;
    if (pb.scope === 'all') {
      applies = true;
    } else if (pb.scope === 'advanced_class') {
      applies = isJobSkill === 1;
    } else if (pb.scope === 'skill_list') {
      applies = pb.skillIds.includes(skillId);
    }
    if (applies) mult *= 1 + pb.bonusPct / 100;
  }
  return parseFloat(mult.toFixed(6));
}

/* level_mode 문자열 → 정수 열거값 (JSON 포맷) */
function levelModeStr(mode) {
  return mode ?? 'sp';
}

function main() {
  const { jobId, jobGrowId } = parseArgs();
  if (!jobId || !jobGrowId) {
    console.error('Usage: node merge_skills.js --jobId=<id> --jobGrowId=<id>');
    process.exit(1);
  }

  const dataKey  = `${jobId}_${jobGrowId}`;
  const dir      = path.resolve(__dirname, '../data/skills');
  const baseFile = path.join(dir, `${jobGrowId}_base.json`);
  const manFile  = path.join(dir, `${jobGrowId}_manual.json`);

  if (!fs.existsSync(baseFile)) { console.error('base.json not found:', baseFile); process.exit(1); }
  if (!fs.existsSync(manFile))  { console.error('manual.json not found:', manFile); process.exit(1); }

  const baseArr   = JSON.parse(fs.readFileSync(baseFile, 'utf8'));
  const manualArr = JSON.parse(fs.readFileSync(manFile,  'utf8'));

  /* skillId → manual 맵 */
  const manMap = new Map(manualArr.map(m => [m.skillId, m]));

  /* 패시브 보너스 목록 (passive_mult 계산에 사용) */
  const passiveBonuses = collectPassiveBonuses(baseArr, manMap);

  const merged = [];
  const warnings = [];

  for (const base of baseArr) {
    const manual = manMap.get(base.skillId);
    if (!manual) {
      warnings.push(`SKIP (manual 없음): ${base.name} (${base.skillId})`);
      continue;
    }

    const masterLevel  = resolveMasterLevel(base, manual);
    const isJobSkill   = resolveIsJobSkill(base, manual, warnings);
    const lv1Entry     = base.levelData.find(d => d.level === 1) ?? base.levelData[0] ?? {};
    const damageSrcs   = manual.damageSources ?? [];

    /* damage_per_level 계산 (active 스킬만, passive는 빈 배열) */
    let damagePerLevel = [];
    if (base.type === 'active' && damageSrcs.length > 0) {
      damagePerLevel = buildDamagePerLevel(base.levelData, damageSrcs, masterLevel);
    }

    const evFields  = resolveEvolution(manual);
    const enhFields = resolveEnhancement(base, manual);

    const entry = {
      skill_id:             base.skillId,
      name:                 base.name,
      type:                 base.type,

      /* 레벨 제한 */
      required_level:       base.requiredLevel,
      required_level_range: base.requiredLevelRange ?? 1,
      api_max_level:        base.maxLevel,
      master_level:         masterLevel,
      current_level:        0,
      sp_cost_per_level:    manual.spCostPerLevel ?? 0,
      must_master:          manual.mustMaster ? 1 : 0,
      is_job_skill:         isJobSkill,
      level_mode:           levelModeStr(manual.levelMode),

      /* 데미지 배열 (레벨 1~master_level, 인덱스 0 = lv1) */
      damage_per_level:     damagePerLevel,
      passive_mult:         base.type === 'active'
                              ? computePassiveMult(base.skillId, isJobSkill, passiveBonuses)
                              : 1.0,

      /* 타이밍 */
      base_cooldown:        lv1Entry.coolTime ?? 0,
      cast_time:            manual.castTime ?? 0,
      sp_cost_lv1:          manual.spCostLv1 ?? 0,

      /* 강화: can_enhance / enhancement_type(0=미적용) / 실수치 배율 */
      ...enhFields,

      /* 개화: can_evolve / bloom_type(0=미선택) / 선택지 */
      ...evFields,

      /* 선행 스킬 */
      pre_required_skill_id: base.preRequiredSkill?.[0]?.skillId ?? '',
      parent_id:             -1
    };

    merged.push(entry);
  }

  const outFile = path.join(dir, `${dataKey}_merged.json`);
  fs.writeFileSync(outFile, JSON.stringify(merged, null, 2), 'utf8');
  console.log(`Merged → ${outFile}  (${merged.length} skills)`);

  if (warnings.length > 0) {
    console.log('\n⚠  경고:');
    for (const w of warnings) console.log('   -', w);
  }

  /* 검증 리포트 */
  const active = merged.filter(s => s.type === 'active');
  const noDmg  = active.filter(s => s.damage_per_level.length === 0);
  if (noDmg.length > 0) {
    console.log('\n⚠  damage_per_level 비어있는 active 스킬 (damageSources 확인 필요):');
    for (const s of noDmg) console.log(`   - ${s.name}`);
  }

  const noEvol = merged.filter(s => s.can_evolve &&
    s.bloom_option_1.cast_time === 0 && s.bloom_option_1.damage_mult === 0 && s.bloom_option_1.cooldown === 0 &&
    s.bloom_option_2.cast_time === 0 && s.bloom_option_2.damage_mult === 0 && s.bloom_option_2.cooldown === 0);
  if (noEvol.length > 0) {
    console.log('\n⚠  evolutionOverrides 미입력 스킬 (bloom_option 전부 0):');
    for (const s of noEvol) console.log(`   - ${s.name}`);
  }
}

main();
