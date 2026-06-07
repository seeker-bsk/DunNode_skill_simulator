import { useMemo } from 'react';
import { useTheme } from '../contexts/ThemeContext';

export default function Header({ jobs, selectedJob, onJobChange }) {
  const { theme, toggle } = useTheme();

  /* characterName 기준으로 optgroup 묶기 */
  const grouped = useMemo(() => {
    const map = new Map();
    for (const j of jobs) {
      if (!map.has(j.characterName)) map.set(j.characterName, []);
      map.get(j.characterName).push(j);
    }
    return [...map.entries()];
  }, [jobs]);

  function handleChange(e) {
    const val = e.target.value;
    onJobChange(val ? jobs.find(j => j.dataKey === val) ?? null : null);
  }

  return (
    <header className="header">
      <span className="header-title">DNF 스킬 시뮬레이터</span>
      <div className="header-job-select">
        <select value={selectedJob?.dataKey ?? ''} onChange={handleChange}>
          <option value="">-- 직업 선택 --</option>
          {grouped.map(([charName, charJobs]) => (
            <optgroup key={charName} label={charName}>
              {charJobs.map(j => (
                <option key={j.dataKey} value={j.dataKey}>
                  {j.jobName}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
      <button
        className="theme-toggle"
        onClick={toggle}
        title={theme === 'dark' ? '라이트 모드로 전환' : '다크 모드로 전환'}
      >
        {theme === 'dark' ? '☀' : '🌙'}
      </button>
    </header>
  );
}
