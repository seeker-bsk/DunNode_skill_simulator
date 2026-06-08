import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import SkillTooltip from './SkillTooltip';

/* ── 메인 그리드 레이아웃 상수 ─────────────────────────────── */
const NODE_W   = 104;
const NODE_H   = 138;  /* CSS min-height와 반드시 동일 */
const GAP_X    = 14;
const ROW_GAP  = 46;
const ROW_H    = NODE_H + ROW_GAP;
const PAD_X    = 56;   /* 좌측 레벨 레이블 공간 */
const PAD_Y    = 20;
const MAX_COLS = 5;

/* ── 선행 관계 패널 상수 ────────────────────────────────────── */
const CH_PAD_X    = 20;   /* 패널 좌우 내부 여백 */
const CH_PAD_Y    = 30;   /* 패널 상하 내부 여백 (레벨 레이블 공간 포함) */
const CH_LV_H     = 18;   /* 노드 위 레벨 레이블 높이 */
const CH_H_GAP    = 88;   /* 소스 ↔ 목적지 수평 간격 */
const CH_V_GAP    = 20;   /* 목적지 간 수직 간격 (같은 체인 내) */
const CH_GRP_PAD  = 44;   /* 체인 그룹 간 수직 여백 */
const CH_PANEL_W  = CH_PAD_X + NODE_W + CH_H_GAP + NODE_W + CH_PAD_X;
const CH_BUS_X    = CH_PAD_X + NODE_W + Math.round(CH_H_GAP / 2);

/* ── 아이콘 경로 헬퍼 ──────────────────────────────────────── */
function toIconName(name) {
  return name.replace(/ : /g, '_').replace(/ /g, '_');
}
function toIconJobFolder(jobName) {
  return jobName.replace(/^眞\s*/, '');
}
function buildIconUrls(skill, job) {
  if (!job) return [];
  const enc     = encodeURIComponent;
  const fname   = toIconName(skill.name);
  const charDir = enc(job.characterName);
  const jobDir  = enc(toIconJobFolder(job.jobName));
  const comDir  = enc(job.characterName + '공통');
  const base    = '/media/skill_icon';
  return [
    `${base}/${charDir}/${jobDir}/${fname}.webp`,
    `${base}/${charDir}/${jobDir}/${fname}.png`,
    `${base}/${charDir}/${comDir}/${fname}.webp`,
    `${base}/${charDir}/${comDir}/${fname}.png`,
    `${base}/공통/${fname}.webp`,
    `${base}/공통/${fname}.png`,
  ];
}

/* ── 공통 헬퍼 ─────────────────────────────────────────────── */
function getEffLv(stats) {
  return stats.char_level + (stats.mastery_contract ? 5 : 0);
}
function getInvestableMax(skill, effLv) {
  if (effLv < skill.required_level) return 0;
  const range  = skill.required_level_range || 1;
  const charCap = Math.floor((effLv - skill.required_level) / range) + 1;
  return Math.min(skill.master_level, Math.max(0, charCap));
}
function getAutoLevel(skill, effLv, charLv) {
  if (effLv < skill.required_level) return 0;
  if (skill.level_mode === 'auto_char')   return Math.min(charLv, skill.master_level);
  if (skill.level_mode === 'auto_every5') {
    return Math.min(Math.floor((effLv - skill.required_level) / 5) + 1, skill.master_level);
  }
  return skill.current_level;
}

/* ── 메인 그리드 레이아웃 ───────────────────────────────────── */
function computeLayout(skills) {
  const groups = new Map();
  for (const s of skills) {
    const k = s.required_level;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(s);
  }
  const sortedLevels = [...groups.keys()].sort((a, b) => a - b);
  const effectiveCols = Math.min(
    MAX_COLS,
    Math.max(...sortedLevels.map(lv => groups.get(lv).length), 1)
  );
  const totalW = effectiveCols * (NODE_W + GAP_X) - GAP_X + PAD_X * 2;

  const positions = {};
  const rowYMap   = {};
  let   visualRow = 0;

  sortedLevels.forEach(lv => {
    const group      = groups.get(lv);
    const numSubRows = Math.ceil(group.length / MAX_COLS);
    for (let sub = 0; sub < numSubRows; sub++) {
      const rowSkills = group.slice(sub * MAX_COLS, (sub + 1) * MAX_COLS);
      const rowW      = rowSkills.length * (NODE_W + GAP_X) - GAP_X;
      const startX    = (totalW - rowW) / 2;
      const y         = visualRow * ROW_H + PAD_Y;
      if (sub === 0) rowYMap[lv] = y;
      rowSkills.forEach((s, colIdx) => {
        positions[s.skill_id] = { x: startX + colIdx * (NODE_W + GAP_X), y };
      });
      visualRow++;
    }
  });

  const totalH = visualRow * ROW_H + PAD_Y * 2;
  return { positions, totalW, totalH, sortedLevels, rowYMap };
}

/* ── 선행 관계 패널 레이아웃 ─────────────────────────────────── */
function computeChainLayout(skills) {
  const idMap      = new Map(skills.map(s => [s.skill_id, s]));
  const destSkills = skills.filter(s => s.pre_required_skill_id);
  const srcIdSet   = new Set(destSkills.map(s => s.pre_required_skill_id));

  const chains = [];
  for (const srcId of srcIdSet) {
    const src = idMap.get(srcId);
    if (!src) continue;
    const dests = destSkills
      .filter(s => s.pre_required_skill_id === srcId)
      .sort((a, b) => a.required_level - b.required_level || a.name.localeCompare(b.name));
    chains.push({ src, dests });
  }
  chains.sort((a, b) => a.src.required_level - b.src.required_level);

  const positions    = {};
  const chainSkillIds = new Set();
  let y = CH_PAD_Y;

  for (const chain of chains) {
    chainSkillIds.add(chain.src.skill_id);
    chain.dests.forEach(d => chainSkillIds.add(d.skill_id));

    const N      = chain.dests.length;
    const groupH = N * NODE_H + (N - 1) * CH_V_GAP;

    /* 소스: 목적지들의 수직 중앙에 배치.
     * pos.y = 레이블 상단 기준. 실제 노드는 pos.y + CH_LV_H 위치에 렌더됨. */
    positions[chain.src.skill_id] = {
      x: CH_PAD_X,
      y: y + Math.round((groupH - NODE_H) / 2),
    };
    chain.dests.forEach((d, i) => {
      positions[d.skill_id] = {
        x: CH_PAD_X + NODE_W + CH_H_GAP,
        y: y + i * (NODE_H + CH_V_GAP),
      };
    });

    /* groupH에 레이블 높이 포함: 마지막 목적지 레이블까지 공간 확보 */
    y += groupH + CH_LV_H + CH_GRP_PAD;
  }

  const totalH = chains.length > 0 ? y - CH_GRP_PAD + CH_PAD_Y : 0;
  return { positions, chainSkillIds, chains, totalH };
}

/* ── SkillNode ─────────────────────────────────────────────── */
function SkillNode({ skill, job, effLv, charLv, prereqMet = true, onLevelChange, onLockToggle, onTooltipOpen, onTooltipClose }) {
  const iconUrls = useMemo(() => buildIconUrls(skill, job), [skill.skill_id, job]);
  const [iconIdx, setIconIdx] = useState(0);
  useEffect(() => { setIconIdx(0); }, [skill.skill_id]);
  const iconFailed = iconUrls.length === 0 || iconIdx >= iconUrls.length;

  const isAuto = skill.level_mode === 'auto_char' || skill.level_mode === 'auto_every5';
  const minLv  = skill.level_mode === 'auto_lv1_sp' ? 1 : 0;
  const maxLv  = isAuto ? getAutoLevel(skill, effLv, charLv) : getInvestableMax(skill, effLv);
  const lv     = isAuto ? maxLv : skill.current_level;
  const locked = !!skill.locked;

  const isMin        = lv <= minLv;
  const isMax        = lv >= maxLv;
  const cantLearn    = !isAuto && maxLv === 0;
  const cantIncrease = cantLearn || (!isAuto && !prereqMet);
  const learned      = lv > 0;
  const showSp       = !isAuto && (skill.sp_cost_per_level > 0);

  function change(toLevel) {
    if (isAuto) return;
    const next = Math.min(maxLv, Math.max(minLv, toLevel));
    if (!prereqMet && next > lv) return;
    if (next !== skill.current_level) onLevelChange(skill.skill_id, next);
  }

  function handleClick(e) {
    e.preventDefault();
    if (e.shiftKey) change(maxLv);
    else change(skill.current_level + 1);
  }
  function handleRightClick(e) {
    e.preventDefault();
    if (e.shiftKey) change(minLv);
    else change(skill.current_level - 1);
  }

  const cls = [
    'skill-node',
    learned               ? 'learned'         : '',
    isAuto                ? 'auto'             : '',
    cantLearn             ? 'cant-learn'       : '',
    !isAuto && !prereqMet ? 'prereq-blocked'   : '',
    locked                ? 'locked'           : '',
  ].filter(Boolean).join(' ');

  return (
    <div
      className={cls}
      style={{ width: NODE_W }}
      onMouseEnter={e => onTooltipOpen?.(skill.skill_id, { x: e.clientX, y: e.clientY })}
      onMouseLeave={() => onTooltipClose?.()}
    >
      <div
        className="skill-icon-wrap"
        onClick={!isAuto ? handleClick : undefined}
        onContextMenu={!isAuto ? handleRightClick : undefined}
        style={{ cursor: isAuto ? 'default' : 'pointer' }}
      >
        {iconFailed ? (
          <div className="skill-icon-fallback">{skill.name.slice(0, 3)}</div>
        ) : (
          <img
            className="skill-icon"
            src={iconUrls[iconIdx]}
            alt={skill.name}
            draggable={false}
            onError={() => setIconIdx(i => i + 1)}
          />
        )}
        {lv > 0 && <span className="skill-lv-badge">Lv {lv}</span>}
      </div>

      <div className="skill-name">{skill.name}</div>

      {showSp && <div className="skill-sp-cost">{skill.sp_cost_per_level} SP/Lv</div>}

      {isAuto ? (
        <div className="skill-auto-label">자동</div>
      ) : (
        <div className="skill-buttons">
          <div className="skill-btns-row">
            <button className="skill-btn" onClick={() => change(minLv)}
              disabled={isMin} title="최소">◄◄</button>
            <button className="skill-btn" onClick={() => change(skill.current_level - 1)}
              disabled={isMin} title="-1">◄</button>
            <button className="skill-btn" onClick={() => change(skill.current_level + 1)}
              disabled={isMax || cantIncrease} title="+1">+</button>
            <button className="skill-btn" onClick={() => change(maxLv)}
              disabled={isMax || cantIncrease} title="최대">►►</button>
          </div>
          <button
            className={`skill-btn skill-lock-btn${locked ? ' locked' : ''}`}
            onClick={() => onLockToggle && onLockToggle(skill.skill_id)}
            title={locked ? '잠금 해제' : '레벨 고정 (자동 최적화 시 변경 안함)'}
          >
            {locked ? '◆ 고정 해제' : '◇ 최적화 고정'}
          </button>
        </div>
      )}
    </div>
  );
}

/* ── 체인 패널 화살표 렌더링 ──────────────────────────────────── */
function ChainEdges({ chains, chainPos, idToSkill }) {
  return (
    <>
      {chains.map(chain => {
        const srcPos = chainPos[chain.src.skill_id];
        if (!srcPos) return null;

        const srcSkill  = idToSkill.get(chain.src.skill_id);
        const prereqMet = (srcSkill?.current_level ?? 0) > 0;
        const stroke    = prereqMet ? 'var(--accent)' : 'var(--border-strong)';
        const dashArr   = prereqMet ? undefined : '5 4';

        const N   = chain.dests.length;
        const x1  = srcPos.x + NODE_W;                  /* 소스 우측 */
        const cy1 = srcPos.y + CH_LV_H + NODE_H / 2;   /* 소스 중앙 Y (레이블 아래 노드 기준) */

        if (N === 1) {
          const dstPos = chainPos[chain.dests[0].skill_id];
          if (!dstPos) return null;
          /* N=1: 소스와 목적지가 같은 Y → cy1으로 수평선 */
          return (
            <path key={chain.src.skill_id}
              d={`M ${x1} ${cy1} H ${dstPos.x - 8}`}
              fill="none" stroke={stroke} color={stroke}
              strokeWidth="2" opacity="0.75"
              strokeDasharray={dashArr}
              markerEnd="url(#chain-arr)"
            />
          );
        }

        /* N > 1: 버스(T자) 라우팅 ─────────────────────────────
         *   소스 우측 → busX 수평선
         *   busX 수직 버스 (첫 목적지 ↔ 마지막 목적지)
         *   busX → 각 목적지 왼쪽: 화살표 스텁
         */
        const firstDstPos = chainPos[chain.dests[0].skill_id];
        const lastDstPos  = chainPos[chain.dests[N - 1].skill_id];
        if (!firstDstPos || !lastDstPos) return null;

        const firstCY = firstDstPos.y + CH_LV_H + NODE_H / 2;
        const lastCY  = lastDstPos.y  + CH_LV_H + NODE_H / 2;

        return (
          <g key={chain.src.skill_id}>
            {/* 소스 → 버스 수평선 */}
            <path d={`M ${x1} ${cy1} H ${CH_BUS_X}`}
              fill="none" stroke={stroke} strokeWidth="2"
              strokeDasharray={dashArr} opacity="0.75" />
            {/* 버스 수직선 */}
            <path d={`M ${CH_BUS_X} ${firstCY} V ${lastCY}`}
              fill="none" stroke={stroke} strokeWidth="2"
              strokeDasharray={dashArr} opacity="0.75" />
            {/* 각 목적지 스텁 + 화살표 */}
            {chain.dests.map(dest => {
              const dstPos = chainPos[dest.skill_id];
              if (!dstPos) return null;
              const dstCY = dstPos.y + CH_LV_H + NODE_H / 2;
              return (
                <path key={dest.skill_id}
                  d={`M ${CH_BUS_X} ${dstCY} H ${dstPos.x - 8}`}
                  fill="none" stroke={stroke} color={stroke}
                  strokeWidth="2" opacity="0.75"
                  strokeDasharray={dashArr}
                  markerEnd="url(#chain-arr)"
                />
              );
            })}
          </g>
        );
      })}
    </>
  );
}

/* ── SkillTree (메인 컴포넌트) ──────────────────────────────── */
export default function SkillTree({ skills, selectedJob, stats, onSkillLevelChange, onLockToggle, onEnhancementChange, onEvolutionChange }) {
  const effLv  = getEffLv(stats);
  const charLv = stats.char_level;

  /* ── 툴팁 상태 + 타이머 ── */
  const [tooltip, setTooltip]   = useState(null); /* { skill, rect } */
  const showTimer = useRef(null);
  const hideTimer = useRef(null);

  const openTooltip = useCallback((skillId, rect) => {
    clearTimeout(hideTimer.current);
    clearTimeout(showTimer.current);
    showTimer.current = setTimeout(() => setTooltip({ skillId, rect }), 600);
  }, []);

  const startHide = useCallback(() => {
    clearTimeout(showTimer.current);
    hideTimer.current = setTimeout(() => setTooltip(null), 150);
  }, []);

  const cancelHide = useCallback(() => {
    clearTimeout(hideTimer.current);
  }, []);

  const idToSkill = useMemo(() => {
    const m = new Map();
    for (const s of skills) m.set(s.skill_id, s);
    return m;
  }, [skills]);

  /* 선행 관계 패널 레이아웃 */
  const { positions: chainPos, chainSkillIds, chains, totalH: chainH } = useMemo(
    () => computeChainLayout(skills),
    [skills]
  );

  /* 메인 그리드: 체인 스킬 제외 */
  const mainSkills = useMemo(
    () => skills.filter(s => !chainSkillIds.has(s.skill_id)),
    [skills, chainSkillIds]
  );

  const { positions: mainPos, totalW: mainW, totalH: mainH, sortedLevels, rowYMap } = useMemo(
    () => computeLayout(mainSkills),
    [mainSkills]
  );

  /* 체인 스킬 (패널 렌더링용): 현재 상태 반영을 위해 skills에서 직접 필터 */
  const chainSkills = useMemo(
    () => skills.filter(s => chainSkillIds.has(s.skill_id)),
    [skills, chainSkillIds]
  );

  return (
    <>
    <div className="skill-tree-panels">

      {/* ── 메인 그리드 ─────────────────────────────────────── */}
      <div className="skill-tree-root" style={{ width: mainW, height: mainH, minWidth: mainW }}>
        {/* 레벨 레이블 SVG */}
        <svg className="edges-layer" width={mainW} height={mainH} aria-hidden="true">
          {sortedLevels.map(lv => (
            <text key={lv}
              x={PAD_X - 10} y={rowYMap[lv] + NODE_H / 2}
              textAnchor="end" dominantBaseline="middle"
              fontSize="11" fill="var(--text-muted)" fontFamily="inherit">
              {lv}
            </text>
          ))}
        </svg>

        {/* 메인 그리드 스킬 노드 */}
        {mainSkills.map(s => {
          const pos = mainPos[s.skill_id];
          if (!pos) return null;
          return (
            <div key={s.skill_id} style={{ position: 'absolute', left: pos.x, top: pos.y }}>
              <SkillNode
                skill={s} job={selectedJob} effLv={effLv} charLv={charLv}
                prereqMet={true}
                onLevelChange={onSkillLevelChange} onLockToggle={onLockToggle}
                onTooltipOpen={openTooltip} onTooltipClose={startHide}
              />
            </div>
          );
        })}
      </div>

      {/* ── 선행 관계 패널 ──────────────────────────────────── */}
      {chains.length > 0 && (
        <div className="chain-panel">
          <div className="chain-panel-title">선행 스킬 관계</div>
          <div className="chain-panel-inner" style={{ width: CH_PANEL_W, height: chainH }}>

            {/* 화살표 SVG */}
            <svg className="edges-layer" width={CH_PANEL_W} height={chainH} aria-hidden="true">
              <defs>
                <marker id="chain-arr" markerWidth="9" markerHeight="9"
                        refX="8" refY="4.5" orient="auto" markerUnits="strokeWidth">
                  <polygon points="0,0 9,4.5 0,9" fill="currentColor" />
                </marker>
              </defs>
              <ChainEdges chains={chains} chainPos={chainPos} idToSkill={idToSkill} />
            </svg>

            {/* 체인 스킬: 레벨 레이블 + 노드 */}
            {chainSkills.map(s => {
              const pos = chainPos[s.skill_id];
              if (!pos) return null;
              const prereqMet = !s.pre_required_skill_id ||
                (idToSkill.get(s.pre_required_skill_id)?.current_level ?? 0) > 0;
              return (
                <div key={s.skill_id} style={{ position: 'absolute', left: pos.x, top: pos.y }}>
                  {/* 습득 레벨 레이블 */}
                  <div className="chain-lv-tag">Lv {s.required_level}</div>
                  <SkillNode
                    skill={s} job={selectedJob} effLv={effLv} charLv={charLv}
                    prereqMet={prereqMet}
                    onLevelChange={onSkillLevelChange} onLockToggle={onLockToggle}
                    onTooltipOpen={openTooltip} onTooltipClose={startHide}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}

    </div>

    {/* ── 스킬 툴팁 (포털) ── */}
    {tooltip && (() => {
      const tooltipSkill = idToSkill.get(tooltip.skillId);
      if (!tooltipSkill) return null;
      return (
        <SkillTooltip
          skill={tooltipSkill}
          stats={stats}
          rect={tooltip.rect}
          onEnter={cancelHide}
          onLeave={startHide}
          onEnhancementChange={onEnhancementChange}
          onEvolutionChange={onEvolutionChange}
        />
      );
    })()}
  </>
  );
}
