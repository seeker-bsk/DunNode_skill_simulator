import { useMemo } from 'react';

/* ── 데미지 계수 카드 ── */
export function DamageCard({ result, baselineResult, characterName }) {
  const total    = result    && !result.error    ? result.total_damage    : null;
  const baseline = baselineResult && !baselineResult.error ? baselineResult.total_damage : null;
  const hasDelta = !!characterName;

  let delta = null;
  if (hasDelta && total !== null && baseline !== null) {
    delta = (total - baseline) * 100;
  }

  const formatted = total !== null
    ? (total * 100).toLocaleString('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : null;

  let deltaIcon  = '';
  let deltaClass = '';
  if (delta !== null) {
    if      (delta > 0.005)  { deltaIcon = '▲'; deltaClass = ' damage-delta--pos'; }
    else if (delta < -0.005) { deltaIcon = '▼'; deltaClass = ' damage-delta--neg'; }
    else                     { deltaIcon = '■'; deltaClass = ''; }
  }

  return (
    <div className="card damage-card">
      <div className="card-header">
        <span className="card-title">데미지 계수</span>
      </div>
      <div className="card-body damage-card-body">
        <div className="damage-value">
          {formatted !== null
            ? <>{formatted}<span className="damage-unit">%</span></>
            : <span className="damage-empty">-</span>
          }
        </div>
        {hasDelta && (
          <div className={`damage-delta${deltaClass}`}>
            {delta !== null
              ? <><span className="delta-icon">{deltaIcon}</span><span>{delta >= 0 ? '+' : ''}{delta.toFixed(2)}p</span></>
              : <span className="damage-empty">- -</span>
            }
          </div>
        )}
      </div>
    </div>
  );
}

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

/* ── SP 현황 카드 ── */
export function SpCard({ skills, totalSp }) {
  const spUsed      = useMemo(() => calcSpUsed(skills), [skills]);
  const spRemaining = totalSp - spUsed;
  const spOver      = spRemaining < 0;
  const pct         = Math.min(100, (spUsed / totalSp) * 100);

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">SP 현황</span>
        <span className={`sp-badge ${spOver ? 'sp-badge--over' : ''}`}>
          {spOver ? `${Math.abs(spRemaining)} 초과` : `${spRemaining.toLocaleString()} 남음`}
        </span>
      </div>
      <div className="card-body sp-card-body">
        <div className="sp-bar-track">
          <div className="sp-bar-fill" style={{ width: `${pct}%`, background: spOver ? 'var(--danger)' : 'var(--accent)' }} />
        </div>
        <div className="sp-bar-labels">
          <span className="sp-used">{spUsed.toLocaleString()}</span>
          <span className="sp-total">/ {totalSp.toLocaleString()}</span>
        </div>
      </div>
    </div>
  );
}

/* ── 스펙 입력 카드 ── */
export function StatsCard({ stats, onStatsChange }) {
  function set(key, value) {
    onStatsChange(prev => ({ ...prev, [key]: value }));
  }

  const cdrPct     = Math.round(stats.cooldown_reduction * 100);
  const recoverPct = Math.round(stats.cooldown_recovery_speed);

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">캐릭터 스펙</span>
      </div>
      <div className="card-body">
        <div className="stat-row">
          <div className="stat-label">
            <span>쿨타임 감소</span>
            <span className="stat-value">{cdrPct}%</span>
          </div>
          <input type="range" min={0} max={70} step={1} value={cdrPct}
            onChange={e => set('cooldown_reduction', Number(e.target.value) / 100)} />
        </div>
        <div className="stat-row">
          <div className="stat-label">
            <span>쿨타임 회복 속도</span>
            <span className="stat-value">{recoverPct}%</span>
          </div>
          <input type="range" min={0} max={200} step={1} value={recoverPct}
            onChange={e => set('cooldown_recovery_speed', Number(e.target.value))} />
        </div>
        <label className="stat-checkbox-row">
          <input type="checkbox" checked={stats.mastery_contract}
            onChange={e => set('mastery_contract', e.target.checked)} />
          달인의 계약
        </label>
      </div>
    </div>
  );
}

/* ── 시뮬레이션 설정 카드 ── */
export function SimCard({ simDuration, onSimDurationChange, loading, canRun, onSimulate, onOptimize, result }) {
  const total = result && !result.error ? result.total_damage : null;

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">시뮬레이션</span>
      </div>
      <div className="card-body">
        <div className="stat-row">
          <div className="stat-label">
            <span>시간</span>
            <span className="stat-value">{simDuration}s</span>
          </div>
          <input type="number" value={simDuration} min={1} max={600} step={1}
            style={{ width: '100%' }}
            onChange={e => onSimDurationChange(Math.max(1, Number(e.target.value)))} />
        </div>
        <div className="sim-actions" style={{ marginTop: 8 }}>
          <button className="btn-simulate" onClick={() => onSimulate(false)}
            disabled={loading || !canRun}>
            {loading ? '시뮬레이션 중…' : '시뮬레이션'}
          </button>
          <button className="btn-optimize" onClick={() => onSimulate(true)}
            disabled={loading || !canRun}>
            자동 최적화
          </button>
        </div>
        {result?.error && (
          <div className="result-summary">
            <div className="result-error">{result.error}</div>
          </div>
        )}
      </div>
    </div>
  );
}

/* 기존 StatsPanel export는 유지 (App.jsx에서 개별 카드로 대체) */
export default function StatsPanel({ stats, skills, totalSp, onStatsChange, simDuration, onSimDurationChange }) {
  return (
    <>
      <SpCard skills={skills} totalSp={totalSp} />
      <StatsCard stats={stats} onStatsChange={onStatsChange} />
    </>
  );
}
