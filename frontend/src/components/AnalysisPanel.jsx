import { useState, useMemo, useEffect } from 'react';

/* v는 "배" 단위 → ×100 변환 후 정수 콤마 % 표기 */
function formatCoef(v) {
  if (!v) return '0%';
  return Math.round(v * 100).toLocaleString('ko-KR') + '%';
}

/* 차트 Y축: 이미 % 단위로 변환된 값을 정수 콤마로 표기 */
function fmtAxis(v) {
  return Math.round(v).toLocaleString('ko-KR') + '%';
}

/* ── 아이콘 URL 목록 빌드 (SkillTree.jsx와 동일한 순서) ──────── */
function buildIconUrls(skillName, selectedJob) {
  if (!selectedJob || !skillName) return [];
  const enc    = encodeURIComponent;
  const fname  = skillName.replace(/ : /g, '_').replace(/ /g, '_');
  const base   = '/media/skill_icon';
  const cDir   = enc(selectedJob.characterName);
  const jDir   = enc(selectedJob.jobName.replace(/^眞\s*/, ''));
  const comDir = enc(selectedJob.characterName + '공통');
  return [
    `${base}/${cDir}/${jDir}/${fname}.webp`,
    `${base}/${cDir}/${jDir}/${fname}.png`,
    `${base}/${cDir}/${comDir}/${fname}.webp`,
    `${base}/${cDir}/${comDir}/${fname}.png`,
    `${base}/공통/${fname}.webp`,
    `${base}/공통/${fname}.png`,
  ];
}

/* ── 공용 스킬 아이콘 컴포넌트 ────────────────────────────────── */
function SkillIcon({ skillName, selectedJob, size, imgClass, fallbackClass }) {
  const [idx, setIdx] = useState(0);
  const urls = useMemo(() => buildIconUrls(skillName, selectedJob), [skillName, selectedJob]);
  useEffect(() => setIdx(0), [skillName]);

  if (!urls.length || idx >= urls.length) {
    return (
      <div
        className={fallbackClass}
        style={{ width: size, height: size }}
        title={skillName}
      >
        {skillName?.slice(0, 2)}
      </div>
    );
  }
  return (
    <img
      className={imgClass}
      style={{ width: size, height: size }}
      src={urls[idx]}
      alt={skillName}
      title={skillName}
      onError={() => setIdx(i => i + 1)}
    />
  );
}

/* ── 스킬 통계 테이블 ─────────────────────────────────────────── */
function DamageTable({ skillStats, simDuration, selectedJob }) {
  return (
    <div className="dmg-table-wrap">
      <table className="dmg-table">
        <thead>
          <tr>
            <th>스킬</th>
            <th className="num-col">총 데미지</th>
            <th className="num-col">초당 데미지</th>
            <th className="num-col">횟수</th>
            <th className="num-col">기여도</th>
          </tr>
        </thead>
        <tbody>
          {skillStats.map(s => (
            <tr
              key={s.skill_id}
              style={{
                background: `linear-gradient(to right, rgba(56,139,253,0.10) ${s.contribution_pct}%, transparent ${s.contribution_pct}%)`
              }}
            >
              <td className="name-col">
                <div className="tbl-name-cell">
                  <SkillIcon
                    skillName={s.skill_name}
                    selectedJob={selectedJob}
                    size={30}
                    imgClass="tbl-skill-icon"
                    fallbackClass="tbl-icon-fallback"
                  />
                  <span>{s.skill_name}</span>
                </div>
              </td>
              <td className="num-col">{formatCoef(s.total_damage)}</td>
              <td className="num-col">{formatCoef(s.total_damage / simDuration)}</td>
              <td className="num-col">{s.use_count}</td>
              <td className="num-col pct-col">{s.contribution_pct.toFixed(1)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── 데미지 차트 ──────────────────────────────────────────────── */
const VW = 860;
const VH = 210;
const PAD = { top: 14, right: 20, bottom: 34, left: 60 };
const IW = VW - PAD.left - PAD.right;
const IH = VH - PAD.top - PAD.bottom;

function DamageChart({ timeline, simDuration, totalDamage }) {
  /* 배 단위 → % 단위(×100) 변환 후 그래프 좌표 계산 */
  const cumPts = useMemo(() => {
    let cum = 0;
    const pts = [{ t: 0, d: 0 }];
    for (const ev of timeline) {
      if (ev.skill_id !== null && (ev.damage ?? 0) > 0) {
        pts.push({ t: ev.time, d: cum * 100 });
        cum += ev.damage;
        pts.push({ t: ev.time, d: cum * 100 });
      }
    }
    pts.push({ t: simDuration, d: cum * 100 });
    return pts;
  }, [timeline, simDuration]);

  const dpsBuckets = useMemo(() => {
    const n = Math.max(1, Math.ceil(simDuration));
    const b = new Array(n).fill(0);
    for (const ev of timeline) {
      if (ev.skill_id !== null && (ev.damage ?? 0) > 0) {
        const i = Math.min(Math.floor(ev.time), n - 1);
        b[i] += ev.damage;
      }
    }
    return b.map(v => v * 100);
  }, [timeline, simDuration]);

  const maxDmg = Math.max(totalDamage ?? 1, 1);
  const maxDps = Math.max(...dpsBuckets, 1);
  const n      = dpsBuckets.length;

  const sx    = t   => PAD.left + (t / simDuration) * IW;
  const sy    = d   => PAD.top + IH - (d / maxDmg) * IH;
  const syDps = dps => PAD.top + IH - (dps / maxDps) * IH;

  const cumD = cumPts
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(p.t).toFixed(1)},${sy(p.d).toFixed(1)}`)
    .join(' ');

  const dpsD = dpsBuckets
    .map((dps, i) => `${i === 0 ? 'M' : 'L'}${sx(i + 0.5).toFixed(1)},${syDps(dps).toFixed(1)}`)
    .join(' ');

  const xStep = simDuration <= 60 ? 10 : simDuration <= 180 ? 30 : 60;
  const xTicks = [];
  for (let t = 0; t <= simDuration; t += xStep) xTicks.push(t);

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map(f => ({
    val: maxDmg * f,
    y:   sy(maxDmg * f),
  }));

  const barW = Math.max((IW / n) - 1, 1);

  return (
    <div className="chart-wrap">
      <div className="chart-legend">
        <span className="legend-cum">─ 누적 데미지</span>
        <span className="legend-dps">─ 초당 데미지</span>
      </div>
      <svg
        viewBox={`0 0 ${VW} ${VH}`}
        style={{ width: '100%', height: 'auto', display: 'block' }}
        aria-label="데미지 차트"
      >
        {yTicks.map((tk, i) => (
          <g key={i}>
            <line
              x1={PAD.left} y1={tk.y}
              x2={VW - PAD.right} y2={tk.y}
              stroke="var(--border)" strokeWidth="0.6"
            />
            <text
              x={PAD.left - 5} y={tk.y}
              textAnchor="end" dominantBaseline="middle"
              fontSize="9.5" fill="var(--text-muted)"
            >
              {fmtAxis(tk.val)}
            </text>
          </g>
        ))}

        {xTicks.map((t, i) => (
          <text
            key={i}
            x={sx(t)} y={VH - PAD.bottom + 15}
            textAnchor="middle" fontSize="9.5" fill="var(--text-muted)"
          >
            {t}s
          </text>
        ))}

        {dpsBuckets.map((dps, i) => {
          const bx = sx(i);
          const by = syDps(dps);
          const bh = (PAD.top + IH) - by;
          return (
            <rect
              key={i} x={bx} y={by} width={barW} height={Math.max(bh, 0)}
              fill="var(--warning)" opacity="0.22"
            />
          );
        })}

        <path d={dpsD} fill="none" stroke="var(--warning)" strokeWidth="1.6" opacity="0.85" />
        <path d={cumD} fill="none" stroke="var(--accent)" strokeWidth="2.2" />

        <line
          x1={PAD.left} y1={PAD.top}
          x2={PAD.left} y2={PAD.top + IH}
          stroke="var(--border-strong)" strokeWidth="1"
        />
        <line
          x1={PAD.left} y1={PAD.top + IH}
          x2={VW - PAD.right} y2={PAD.top + IH}
          stroke="var(--border-strong)" strokeWidth="1"
        />
      </svg>
    </div>
  );
}

/* ── 스킬 사용 순서 (아이콘 타임라인) ───────────────────────── */
const SEQ_ICON = 36;    /* 아이콘 한 변 (px) */
const SEQ_RULER_H = 24; /* 루즐 높이 (px) — CSS와 동일해야 함 */
const SEQ_ROW_GAP = 5;  /* 행 간 간격 (px) */
const SEQ_MIN_PX_SEC = 20; /* 초당 최소 픽셀 */

function SkillSequence({ timeline, simDuration, selectedJob }) {
  const events = useMemo(
    () => timeline.filter(ev => ev.skill_id !== null && (ev.damage ?? 0) > 0),
    [timeline]
  );

  const trackW   = Math.max(860, simDuration * SEQ_MIN_PX_SEC);
  const pxPerSec = trackW / simDuration;
  const totalH   = SEQ_RULER_H + SEQ_ICON * 2 + SEQ_ROW_GAP + 6;

  /* 2-행 그리디 스태거: 이전 이벤트와 아이콘 폭보다 가까우면 반대 행 */
  const minGapSec = (SEQ_ICON + 2) / pxPerSec;
  const rowOf = useMemo(() => {
    const rows = [];
    const lastT = [-Infinity, -Infinity];
    for (const ev of events) {
      const r = (ev.time - lastT[0] >= minGapSec) ? 0 : 1;
      rows.push(r);
      lastT[r] = ev.time;
    }
    return rows;
  }, [events, minGapSec]);

  const toX = t   => (t / simDuration) * trackW;
  const toY = row => SEQ_RULER_H + row * (SEQ_ICON + SEQ_ROW_GAP);

  /* 루즐 틱 생성 */
  const majorStep = simDuration <= 30 ? 5 : simDuration <= 90 ? 10 : 30;
  const majorTicks = [];
  for (let t = 0; t <= simDuration; t += majorStep) majorTicks.push(t);

  const minorStep = majorStep >= 10 ? 5 : 1;
  const minorTicks = [];
  for (let t = minorStep; t < simDuration; t += minorStep) {
    if (t % majorStep !== 0) minorTicks.push(t);
  }

  return (
    <div className="skill-seq-wrap">
      <div className="skill-seq-title">스킬 사용 순서</div>
      <div className="skill-seq-scroll">
        <div
          className="skill-seq-inner"
          style={{ width: trackW, height: totalH }}
        >
          {/* 루즐 베이스라인 */}
          <div className="seq-baseline" />

          {/* 마이너 틱 */}
          {minorTicks.map(t => (
            <div
              key={`n${t}`}
              className="seq-minor-tick"
              style={{ left: toX(t) }}
            />
          ))}

          {/* 메이저 틱 + 레이블 */}
          {majorTicks.map(t => (
            <div
              key={`M${t}`}
              className="seq-major-tick"
              style={{ left: toX(t) }}
            >
              <span>{t}s</span>
            </div>
          ))}

          {/* 스킬 아이콘 */}
          {events.map((ev, i) => (
            <div
              key={i}
              className="seq-skill-item"
              style={{
                left: toX(ev.time) - SEQ_ICON / 2,
                top:  toY(rowOf[i]),
              }}
            >
              <SkillIcon
                skillName={ev.skill_name}
                selectedJob={selectedJob}
                size={SEQ_ICON}
                imgClass="seq-skill-icon"
                fallbackClass="seq-icon-fallback"
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── AnalysisPanel ────────────────────────────────────────────── */
export default function AnalysisPanel({ result, simDuration, selectedJob }) {
  const [innerTab, setInnerTab] = useState('stats');

  const hasResult = result && !result.error && result.total_damage != null;

  const sorted = useMemo(
    () =>
      [...(result?.skill_stats ?? [])].sort(
        (a, b) => b.contribution_pct - a.contribution_pct
      ),
    [result]
  );

  if (!hasResult) {
    return (
      <div className="analysis-empty">
        시뮬레이션을 먼저 실행하세요
      </div>
    );
  }

  return (
    <div className="analysis-panel">
      <div className="analysis-tab-bar">
        {[['stats', '스킬 통계'], ['timeline', '타임라인']].map(([key, label]) => (
          <button
            key={key}
            className={`analysis-tab-btn${innerTab === key ? ' active' : ''}`}
            onClick={() => setInnerTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="analysis-content">
        {innerTab === 'stats' && (
          <DamageTable
            skillStats={sorted}
            simDuration={simDuration}
            selectedJob={selectedJob}
          />
        )}
        {innerTab === 'timeline' && (
          <div className="timeline-view">
            <DamageChart
              timeline={result.timeline ?? []}
              simDuration={simDuration}
              totalDamage={result.total_damage * 100}
            />
            <SkillSequence
              timeline={result.timeline ?? []}
              simDuration={simDuration}
              selectedJob={selectedJob}
            />
          </div>
        )}
      </div>
    </div>
  );
}
