import { useState, useEffect, useCallback } from 'react';
import { ThemeProvider } from './contexts/ThemeContext';
import Header from './components/Header';
import SkillTree from './components/SkillTree';
import StatsPanel from './components/StatsPanel';
import AnalysisPanel from './components/AnalysisPanel';
import BloomPanel from './components/BloomPanel';
import SkillListView from './components/SkillListView';

const TOTAL_SP = 19320;

const DEFAULT_STATS = {
  cooldown_reduction:        0.10,
  cooldown_recovery_speed:   40,
  char_level:                115,
  mastery_contract:          true,
};

function lockedSpCost(s) {
  const lm = s.level_mode;
  if (lm === 'auto_char' || lm === 'auto_every5') return 0;
  const lv = s.current_level ?? 0;
  if (lv === 0) return 0;
  const cost = s.sp_cost_per_level || 1;
  if (lm === 'auto_lv1_sp') return cost * Math.max(0, lv - 1);
  return cost * lv;
}

function fmtCoef(v) {
  if (!v) return '0';
  return Math.round(v * 100).toLocaleString('ko-KR');
}

export default function App() {
  const [jobs,        setJobs]        = useState([]);
  const [selectedJob, setSelectedJob] = useState(null);
  const [skills,      setSkills]      = useState([]);
  const [stats,       setStats]       = useState(DEFAULT_STATS);
  const [simDuration, setSimDuration] = useState(43);
  const [result,      setResult]      = useState(null);
  const [loading,     setLoading]     = useState(false);
  const [treeLoading, setTreeLoading] = useState(false);
  const [rightTab,    setRightTab]    = useState('tree');
  const [toast,       setToast]       = useState(null); /* { msg, key } */
  const [skillViewMode, setSkillViewMode] = useState('tree');

  useEffect(() => {
    fetch('/jobs')
      .then(r => r.json())
      .then(data => setJobs(data.filter(j => j.hasData)))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedJob) { setSkills([]); setResult(null); return; }
    setTreeLoading(true);
    setResult(null);
    fetch(`/tree/${selectedJob.dataKey}`)
      .then(r => r.json())
      .then(data => {
        setSkills(data.map(s => ({
          ...s,
          current_level: s.level_mode === 'auto_lv1_sp' && s.current_level === 0
            ? 1
            : s.current_level,
          locked: false,
        })));
      })
      .catch(() => setSkills([]))
      .finally(() => setTreeLoading(false));
  }, [selectedJob]);

  const handleSkillLevelChange = useCallback((skillId, newLevel) => {
    setSkills(prev =>
      prev.map(s => s.skill_id === skillId ? { ...s, current_level: newLevel } : s)
    );
  }, []);

  const handleLockToggle = useCallback((skillId) => {
    setSkills(prev =>
      prev.map(s => s.skill_id === skillId ? { ...s, locked: !s.locked } : s)
    );
  }, []);

  const handleEnhancementChange = useCallback((skillId, type) => {
    setSkills(prev =>
      prev.map(s => s.skill_id === skillId ? { ...s, enhancement_type: type } : s)
    );
  }, []);

  const handleEvolutionChange = useCallback((skillId, type) => {
    setSkills(prev =>
      prev.map(s => s.skill_id === skillId ? { ...s, bloom_type: type } : s)
    );
  }, []);

  const handleResetSkills = useCallback(() => {
    if (!window.confirm('잠금되지 않은 모든 스킬의 레벨을 초기화합니다.')) return;
    setSkills(prev => prev.map(s => {
      if (s.locked) return s;
      const lm = s.level_mode;
      if (lm === 'auto_char' || lm === 'auto_every5') return s;
      if (lm === 'auto_lv1_sp') return { ...s, current_level: 1 };
      return { ...s, current_level: 0 };
    }));
  }, []);

  const handleSimulate = useCallback(async (autoOptimize = false) => {
    if (!selectedJob || skills.length === 0) return;
    setLoading(true);
    try {
      let requestSkills;
      let totalSpForRequest;

      if (autoOptimize) {
        const lockedSpUsed = skills.reduce(
          (acc, s) => acc + (s.locked ? lockedSpCost(s) : 0), 0
        );
        totalSpForRequest = TOTAL_SP - lockedSpUsed;
        requestSkills = skills.map(s => {
          if (s.locked)              return { ...s, master_level: s.current_level };
          if (s.level_mode === 'sp') return { ...s, current_level: 0 };
          if (s.level_mode === 'auto_lv1_sp') return { ...s, current_level: 1 };
          return { ...s };
        });
      } else {
        requestSkills     = skills.map(s => ({ ...s }));
        totalSpForRequest = 0;
      }

      const body = {
        character: {
          attack_power:            1.0,
          cooldown_reduction:      stats.cooldown_reduction,
          cooldown_recovery_speed: stats.cooldown_recovery_speed,
          attack_speed:            150,
          char_level:              stats.char_level,
          mastery_contract:        !!stats.mastery_contract,
          total_sp:                totalSpForRequest,
        },
        skills:              requestSkills,
        simulation_duration: simDuration,
        auto_optimize:       autoOptimize,
      };

      const res  = await fetch('/api/simulate', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw data;

      if (autoOptimize && Array.isArray(data.optimization?.skill_levels)) {
        const lvMap   = new Map(data.optimization.skill_levels.map(sl => [sl.skill_id, sl.current_level]));
        const evolMap = new Map((data.optimization?.evolutions    ?? []).map(e => [e.skill_id, e.bloom_type]));
        const enhMap  = new Map((data.optimization?.enhancements  ?? []).map(e => [e.skill_id, e.enhancement_type]));
        setSkills(prev =>
          prev.map(s => {
            if (s.locked) return s;
            const lv = lvMap.get(s.skill_id);
            return {
              ...s,
              current_level:    lv !== undefined ? lv : s.current_level,
              bloom_type:       evolMap.get(s.skill_id) ?? 0,
              enhancement_type: enhMap.get(s.skill_id)  ?? 0,
            };
          })
        );
      }

      setResult({ ...data, _key: Date.now() });
      setRightTab('analysis');
      if (autoOptimize) {
        setToast({ msg: '스킬 자동 찍기가 완료되었습니다', key: Date.now() });
      }
    } catch (err) {
      setResult({ error: err?.error ?? 'network_error' });
    } finally {
      setLoading(false);
    }
  }, [selectedJob, skills, stats, simDuration]);

  return (
    <ThemeProvider>
      <div className="app">
        <Header
          jobs={jobs}
          selectedJob={selectedJob}
          onJobChange={job => { setSelectedJob(job); }}
        />
        <div className="main-content">

          {/* ── 왼쪽 패널: 스펙 조정 + 시뮬레이션 실행 + 결과 요약 ── */}
          <aside className="left-panel">
            <StatsPanel
              stats={stats}
              skills={skills}
              totalSp={TOTAL_SP}
              onStatsChange={setStats}
              simDuration={simDuration}
              onSimDurationChange={setSimDuration}
            />

            <div className="sim-actions">
              <button
                className="btn-simulate"
                onClick={() => handleSimulate(false)}
                disabled={loading || !selectedJob || skills.length === 0}
              >
                {loading ? '시뮬레이션 중…' : '시뮬레이션'}
              </button>
              <button
                className="btn-optimize"
                onClick={() => handleSimulate(true)}
                disabled={loading || !selectedJob || skills.length === 0}
              >
                자동 최적화
              </button>
            </div>

            {result && (
              <div className="result-summary">
                {result.error ? (
                  <div className="result-error">{result.error}</div>
                ) : (
                  <>
                    <span className="result-total-label">총 데미지 계수</span>
                    <div className="result-total">
                      {fmtCoef(result.total_damage)}
                      <span className="result-total-unit">%</span>
                    </div>
                  </>
                )}
              </div>
            )}
          </aside>

          {/* ── 오른쪽 패널: 탭 (스킬 트리 | 시뮬레이션 분석) ── */}
          <div className="right-panel">
            <div className="main-tab-bar">
              {[['tree', '스킬 습득'], ['bloom', '스킬 개화'], ['analysis', '시뮬레이션 분석']].map(([key, label]) => (
                <button
                  key={key}
                  className={`main-tab-btn${rightTab === key ? ' active' : ''}`}
                  onClick={() => setRightTab(key)}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="tab-content">
              {rightTab === 'tree' && (
                <div className="skill-tab-panel">
                  {treeLoading ? (
                    <div className="loading-center">스킬 데이터 불러오는 중…</div>
                  ) : !selectedJob ? (
                    <div className="loading-center">위에서 직업을 선택하세요</div>
                  ) : skills.length === 0 ? (
                    <div className="loading-center">스킬 데이터 없음</div>
                  ) : (
                    <>
                      <div className="skill-view-toolbar">
                        {[['tree', '트리'], ['list', '목록']].map(([mode, label]) => (
                          <button key={mode}
                            className={`view-toggle-btn${skillViewMode === mode ? ' active' : ''}`}
                            onClick={() => setSkillViewMode(mode)}
                          >{label}</button>
                        ))}
                        <div className="toolbar-spacer" />
                        <button className="skill-reset-btn" onClick={handleResetSkills}>
                          초기화
                        </button>
                      </div>
                      {skillViewMode === 'tree' ? (
                        <div className="skill-tree-panel">
                          <SkillTree
                            skills={skills}
                            selectedJob={selectedJob}
                            stats={stats}
                            onSkillLevelChange={handleSkillLevelChange}
                            onLockToggle={handleLockToggle}
                            onEnhancementChange={handleEnhancementChange}
                            onEvolutionChange={handleEvolutionChange}
                          />
                        </div>
                      ) : (
                        <SkillListView
                          skills={skills}
                          selectedJob={selectedJob}
                          stats={stats}
                          onSkillLevelChange={handleSkillLevelChange}
                          onLockToggle={handleLockToggle}
                          onEnhancementChange={handleEnhancementChange}
                          onEvolutionChange={handleEvolutionChange}
                        />
                      )}
                    </>
                  )}
                </div>
              )}
              {rightTab === 'bloom' && (
                !selectedJob ? (
                  <div className="loading-center">위에서 직업을 선택하세요</div>
                ) : skills.length === 0 ? (
                  <div className="loading-center">스킬 데이터 없음</div>
                ) : (
                  <BloomPanel
                    skills={skills}
                    selectedJob={selectedJob}
                    onEnhancementChange={handleEnhancementChange}
                    onEvolutionChange={handleEvolutionChange}
                  />
                )
              )}
              {rightTab === 'analysis' && (
                <AnalysisPanel
                  result={result}
                  simDuration={simDuration}
                  selectedJob={selectedJob}
                />
              )}
            </div>
          </div>

        </div>

        {/* ── 토스트 알림 ── */}
        {toast && (
          <div
            key={toast.key}
            className="toast"
            onAnimationEnd={() => setToast(null)}
          >
            {toast.msg}
          </div>
        )}
      </div>
    </ThemeProvider>
  );
}
