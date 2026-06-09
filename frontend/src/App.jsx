import { useState, useEffect, useCallback } from 'react';
import { ThemeProvider } from './contexts/ThemeContext';
import Header from './components/Header';
import HomePage from './components/HomePage';
import JobBanner from './components/JobBanner';
import SkillTree from './components/SkillTree';
import AnalysisPanel from './components/AnalysisPanel';
import BloomPanel from './components/BloomPanel';
import SkillListView from './components/SkillListView';
import { DamageCard, SpCard, StatsCard, SimCard } from './components/StatsPanel';

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
  const perLv = s.sp_cost_per_level || 1;
  if (lm === 'auto_lv1_sp') return perLv * Math.max(0, lv - 1);
  const lv1 = s.sp_cost_lv1 > 0 ? s.sp_cost_lv1 : perLv;
  return lv1 + (lv - 1) * perLv;
}

export default function App() {
  const [jobs,           setJobs]           = useState([]);
  const [selectedJob,    setSelectedJob]    = useState(null);
  const [characterName,  setCharacterName]  = useState(null); /* 캐릭터 검색 경유 시 닉네임 */
  const [pendingLevels,       setPendingLevels]       = useState(null);  /* 검색 후 적용할 스킬 레벨/개화/강화 */
  const [pendingAutoSimulate, setPendingAutoSimulate] = useState(false); /* 검색 로드 후 자동 시뮬 1회 */
  const [characterInfo,       setCharacterInfo]       = useState(null);  /* { serverId, characterId, serverName, fame } */
  const [skills,         setSkills]         = useState([]);
  const [stats,          setStats]          = useState(DEFAULT_STATS);
  const [simDuration,    setSimDuration]    = useState(43);
  const [result,         setResult]         = useState(null);
  const [loading,        setLoading]        = useState(false);
  const [treeLoading,    setTreeLoading]    = useState(false);
  const [baselineResult, setBaselineResult] = useState(null);  /* 캐릭터 검색 후 첫 시뮬 결과 */
  const [homeTab,        setHomeTab]        = useState('search'); /* 'search' | 'job' */
  const [mainTab,        setMainTab]        = useState('tree');  /* 'tree' | 'bloom' | 'sim' */
  const [skillViewMode,  setSkillViewMode]  = useState('tree');
  const [toast,          setToast]          = useState(null);

  /* 직업 목록 로드 — 완료 후 sessionStorage에서 마지막 세션 복구 */
  useEffect(() => {
    fetch('/jobs')
      .then(r => r.json())
      .then(data => {
        const filtered = data.filter(j => j.hasData);
        setJobs(filtered);
        try {
          const saved = JSON.parse(sessionStorage.getItem('sim-session') || 'null');
          if (saved?.dataKey) {
            const job = filtered.find(j => j.dataKey === saved.dataKey);
            if (job) {
              /* 스킬 레벨 스냅샷 → pendingLevels로 주입 (트리 로드 후 적용됨) */
              if (saved.skillSnapshot?.length) {
                setPendingLevels({
                  levels:       saved.skillSnapshot.map(s => ({ skillId: s.skill_id, level: s.current_level })),
                  evolutions:   saved.skillSnapshot.filter(s => s.bloom_type > 0).map(s => ({ skillId: s.skill_id, type: s.bloom_type })),
                  enhancements: saved.skillSnapshot.filter(s => s.enhancement_type > 0).map(s => ({ skillId: s.skill_id, type: s.enhancement_type })),
                });
              }
              /* 캐릭터 스탯 복구 */
              if (saved.statsOverride) {
                setStats(prev => ({ ...prev, ...saved.statsOverride }));
              }
              setSelectedJob(job);
              if (saved.characterName) setCharacterName(saved.characterName);
              if (saved.characterInfo) setCharacterInfo(saved.characterInfo);
            }
          }
        } catch {}
      })
      .catch(() => {});
  }, []);

  /* 직업 변경 시 스킬 트리 로드 */
  useEffect(() => {
    if (!selectedJob) { setSkills([]); setResult(null); return; }
    setTreeLoading(true);
    setResult(null);
    fetch(`/tree/${selectedJob.dataKey}`)
      .then(r => r.json())
      .then(data => {
        let mapped = data.map(s => ({
          ...s,
          current_level: s.level_mode === 'auto_lv1_sp' && s.current_level === 0
            ? 1 : s.current_level,
          locked: false,
        }));
        /* 캐릭터 검색 경유 시 스킬 레벨/개화/강화 일괄 적용 */
        if (pendingLevels) {
          const { levels, evolutions, enhancements } = pendingLevels;
          const lvMap   = new Map(levels.map(sl => [sl.skillId, sl.level]));
          const evolMap = new Map(evolutions.map(e  => [e.skillId,  e.type]));
          const enhMap  = new Map(enhancements.map(e => [e.skillId, e.type]));
          mapped = mapped.map(s => {
            const lv  = lvMap.get(s.skill_id);
            const ev  = evolMap.get(s.skill_id);
            const enh = enhMap.get(s.skill_id);
            return {
              ...s,
              current_level:    lv  !== undefined ? lv  : s.current_level,
              bloom_type:       ev  !== undefined ? ev  : s.bloom_type,
              enhancement_type: enh !== undefined ? enh : s.enhancement_type,
            };
          });
          setPendingLevels(null);
        }
        setSkills(mapped);
      })
      .catch(() => setSkills([]))
      .finally(() => setTreeLoading(false));
  }, [selectedJob]);

  /* 캐릭터 로드 후 자동 시뮬레이션 1회 — handleSimulate는 아래서 정의되지만 동일 렌더 스코프 내에서 유효 */
  useEffect(() => {
    if (!pendingAutoSimulate) return;
    if (skills.length === 0 || treeLoading) return;
    setPendingAutoSimulate(false);
    handleSimulate(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAutoSimulate, skills.length, treeLoading]);

  /* 스킬/스탯 변경 시 sessionStorage 스냅샷 저장 (debounced 500ms) */
  useEffect(() => {
    if (skills.length === 0 || !selectedJob) return;
    const timer = setTimeout(() => {
      try {
        const snapshot = skills.map(s => ({
          skill_id:         s.skill_id,
          current_level:    s.current_level,
          bloom_type:       s.bloom_type,
          enhancement_type: s.enhancement_type,
        }));
        const statsOverride = {
          cooldown_reduction:      stats.cooldown_reduction,
          cooldown_recovery_speed: stats.cooldown_recovery_speed,
        };
        const current = JSON.parse(sessionStorage.getItem('sim-session') || '{}');
        sessionStorage.setItem('sim-session', JSON.stringify({
          ...current,
          skillSnapshot: snapshot,
          statsOverride,
        }));
      } catch {}
    }, 500);
    return () => clearTimeout(timer);
  }, [skills, stats, selectedJob]);

  /* ── 핸들러 ── */
  const handleSkillLevelChange = useCallback((skillId, newLevel) => {
    setSkills(prev => prev.map(s => s.skill_id === skillId ? { ...s, current_level: newLevel } : s));
  }, []);

  const handleLockToggle = useCallback((skillId) => {
    setSkills(prev => prev.map(s => s.skill_id === skillId ? { ...s, locked: !s.locked } : s));
  }, []);

  const handleEnhancementChange = useCallback((skillId, type) => {
    setSkills(prev => prev.map(s => s.skill_id === skillId ? { ...s, enhancement_type: type } : s));
  }, []);

  const handleEvolutionChange = useCallback((skillId, type) => {
    setSkills(prev => prev.map(s => s.skill_id === skillId ? { ...s, bloom_type: type } : s));
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

  /* 직업 직접 선택 */
  const handleJobChange = useCallback((job) => {
    setCharacterName(null);
    setCharacterInfo(null);
    setPendingLevels(null);
    setPendingAutoSimulate(false);
    setBaselineResult(null);
    setSelectedJob(job);
    try { sessionStorage.setItem('sim-session', JSON.stringify({ dataKey: job.dataKey })); } catch {}
  }, []);

  /* 캐릭터 검색으로 로드 */
  const handleCharacterLoad = useCallback(({
    job, characterName: name,
    serverId, characterId, serverName, fame,
    skillLevels, evolutions, enhancements,
    cooldown_reduction, cooldown_recovery_speed,
  }) => {
    setPendingLevels({ levels: skillLevels ?? [], evolutions: evolutions ?? [], enhancements: enhancements ?? [] });
    setCharacterName(name);
    setCharacterInfo({ serverId, characterId, serverName, fame: fame ?? 0 });
    setBaselineResult(null);
    /* 쿨타임 감소 / 회복 속도 자동 적용 */
    if (cooldown_reduction !== null || cooldown_recovery_speed !== null) {
      setStats(prev => ({
        ...prev,
        ...(cooldown_reduction      !== null ? { cooldown_reduction:      Math.min(0.70, Math.max(0, cooldown_reduction      / 100)) } : {}),
        ...(cooldown_recovery_speed !== null ? { cooldown_recovery_speed: Math.min(200,  Math.max(0, cooldown_recovery_speed))        } : {}),
      }));
    }
    setPendingAutoSimulate(true);
    setSelectedJob(job);
    try {
      sessionStorage.setItem('sim-session', JSON.stringify({
        dataKey:       job.dataKey,
        characterName: name,
        characterInfo: { serverId, characterId, serverName, fame: fame ?? 0 },
      }));
    } catch {}
    setToast({ msg: `${name}님의 스킬 트리를 불러왔습니다`, key: Date.now() });
  }, []);

  /* 직업 변경 ([변경] 버튼) */
  const handleClear = useCallback(() => {
    setSelectedJob(null);
    setCharacterName(null);
    setCharacterInfo(null);
    setPendingLevels(null);
    setPendingAutoSimulate(false);
    setBaselineResult(null);
    setSkills([]);
    setResult(null);
    try { sessionStorage.removeItem('sim-session'); } catch {}
  }, []);

  /* 시뮬레이션 실행 */
  const handleSimulate = useCallback(async (autoOptimize = false) => {
    if (!selectedJob || skills.length === 0) return;
    setLoading(true);
    try {
      let requestSkills;
      let totalSpForRequest;

      if (autoOptimize) {
        const lockedSpUsed = skills.reduce((acc, s) => acc + (s.locked ? lockedSpCost(s) : 0), 0);
        totalSpForRequest  = TOTAL_SP - lockedSpUsed;
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
        const evolMap = new Map((data.optimization?.evolutions   ?? []).map(e => [e.skill_id, e.bloom_type]));
        const enhMap  = new Map((data.optimization?.enhancements ?? []).map(e => [e.skill_id, e.enhancement_type]));
        setSkills(prev => prev.map(s => {
          if (s.locked) return s;
          const lv = lvMap.get(s.skill_id);
          return {
            ...s,
            current_level:    lv !== undefined ? lv : s.current_level,
            bloom_type:       evolMap.get(s.skill_id) ?? 0,
            enhancement_type: enhMap.get(s.skill_id)  ?? 0,
          };
        }));
      }

      setResult({ ...data, _key: Date.now() });
      /* 캐릭터 검색 후 첫 시뮬레이션 → 베이스라인 저장 */
      setBaselineResult(prev => (characterName && !prev) ? { ...data } : prev);
      setMainTab('sim');
      if (autoOptimize) setToast({ msg: '스킬 자동 찍기가 완료되었습니다', key: Date.now() });
    } catch (err) {
      setResult({ error: err?.error ?? 'network_error' });
    } finally {
      setLoading(false);
    }
  }, [selectedJob, skills, stats, simDuration]);

  const canRun = !loading && !!selectedJob && skills.length > 0;

  return (
    <ThemeProvider>
      <div className={`app${selectedJob ? '' : ' no-job'}`}>

        {/* ── 헤더 ── */}
        <Header
          showHomeTabs={!selectedJob}
          homeTab={homeTab}
          onHomeTabChange={setHomeTab}
          onLogoClick={handleClear}
        />

        {/* ── 홈 (직업 미선택) or compact 배너 (직업 선택 후) ── */}
        {!selectedJob ? (
          <HomePage
            jobs={jobs}
            tab={homeTab}
            onJobChange={handleJobChange}
            onCharacterLoad={handleCharacterLoad}
          />
        ) : (
          <JobBanner
            selectedJob={selectedJob}
            characterName={characterName}
            characterInfo={characterInfo}
          />
        )}

        {/* ── 전체 폭 탭 바 (배너 아래, 직업 선택 후) ── */}
        {selectedJob && (
          <div className="page-tab-bar">
            <div className="page-tab-inner">
              {[
                ['tree',  '스킬 트리'],
                ['bloom', '스킬 개화'],
                ['sim',   '시뮬레이션'],
              ].map(([key, label]) => (
                <button key={key}
                  className={`page-tab-btn${mainTab === key ? ' active' : ''}`}
                  onClick={() => setMainTab(key)}
                >{label}</button>
              ))}
            </div>
          </div>
        )}

        {/* ── 콘텐츠 영역 (직업 선택 후만 렌더) ── */}
        {selectedJob && (
          <div className="content-area">

            {/* 사이드바 */}
            <aside className="sidebar">
              <DamageCard result={result} baselineResult={baselineResult} characterName={characterName} />
              <SpCard skills={skills} totalSp={TOTAL_SP} />
              <StatsCard stats={stats} onStatsChange={setStats} />
              <SimCard
                simDuration={simDuration}
                onSimDurationChange={setSimDuration}
                loading={loading}
                canRun={canRun}
                onSimulate={handleSimulate}
                result={result}
              />
            </aside>

            {/* 메인 영역 */}
            <div className="main-area">
              <div className="tab-content">

                {/* 스킬 트리 탭 */}
                {mainTab === 'tree' && (
                  <div className="skill-tab-panel">
                    {treeLoading ? (
                      <div className="loading-center">스킬 데이터 불러오는 중…</div>
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

                {/* 스킬 개화 탭 */}
                {mainTab === 'bloom' && (
                  skills.length === 0 ? (
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

                {/* 시뮬레이션 탭 */}
                {mainTab === 'sim' && (
                  <AnalysisPanel
                    result={result}
                    simDuration={simDuration}
                    selectedJob={selectedJob}
                  />
                )}

              </div>
            </div>

          </div>
        )}

        {/* ── 토스트 ── */}
        {toast && (
          <div key={toast.key} className="toast" onAnimationEnd={() => setToast(null)}>
            {toast.msg}
          </div>
        )}

      </div>
    </ThemeProvider>
  );
}
