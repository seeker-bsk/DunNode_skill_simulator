import { useMemo } from 'react';

function calcSpUsed(skills) {
  return skills.reduce((acc, s) => {
    const lm = s.level_mode;
    if (lm === 'auto_char' || lm === 'auto_every5') return acc;
    const lv   = s.current_level ?? 0;
    if (lv === 0) return acc;
    const cost = s.sp_cost_per_level || 1;
    if (lm === 'auto_lv1_sp') return acc + cost * Math.max(0, lv - 1);
    return acc + cost * lv;
  }, 0);
}

export default function StatsPanel({ stats, skills, totalSp, onStatsChange, simDuration, onSimDurationChange }) {
  const spUsed      = useMemo(() => calcSpUsed(skills), [skills]);
  const spRemaining = totalSp - spUsed;
  const spOver      = spRemaining < 0;

  function set(key, value) {
    onStatsChange(prev => ({ ...prev, [key]: value }));
  }

  const cdrPct     = Math.round(stats.cooldown_reduction * 100);
  const recoverPct = Math.round(stats.cooldown_recovery_speed);

  return (
    <div className="stats-panel">
      <h3>캐릭터 스펙</h3>

      {/* 쿨타임 감소 (직접) */}
      <div className="stat-row">
        <div className="stat-label">
          <span>쿨타임 감소 (직접)</span>
          <span className="stat-value">{cdrPct}%</span>
        </div>
        <input
          type="range"
          min={0} max={70} step={1}
          value={cdrPct}
          onChange={e => set('cooldown_reduction', Number(e.target.value) / 100)}
        />
      </div>

      {/* 쿨타임 회복 속도 */}
      <div className="stat-row">
        <div className="stat-label">
          <span>쿨타임 회복 속도</span>
          <span className="stat-value">{recoverPct}%</span>
        </div>
        <input
          type="range"
          min={0} max={200} step={1}
          value={recoverPct}
          onChange={e => set('cooldown_recovery_speed', Number(e.target.value))}
        />
      </div>

      {/* 달인의 계약 */}
      <label className="stat-checkbox-row">
        <input
          type="checkbox"
          checked={stats.mastery_contract}
          onChange={e => set('mastery_contract', e.target.checked)}
        />
        달인의 계약 (SP 투자 가능 레벨 +5)
      </label>

      {/* SP 현황 — 총 SP는 만렙 기준 19,320 고정 */}
      <div className="sp-info">
        <span>SP 사용: <strong>{spUsed}</strong> / {totalSp.toLocaleString()}</span>
        <span className={spOver ? 'sp-over' : 'sp-ok'}>
          {spOver
            ? `${Math.abs(spRemaining)} 초과`
            : `${spRemaining} 남음`}
        </span>
      </div>

      {/* 시뮬레이션 시간 */}
      <div className="stat-row">
        <div className="stat-label">
          <span>시뮬레이션 시간 (초)</span>
          <span className="stat-value">{simDuration}s</span>
        </div>
        <input
          type="number"
          value={simDuration}
          min={1}
          max={600}
          step={1}
          style={{ width: '100%' }}
          onChange={e => onSimDurationChange(Math.max(1, Number(e.target.value)))}
        />
      </div>
    </div>
  );
}
