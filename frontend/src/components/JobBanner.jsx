import { useState, useRef, useCallback } from 'react';

const SERVERS = [
  { id: 'cain',     name: '카인' },
  { id: 'diregie',  name: '디레지에' },
  { id: 'bakal',    name: '바칼' },
  { id: 'hilder',   name: '힐더' },
  { id: 'anton',    name: '안톤' },
  { id: 'luke',     name: '루크' },
  { id: 'sirocco',  name: '시로코' },
  { id: 'casillas', name: '카시야스' },
];

/* 직업 아트 이미지: webp → png fallback */
function JobArt({ dataKey }) {
  const [ext, setExt] = useState('webp');
  if (!dataKey || ext === null) return null;
  return (
    <img
      className="banner-job-art"
      src={`/media/job_art/${dataKey}.${ext}`}
      alt=""
      onError={() => ext === 'webp' ? setExt('png') : setExt(null)}
    />
  );
}

/* ── 직업 카드 그리드 ── */
function JobGrid({ jobs, onJobChange }) {
  const grouped = new Map();
  for (const j of jobs) {
    if (!grouped.has(j.characterName)) grouped.set(j.characterName, []);
    grouped.get(j.characterName).push(j);
  }

  return (
    <div className="job-card-grid">
      {[...grouped.entries()].map(([charName, charJobs]) =>
        charJobs.map(j => (
          <button key={j.dataKey} className="job-card" onClick={() => onJobChange(j)}>
            <span className="job-card-char">{charName}</span>
            <span className="job-card-name">{j.jobName.replace(/^眞\s*/, '眞 ')}</span>
          </button>
        ))
      )}
    </div>
  );
}

/* ── 캐릭터 검색 폼 ── */
function CharacterSearchForm({ jobs, onCharacterLoad }) {
  const [server,  setServer]  = useState('cain');
  const [query,   setQuery]   = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null); /* null=초기, []=없음, [...]=결과 */
  const [msg,     setMsg]     = useState('');
  const [msgType, setMsgType] = useState(''); /* '' | 'error' */
  const inputRef = useRef(null);

  const doSearch = useCallback(async () => {
    const name = query.trim();
    if (!name) return;
    setLoading(true);
    setResults(null);
    setMsg('');
    try {
      const res  = await fetch(`/api/character/search?name=${encodeURIComponent(name)}&server=${server}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? '검색 실패');
      setResults(data.slice(0, 10));
      if (data.length === 0) setMsg('검색 결과가 없습니다.');
    } catch (e) {
      setResults([]);
      setMsg(e.message || '검색 중 오류가 발생했습니다.');
      setMsgType('error');
    } finally {
      setLoading(false);
    }
  }, [server, query]);

  const handleSelect = useCallback(async (item) => {
    setLoading(true);
    setMsg('');
    try {
      const res  = await fetch(`/api/character/${item.serverId}/${item.characterId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? '캐릭터 정보 조회 실패');

      if (!data.hasData) {
        setMsg('지원하지 않는 직업입니다. 직업을 직접 선택해 주세요.');
        setMsgType('error');
        return;
      }

      const job = jobs.find(j => j.dataKey === data.dataKey);
      if (!job) {
        setMsg('직업 데이터를 찾을 수 없습니다.');
        setMsgType('error');
        return;
      }

      onCharacterLoad({
        job,
        characterName: item.characterName,
        skillLevels:   data.skillLevels ?? [],
      });
    } catch (e) {
      setMsg(e.message || '오류가 발생했습니다.');
      setMsgType('error');
    } finally {
      setLoading(false);
    }
  }, [jobs, onCharacterLoad]);

  return (
    <div>
      <div className="banner-search-form">
        <select value={server} onChange={e => setServer(e.target.value)}>
          {SERVERS.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <input
          ref={inputRef}
          type="text"
          placeholder="캐릭터 닉네임"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && doSearch()}
        />
        <button
          className="banner-search-btn"
          onClick={doSearch}
          disabled={loading || !query.trim()}
        >
          {loading ? '검색 중…' : '검색'}
        </button>
      </div>

      {msg && (
        <div className={`banner-search-msg${msgType === 'error' ? ' error' : ''}`}>
          {msg}
        </div>
      )}

      {results && results.length > 0 && (
        <div className="banner-search-results">
          {results.map(item => (
            <button
              key={item.characterId}
              className="banner-search-result-item"
              onClick={() => handleSelect(item)}
              disabled={loading}
            >
              <span className="banner-result-name">{item.characterName}</span>
              <span className="banner-result-job">· {item.jobGrowName ?? item.jobName}</span>
              <span className="banner-result-server">{item.serverName ?? item.serverId}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── JobBanner (export) ── */
export default function JobBanner({
  jobs,
  selectedJob,
  characterName,
  onJobChange,
  onCharacterLoad,
  onClear,
}) {
  const [bannerTab, setBannerTab] = useState('job-select'); /* 'search' | 'job-select' */

  /* 직업 선택됨 → 배너 정보 표시 */
  if (selectedJob) {
    return (
      <div className="job-banner job-banner--filled">
        <JobArt dataKey={selectedJob.dataKey} />
        <div className="banner-filled-wrap">
          <div className="banner-info">
            {characterName && (
              <span className="banner-char-name">{characterName}</span>
            )}
            <div className="banner-job-name">{selectedJob.jobName}</div>
            <div className="banner-char-type">{selectedJob.characterName}</div>
          </div>
          <button className="banner-change-btn" onClick={onClear}>변경</button>
        </div>
      </div>
    );
  }

  /* 직업 미선택 → 선택 화면 */
  return (
    <div className="job-banner job-banner--select">
      <div className="banner-select-tabs">
        {[['job-select', '직업 선택'], ['search', '캐릭터 검색']].map(([key, label]) => (
          <button
            key={key}
            className={`banner-tab-btn${bannerTab === key ? ' active' : ''}`}
            onClick={() => setBannerTab(key)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="banner-select-body">
        {bannerTab === 'job-select' ? (
          <JobGrid jobs={jobs} onJobChange={onJobChange} />
        ) : (
          <CharacterSearchForm
            jobs={jobs}
            onCharacterLoad={(payload) => {
              onCharacterLoad(payload);
            }}
          />
        )}
      </div>
    </div>
  );
}
