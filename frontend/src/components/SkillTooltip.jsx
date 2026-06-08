import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const TOOLTIP_W = 264;
const OFFSET    = 14;

/* 유효 캐릭터 레벨 기준 최대 투자 가능 레벨 */
function getInvestableMax(skill, effLv) {
  if (effLv < skill.required_level) return 0;
  const range   = skill.required_level_range || 1;
  const charCap = Math.floor((effLv - skill.required_level) / range) + 1;
  return Math.min(skill.master_level, Math.max(0, charCap));
}

/* 숫자 → 콤마 정수 % 표기 */
function fmtPct(v) {
  if (!v || v <= 0) return '0%';
  return Math.round(v).toLocaleString('ko-KR') + '%';
}

/* 현재 선택(bloom_type, enhancement_type) 기준 툴팁 수치 계산.
 * C 코어와 동일한 공식 사용 (CLAUDE.md 핵심 공식 참조). */
function computeDisplayStats(skill, stats) {
  const effLv     = stats.char_level + (stats.mastery_contract ? 5 : 0);
  const isAuto    = skill.level_mode === 'auto_char' || skill.level_mode === 'auto_every5';
  const investMax = isAuto ? skill.master_level : getInvestableMax(skill, effLv);

  const lv  = skill.current_level || 0;
  const bt  = skill.bloom_type        || 0;
  const et  = skill.enhancement_type  || 0;
  const bo  = bt === 1 ? skill.bloom_option_1 : bt === 2 ? skill.bloom_option_2 : null;

  /* 데미지 계산 (active 스킬 + lv > 0 시만 유효) */
  let dmg = 0;
  if (lv > 0 && skill.type === 'active' && skill.damage_per_level?.length > 0) {
    const idx = Math.min(lv - 1, skill.damage_per_level.length - 1);
    dmg = skill.damage_per_level[idx];

    /* 강화 배율 */
    if      (et === 1) dmg *= 1 + (skill.enhancement_atk_1 || 0);
    else if (et === 2) dmg *= 1 + (skill.enhancement_atk_2 || 0);

    /* 개화 데미지 배율 (0이면 변화 없음) */
    const dm = bo?.damage_mult;
    if (dm && dm > 0) dmg *= dm;
  }

  /* 쿨타임 계산 */
  const baseCd = (bo?.cooldown > 0 ? bo.cooldown : null) ?? skill.base_cooldown ?? 0;

  const recoveryCdr = 1 - 100 / (100 + (stats.cooldown_recovery_speed || 0));
  const enhCdr      = (et === 2) ? 0.15 : 0;
  const combined    = Math.min((stats.cooldown_reduction || 0) + recoveryCdr + enhCdr, 0.70);
  const finalCd     = baseCd * Math.max(1 - combined, 0.30);

  /* 시전 시간: cast_time >= 0이면 개화 값 사용 (0 = 즉시시전), -1이면 기본값 */
  const castTime = (bo && bo.cast_time >= 0 ? bo.cast_time : null) ?? skill.cast_time ?? 0;

  return { lv, investMax, dmg, baseCd, finalCd, castTime };
}

export default function SkillTooltip({
  skill, stats, rect,
  onEnter, onLeave,
  onEnhancementChange, onEvolutionChange,
}) {
  const divRef = useRef(null);
  /* 초기값: 화면 밖 배치 → useLayoutEffect에서 실측 후 이동 */
  const [pos, setPos] = useState({ left: -9999, top: -9999 });

  useLayoutEffect(() => {
    if (!divRef.current) return;
    const h = divRef.current.offsetHeight;

    /* 기본: 커서 우측 하단 */
    let left = rect.x + OFFSET;
    let top  = rect.y + OFFSET;

    /* 우측 화면 밖 → 커서 좌측으로 */
    if (left + TOOLTIP_W > window.innerWidth - 8) {
      left = rect.x - TOOLTIP_W - OFFSET;
    }
    /* 하단 화면 밖 → 커서 위쪽으로 (실측 높이 기준) */
    if (top + h > window.innerHeight - 8) {
      top = rect.y - h - OFFSET;
    }

    /* 최종 화면 경계 클램프 */
    left = Math.max(8, left);
    top  = Math.max(8, top);

    setPos({ left, top });
  }, [rect, skill]);

  const { left, top } = pos;

  const { lv, investMax, dmg, baseCd, finalCd, castTime } = computeDisplayStats(skill, stats);

  const et = skill.enhancement_type || 0;
  const bt = skill.bloom_type       || 0;

  const canEnhance = !!skill.can_enhance;
  const canEvolve  = !!skill.can_evolve;

  /* 강화 버튼 레이블 */
  const enh1Label = skill.enhancement_atk_1
    ? `+${Math.round(skill.enhancement_atk_1 * 100)}% 공격력`
    : '강화 I';
  const enh2Label = skill.enhancement_atk_2
    ? `+${Math.round(skill.enhancement_atk_2 * 100)}% +CDR`
    : '강화 II';

  /* 개화 버튼 레이블 (name 필드 있으면 우선) */
  const b1Label = skill.bloom_option_1?.name || '개화 I';
  const b2Label = skill.bloom_option_2?.name || '개화 II';

  const cdChanged = baseCd > 0 && Math.abs(finalCd - baseCd) > 0.05;

  return createPortal(
    <div
      ref={divRef}
      className="skill-tooltip"
      style={{ left, top }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      {/* ── 헤더 ── */}
      <div className="tt-header">
        <span className="tt-name">{skill.name}</span>
        <span className="tt-level">Lv {lv} / {investMax}</span>
      </div>

      {/* ── 수치 ── */}
      {lv > 0 && (dmg > 0 || baseCd > 0 || skill.cast_time > 0) && (
        <div className="tt-stats">
          {dmg > 0 && (
            <div className="tt-stat">
              <span className="tt-stat-label">데미지</span>
              <span className="tt-stat-value tt-accent">{fmtPct(dmg)}</span>
            </div>
          )}
          {baseCd > 0 && (
            <div className="tt-stat">
              <span className="tt-stat-label">쿨타임</span>
              <span className="tt-stat-value">
                {baseCd.toFixed(1)}s
                {cdChanged && (
                  <span className="tt-cd-after"> → {finalCd.toFixed(1)}s</span>
                )}
              </span>
            </div>
          )}
          {skill.cast_time > 0 && (
            <div className="tt-stat">
              <span className="tt-stat-label">시전시간</span>
              <span className="tt-stat-value">{castTime.toFixed(2)}s</span>
            </div>
          )}
        </div>
      )}

      {/* ── 강화 선택 ── */}
      {canEnhance && (
        <div className="tt-section">
          <span className="tt-section-label">강화</span>
          <div className="tt-btn-group">
            <button
              className={`tt-sel-btn${et === 0 ? ' active' : ''}`}
              onClick={() => onEnhancementChange(skill.skill_id, 0)}
            >없음</button>
            <button
              className={`tt-sel-btn${et === 1 ? ' active' : ''}`}
              onClick={() => onEnhancementChange(skill.skill_id, 1)}
            >{enh1Label}</button>
            <button
              className={`tt-sel-btn${et === 2 ? ' active' : ''}`}
              onClick={() => onEnhancementChange(skill.skill_id, 2)}
            >{enh2Label}</button>
          </div>
        </div>
      )}

      {/* ── 개화 선택 ── */}
      {canEvolve && (
        <div className="tt-section">
          <span className="tt-section-label">개화</span>
          <div className="tt-btn-group">
            <button
              className={`tt-sel-btn${bt === 0 ? ' active' : ''}`}
              onClick={() => onEvolutionChange(skill.skill_id, 0)}
            >없음</button>
            <button
              className={`tt-sel-btn${bt === 1 ? ' active' : ''}`}
              onClick={() => onEvolutionChange(skill.skill_id, 1)}
            >{b1Label}</button>
            <button
              className={`tt-sel-btn${bt === 2 ? ' active' : ''}`}
              onClick={() => onEvolutionChange(skill.skill_id, 2)}
            >{b2Label}</button>
          </div>
        </div>
      )}
      {/* ── 스킬 설명 ── */}
      {skill.option_desc && (
        <div className="tt-option-desc">{skill.option_desc}</div>
      )}
    </div>,
    document.body
  );
}
