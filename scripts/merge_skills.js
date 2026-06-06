'use strict';

const fs   = require('fs');
const path = require('path');

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
 * enhancement_type 파싱.
 * enhancement 배열에서 type 1 / type 2 존재 여부로 판단.
 * type 2 우선 (공격력+38%+CDR15%), type 1 (공격력+55%), 없으면 0.
 */
function resolveEnhancementType(enhancement) {
  if (!Array.isArray(enhancement)) return 0;
  const types = new Set(enhancement.map(e => e.type));
  if (types.has(2)) return 2;
  if (types.has(1)) return 1;
  return 0;
}

/*
 * evolutionOverrides → bloomed_* 필드 변환.
 * bloom_type은 merge 단계에서는 0으로 초기화 (프론트가 선택).
 */
function resolveEvolution(manual) {
  const ev = manual.evolutionOverrides;
  if (!ev) {
    return { bloom_type: 0, bloomed_cast_time: 0, bloomed_damage_mult: 0, bloomed_cooldown: 0 };
  }
  /* evolutionOverrides 데이터는 보존, bloom_type은 0 (미선택 초기값) */
  return {
    bloom_type:          0,
    bloomed_cast_time:   0,
    bloomed_damage_mult: 0,
    bloomed_cooldown:    0,
    evolution_options:   ev   /* 프론트/C 코어가 참조할 개화 선택지 */
  };
}

/* level_mode 문자열 → 정수 열거값 (JSON 포맷) */
function levelModeStr(mode) {
  return mode ?? 'sp';
}

function main() {
  const { jobGrowId } = parseArgs();
  if (!jobGrowId) {
    console.error('Usage: node merge_skills.js --jobGrowId=<id>');
    process.exit(1);
  }

  const dir      = path.resolve(__dirname, '../data/skills');
  const baseFile = path.join(dir, `${jobGrowId}_base.json`);
  const manFile  = path.join(dir, `${jobGrowId}_manual.json`);

  if (!fs.existsSync(baseFile)) { console.error('base.json not found:', baseFile); process.exit(1); }
  if (!fs.existsSync(manFile))  { console.error('manual.json not found:', manFile); process.exit(1); }

  const baseArr   = JSON.parse(fs.readFileSync(baseFile, 'utf8'));
  const manualArr = JSON.parse(fs.readFileSync(manFile,  'utf8'));

  /* skillId → manual 맵 */
  const manMap = new Map(manualArr.map(m => [m.skillId, m]));

  const merged = [];
  const warnings = [];

  for (const base of baseArr) {
    const manual = manMap.get(base.skillId);
    if (!manual) {
      warnings.push(`SKIP (manual 없음): ${base.name} (${base.skillId})`);
      continue;
    }

    const masterLevel  = resolveMasterLevel(base, manual);
    const lv1Entry     = base.levelData.find(d => d.level === 1) ?? base.levelData[0] ?? {};
    const damageSrcs   = manual.damageSources ?? [];

    /* damage_per_level 계산 (active 스킬만, passive는 빈 배열) */
    let damagePerLevel = [];
    if (base.type === 'active' && damageSrcs.length > 0) {
      damagePerLevel = buildDamagePerLevel(base.levelData, damageSrcs, masterLevel);
    }

    const evFields = resolveEvolution(manual);

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
      level_mode:           levelModeStr(manual.levelMode),

      /* 데미지 배열 (레벨 1~master_level, 인덱스 0 = lv1) */
      damage_per_level:     damagePerLevel,

      /* 타이밍 */
      base_cooldown:        lv1Entry.coolTime ?? 0,
      cast_time:            manual.castTime ?? 0,

      /* 강화 */
      enhancement_type:     resolveEnhancementType(base.enhancement),

      /* 개화 */
      ...evFields,

      /* 선행 스킬 */
      pre_required_skill_id: base.preRequiredSkill?.skillId ?? '',
      parent_id:             -1
    };

    merged.push(entry);
  }

  const outFile = path.join(dir, `${jobGrowId}_merged.json`);
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

  const noEvol = merged.filter(s => s.evolution_options &&
    Object.values(s.evolution_options).some(v => v.castTime === null && v.damageMult === null && v.coolTime === null));
  if (noEvol.length > 0) {
    console.log('\n⚠  evolutionOverrides 미입력 스킬:');
    for (const s of noEvol) console.log(`   - ${s.name}`);
  }
}

main();
