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

/* 레벨 모드 자동 판별 */
function detectLevelMode(skill) {
  if (skill.name === '기본기 숙련') return 'auto_char';
  // 각성기 패턴: requiredLevelRange=5, maxLevel=50, active
  if (skill.type === 'active' && skill.requiredLevelRange === 5 && skill.maxLevel === 50) {
    // 진각성기: requiredLevel >= 95 → SP 스킬 (sp_cost_lv1 별도 입력 필요)
    if (skill.requiredLevel >= 95) return 'sp';
    // 1차/2차 각성기: 캐릭터 레벨 연동 자동습득
    return 'auto_every5';
  }
  return 'sp';
}

/* masterLevelOverride: maxLevel이 10 이하면 same_as_max */
function detectMasterOverride(skill) {
  if (skill.maxLevel <= 10) return 'same_as_max';
  return null;
}

/*
 * optionDesc를 "[header]" 기준으로 블록 분리.
 * 반환: [{ header: string|null, text: string }, ...]
 */
function splitBlocks(optionDesc) {
  const lines   = optionDesc.split('\n');
  const blocks  = [];
  let cur       = { header: null, lines: [] };

  for (const line of lines) {
    const m = line.trim().match(/^\[([^\]]+)\]$/);
    if (m) {
      blocks.push(cur);
      cur = { header: m[1], lines: [] };
    } else {
      cur.lines.push(line);
    }
  }
  blocks.push(cur);
  return blocks;
}

/*
 * 블록 헤더를 보고 포함 여부 결정.
 *
 * 포함:
 *   - 헤더 없음 (기본 블록)
 *   - "[X 공격력]" 형태 (데미지 섹션 헤더)
 *   - "[X 상태...]", "[X 공격시]", "[X 시전 시]" (상태이상 조건 → 최적 상황 가정)
 *   - "[X 습득 시]" / "[X 전직 시]" 에서 X가 같은 직업의 스킬명
 *
 * 제외:
 *   - "[범위 정보]" 등 수치 아님
 *   - "[X 습득 시]" / "[X 전직 시]" 에서 X가 다른 직업 스킬
 */
function shouldInclude(header, skillNameSet) {
  if (header === null)               return true;
  if (header.includes('범위 정보')) return false;

  // 데미지 섹션 헤더: "[N연속 베기 공격력]" 등
  if (header.includes('공격력') && !header.includes('습득')) return true;

  // 스킬 습득/전직 조건
  const skillCond = header.match(/^(.+?)\s+(?:습득|전직)\s+시$/);
  if (skillCond) {
    return skillNameSet.has(skillCond[1].trim());
  }

  // 상태이상/상황 조건 → 포함 (최적 상황 가정)
  if (/상태|공격\s*시|시전\s*시/.test(header)) return true;

  // 그 외 알 수 없는 헤더 → 포함 (보수적)
  return true;
}

/*
 * 한 블록의 텍스트에서 데미지 valueKey / hitKey 추출.
 *
 * 전략:
 *   1차) 접두어 타입 매칭: "내려찍기 공격력 : {v1}" + "내려찍기 다단히트 횟수 : {v2}회"
 *        → 같은 접두어끼리 짝지어 hitKey 할당 (역순 배치 오류 해결)
 *   2차) 순차 매칭: "히트수 : {v1}회" (무접두어) → 다음 공격력의 pendingHitKey
 *        → 접두어 타입 매칭으로 hitKey를 못 찾은 데미지에 순차 적용
 */
function extractDamage(blockText, headerLabel) {
  const segments = blockText.split(/\s*[\/\n]\s*/).map(s => s.trim()).filter(Boolean);
  const label    = headerLabel ? `[${headerLabel}] ` : '';

  // 1차 패스: 접두어 타입별 횟수 맵 구축
  // "X 다단히트 횟수 : {v}회", "X 횟수 : {v}회" → typedHits["X"] = "v"
  const HIT_TYPED = /^(.+?)\s+(?:다단히트\s*)?횟수\s*:\s*\{(value\d+)\}\s*회/;
  const typedHits = new Map();
  for (const seg of segments) {
    const m = seg.match(HIT_TYPED);
    if (m) typedHits.set(m[1].trim(), m[2]);
  }

  // 2차 패스: 데미지 추출 + hitKey 할당
  const sources      = [];
  let   pendingHitKey = null; // 무접두어 순차 hitKey

  for (const seg of segments) {
    // 무접두어 히트수 → pendingHitKey 세팅
    if (/^히트\s*수\s*:\s*\{(value\d+)\}\s*회/.test(seg)) {
      pendingHitKey = seg.match(/\{(value\d+)\}/)[1];
      continue;
    }
    // 접두어 횟수는 이미 typedHits에 등록 → 건너뜀
    if (HIT_TYPED.test(seg)) continue;

    const mkComment = () => (label + seg).replace(/\s+/g, ' ').slice(0, 100);

    // 접두어 데미지: "X 공격력 : {v}" (증가·감소 제외)
    const dmgTyped = seg.match(/^(.+?)\s+공격력(?!\s*[증감])\s*:\s*\{(value\d+)\}/);
    if (dmgTyped) {
      const type = dmgTyped[1].trim();
      // 접두어 타입으로 횟수 찾기; 없으면 순차 pendingHitKey 사용
      let hitKey = typedHits.get(type) ?? null;
      if (hitKey === null && pendingHitKey !== null) {
        hitKey = pendingHitKey;
        pendingHitKey = null;
      }
      sources.push({ valueKey: dmgTyped[2], hitKey, comment: mkComment() });
      continue;
    }

    // 무접두어 데미지: "공격력 : {v}"
    const dmgUntyped = seg.match(/^공격력(?!\s*[증감])\s*:\s*\{(value\d+)\}/);
    if (dmgUntyped) {
      sources.push({ valueKey: dmgUntyped[1], hitKey: pendingHitKey ?? null, comment: mkComment() });
      pendingHitKey = null;
      continue;
    }

    // 대체 데미지: "베기/타격/충격파/폭발/피니시 : {v}%"
    const dmgAlt = seg.match(/^(베기|타격|충격파|폭발|피니시)\s*:\s*\{(value\d+)\}\s*%/);
    if (dmgAlt) {
      const type   = dmgAlt[1];
      let   hitKey = typedHits.get(type) ?? null;
      if (hitKey === null && pendingHitKey !== null) {
        hitKey = pendingHitKey;
        pendingHitKey = null;
      }
      sources.push({ valueKey: dmgAlt[2], hitKey, comment: mkComment() });
    }
  }

  return sources;
}

/* optionDesc 전체를 블록별로 파싱 */
function parseDamageSources(optionDesc, skillNameSet) {
  if (!optionDesc) return [];

  const sources = [];
  for (const block of splitBlocks(optionDesc)) {
    if (!shouldInclude(block.header, skillNameSet)) continue;
    const text = block.lines.join('\n');
    sources.push(...extractDamage(text, block.header));
  }
  return sources;
}

function main() {
  const args = parseArgs();
  const { jobGrowId } = args;
  if (!jobGrowId) {
    console.error('Usage: node gen_manual_template.js --jobGrowId=<id> [--force]');
    process.exit(1);
  }

  const baseFile   = path.resolve(__dirname, `../data/skills/${jobGrowId}_base.json`);
  const data       = JSON.parse(fs.readFileSync(baseFile, 'utf8'));
  const skillNames = new Set(data.map(s => s.name));

  /* 공통 스킬 로드: 신규 직업 manual 생성 시 자동 적용 */
  const commonFile = path.resolve(__dirname, 'common_skills.json');
  const commonMap  = fs.existsSync(commonFile)
    ? new Map(JSON.parse(fs.readFileSync(commonFile, 'utf8')).map(e => [e.name, e]))
    : new Map();

  const outDir  = path.resolve(__dirname, '../data/skills');
  const outFile = path.join(outDir, `${jobGrowId}_manual.json`);

  /* 기존 manual.json 로드 (없거나 --force이면 null) */
  let existing = null;
  if (!args.force && fs.existsSync(outFile)) {
    existing = new Map(JSON.parse(fs.readFileSync(outFile, 'utf8')).map(e => [e.skillId, e]));
    console.log('기존 manual.json 감지 — 수동 편집 필드 보존 (--force로 초기화 가능)\n');
  }

  const manual = data.map(skill => {
    const levelMode = detectLevelMode(skill);
    const isSpMode  = levelMode === 'sp' || levelMode === 'auto_lv1_sp';

    const lv1Data   = skill.levelData[0] ?? {};
    const castTime  = lv1Data.castingTime ?? 0.0;

    /* 신규 템플릿 (자동 생성 기본값) */
    const fresh = {
      skillId:  skill.skillId,
      name:     skill.name,
      levelMode,
      castTime,
      damageSources: skill.type !== 'active' ? [] : parseDamageSources(skill.optionDesc, skillNames)
    };
    if (isSpMode) fresh.spCostPerLevel = 1;
    fresh.masterLevelOverride = detectMasterOverride(skill);

    /* evolutionOverrides 골격 (comment는 항상 최신 descDetail 기준으로 갱신) */
    if (Array.isArray(skill.evolution) && skill.evolution.length > 0) {
      fresh.evolutionOverrides = {};
      for (const ev of skill.evolution) {
        const detail  = (ev.descDetail ?? ev.desc ?? '').replace(/\n/g, ' | ');
        const comment = `${ev.name}: ${detail}`;
        const key     = String(ev.type);
        /* 기존 값(castTime/damageMult/coolTime)이 있으면 보존, comment만 갱신 */
        const prev = existing?.get(skill.skillId)?.evolutionOverrides?.[key];
        fresh.evolutionOverrides[key] = {
          castTime:   prev?.castTime   ?? null,
          damageMult: prev?.damageMult ?? null,
          coolTime:   prev?.coolTime   ?? null,
          comment
        };
      }
    }

    /* 기존 manual.json이 있으면 수동 편집 필드 보존 */
    if (existing?.has(skill.skillId)) {
      const prev = existing.get(skill.skillId);
      return {
        ...fresh,
        castTime:            prev.castTime            ?? fresh.castTime,
        damageSources:       prev.damageSources       ?? fresh.damageSources,
        spCostPerLevel:      prev.spCostPerLevel      ?? fresh.spCostPerLevel,
        ...(prev.spCostLv1 != null ? { spCostLv1: prev.spCostLv1 } : {}),
        masterLevelOverride: prev.masterLevelOverride ?? fresh.masterLevelOverride,
        /* evolutionOverrides는 위에서 이미 처리 */
        ...(fresh.evolutionOverrides ? { evolutionOverrides: fresh.evolutionOverrides } : {})
      };
    }

    /* 공통 스킬이면 common_skills.json 기본값 적용 */
    if (commonMap.has(skill.name)) {
      const common = commonMap.get(skill.name);
      return {
        skillId:  fresh.skillId,
        name:     fresh.name,
        levelMode:           common.levelMode,
        castTime:            common.castTime,
        damageSources:       common.damageSources,
        ...(common.spCostPerLevel != null ? { spCostPerLevel: common.spCostPerLevel } : {}),
        masterLevelOverride: common.masterLevelOverride
      };
    }

    /* 진각성기: sp_cost_lv1 플레이스홀더 추가 */
    if (fresh.levelMode === 'sp' && skill.requiredLevelRange === 5 && skill.maxLevel === 50) {
      fresh.spCostLv1     = 0;   /* 인게임 확인 후 입력 */
      fresh.spCostPerLevel = 0;  /* 인게임 확인 후 입력 */
    }

    return fresh;
  });

  fs.writeFileSync(outFile, JSON.stringify(manual, null, 2), 'utf8');
  console.log(`Generated → ${outFile}  (${manual.length} entries)\n`);

  /* 검토 필요 항목 리포트 */
  const noSrc = manual.filter(e => {
    const s = data.find(s => s.skillId === e.skillId);
    return s?.type === 'active' && e.damageSources.length === 0;
  });
  if (noSrc.length > 0) {
    console.log('⚠  데미지 소스 미감지 (active, manual 검토 필요):');
    for (const e of noSrc) {
      const s = data.find(s => s.skillId === e.skillId);
      console.log(`   - ${s.name}  optionDesc: ${(s.optionDesc ?? '').slice(0, 80)}`);
    }
    console.log();
  }

  const withEvol = manual.filter(e => e.evolutionOverrides);
  if (withEvol.length > 0) {
    console.log('⚠  evolutionOverrides 수치 입력 필요:');
    for (const e of withEvol) {
      const s = data.find(s => s.skillId === e.skillId);
      console.log(`   - ${s.name}`);
    }
  }
}

main();
