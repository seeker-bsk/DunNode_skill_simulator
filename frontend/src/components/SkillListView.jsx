import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import SkillTooltip from './SkillTooltip';

/* ── 아이콘 헬퍼 ── */
function toIconName(name) {
  return name.replace(/ : /g, '_').replace(/ /g, '_');
}
function buildIconUrls(skill, job) {
  if (!job) return [];
  const enc     = encodeURIComponent;
  const fname   = toIconName(skill.name);
  const charDir = enc(job.characterName);
  const jobDir  = enc(job.jobName.replace(/^眞\s*/, ''));
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

/* ── 레벨 헬퍼 ── */
function getEffLv(stats) {
  return stats.char_level + (stats.mastery_contract ? 5 : 0);
}
function getInvestableMax(skill, effLv) {
  if (effLv < skill.required_level) return 0;
  const range   = skill.required_level_range || 1;
  const charCap = Math.floor((effLv - skill.required_level) / range) + 1;
  return Math.min(skill.master_level, Math.max(0, charCap));
}
function getAutoLevel(skill, effLv, charLv) {
  if (effLv < skill.required_level) return 0;
  if (skill.level_mode === 'auto_char')   return Math.min(charLv, skill.master_level);
  if (skill.level_mode === 'auto_every5')
    return Math.min(Math.floor((effLv - skill.required_level) / 5) + 1, skill.master_level);
  return skill.current_level;
}

/* ── 선행-후행 관계를 고려한 평탄 목록 생성 ── */
function buildFlatList(skills, sortByActive, sortKey, sortDir) {
  const idMap      = new Map(skills.map(s => [s.skill_id, s]));
  const childrenOf = new Map();

  for (const s of skills) {
    const pid = s.pre_required_skill_id;
    if (pid && idMap.has(pid)) {
      if (!childrenOf.has(pid)) childrenOf.set(pid, []);
      childrenOf.get(pid).push(s);
    }
  }

  const childIds = new Set(
    [...childrenOf.values()].flatMap(arr => arr.map(s => s.skill_id))
  );
  let roots = skills.filter(s => !childIds.has(s.skill_id));

  const colCmp = (a, b) => {
    let c = 0;
    if      (sortKey === 'name')   c = a.name.localeCompare(b.name);
    else if (sortKey === 'req_lv') c = a.required_level - b.required_level;
    else if (sortKey === 'sp')     c = (a.sp_cost_per_level || 0) - (b.sp_cost_per_level || 0);
    else if (sortKey === 'level')  c = (a.current_level || 0) - (b.current_level || 0);
    return sortDir === 'asc' ? c : -c;
  };

  const sortGroup = arr =>
    [...arr].sort((a, b) => {
      if (sortByActive) {
        const diff = ((b.current_level > 0) ? 1 : 0) - ((a.current_level > 0) ? 1 : 0);
        if (diff !== 0) return diff;
      }
      return colCmp(a, b);
    });

  roots = sortGroup(roots);

  const result = [];
  function add(skill, depth) {
    result.push({ skill, depth });
    const children = sortGroup(childrenOf.get(skill.skill_id) || []);
    for (const child of children) add(child, depth + 1);
  }
  for (const root of roots) add(root, 0);
  return result;
}

/* ── 스킬 아이콘 ── */
function SkillIcon({ skill, job }) {
  const [idx, setIdx] = useState(0);
  const urls = useMemo(() => buildIconUrls(skill, job), [skill.skill_id, job]);
  useEffect(() => setIdx(0), [skill.skill_id]);
  if (!urls.length || idx >= urls.length)
    return <div className="slist-icon-fallback">{skill.name.slice(0, 2)}</div>;
  return (
    <img className="slist-icon" src={urls[idx]} alt={skill.name}
      draggable={false} onError={() => setIdx(i => i + 1)} />
  );
}

/* ── 개별 행 ── */
function SkillListRow({ skill, depth, job, effLv, charLv, onLevelChange, onLockToggle, onTooltipOpen, onTooltipClose }) {
  const isAuto  = skill.level_mode === 'auto_char' || skill.level_mode === 'auto_every5';
  const minLv   = skill.level_mode === 'auto_lv1_sp' ? 1 : 0;
  const maxLv   = isAuto ? getAutoLevel(skill, effLv, charLv) : getInvestableMax(skill, effLv);
  const lv      = isAuto ? maxLv : skill.current_level;
  const locked  = !!skill.locked;

  const isMin     = lv <= minLv;
  const isMax     = lv >= maxLv;
  const cantLearn = !isAuto && maxLv === 0;
  const learned   = lv > 0;
  const showSp    = (skill.level_mode === 'sp' || skill.level_mode === 'auto_lv1_sp')
                    && (skill.sp_cost_per_level > 0);

  function change(toLevel) {
    if (isAuto || locked) return;
    const next = Math.min(maxLv, Math.max(minLv, toLevel));
    if (next !== skill.current_level) onLevelChange(skill.skill_id, next);
  }

  const rowCls = [
    'slist-row',
    learned   ? 'learned'    : '',
    cantLearn ? 'cant-learn' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={rowCls}>
      {/* 이름 셀: 툴팁 트리거 영역 */}
      <div
        className="slist-name-cell"
        style={{ paddingLeft: depth * 20 }}
        onMouseEnter={e => onTooltipOpen?.(skill.skill_id, { x: e.clientX, y: e.clientY })}
        onMouseLeave={() => onTooltipClose?.()}
      >
        {depth > 0 && <span className="slist-prereq-mark">ㄴ</span>}
        <SkillIcon skill={skill} job={job} />
        <span className="slist-name">{skill.name}</span>
      </div>

      {/* 필요 캐릭터 레벨 */}
      <span className="slist-req-lv">Lv.{skill.required_level}</span>

      {/* SP 소모 */}
      <span className="slist-sp">
        {showSp ? `${skill.sp_cost_per_level} SP` : ''}
      </span>

      {/* 현재 레벨 */}
      <span className="slist-level">
        {isAuto ? (
          <span className="slist-auto-badge">자동 {lv}</span>
        ) : (
          <>
            <span className={`slist-lv-num${learned ? ' learned' : ''}`}>Lv {lv}</span>
            <span className="slist-lv-max"> / {maxLv}</span>
          </>
        )}
      </span>

      {/* 조작 버튼 */}
      {isAuto ? (
        <div />
      ) : (
        <div className="slist-btns">
          <button className="slist-btn" onClick={() => change(lv - 1)}
            disabled={isMin || locked}>◄</button>
          <button className="slist-btn" onClick={() => change(lv + 1)}
            disabled={isMax || cantLearn || locked}>+</button>
          <button
            className={`slist-btn slist-lock-btn${locked ? ' locked' : ''}`}
            onClick={() => onLockToggle(skill.skill_id)}
            title={locked ? '잠금 해제' : '최적화 고정'}
          >{locked ? '◆' : '◇'}</button>
        </div>
      )}
    </div>
  );
}

/* ── 목록 뷰 (export) ── */
export default function SkillListView({ skills, selectedJob, stats, onSkillLevelChange, onLockToggle, onEnhancementChange, onEvolutionChange }) {
  const [sortByActive, setSortByActive] = useState(false);
  const [sortKey,      setSortKey]      = useState('req_lv');
  const [sortDir,      setSortDir]      = useState('asc');
  const [tooltip, setTooltip] = useState(null);

  const handleSort = (key) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };
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

  const effLv  = getEffLv(stats);
  const charLv = stats.char_level;

  const flatList = useMemo(
    () => buildFlatList(skills, sortByActive, sortKey, sortDir),
    [skills, sortByActive, sortKey, sortDir]
  );

  return (
    <>
      <div className="slist-panel">
        <div className="slist-toolbar">
          <label className="slist-sort-label">
            <input type="checkbox" checked={sortByActive}
              onChange={e => setSortByActive(e.target.checked)} />
            채용한 스킬 우선 정렬
          </label>
        </div>
        <div className="slist-header-row">
          {[
            ['name',   '스킬',   ''],
            ['req_lv', '필요Lv', 'num'],
            ['sp',     'SP',     'num'],
            ['level',  '레벨',   'num'],
          ].map(([key, label, align]) => (
            <div
              key={key}
              className={`slist-header-th sortable${align ? ` ${align}` : ''}${sortKey === key ? ' active' : ''}`}
              onClick={() => handleSort(key)}
            >
              {label}
              <span className="slist-sort-arrow">
                {sortKey === key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
              </span>
            </div>
          ))}
          <div className="slist-header-th" />
        </div>
        <div className="slist-content">
          {flatList.map(({ skill, depth }) => (
            <SkillListRow
              key={skill.skill_id}
              skill={skill}
              depth={depth}
              job={selectedJob}
              effLv={effLv}
              charLv={charLv}
              onLevelChange={onSkillLevelChange}
              onLockToggle={onLockToggle}
              onTooltipOpen={openTooltip}
              onTooltipClose={startHide}
            />
          ))}
        </div>
      </div>
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
