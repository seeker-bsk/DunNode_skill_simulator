import { useState, useEffect, useCallback } from 'react';
import CharacterCard from './CharacterCard';

const RECENT_KEY  = 'dnf-sim-recent-chars';
const RECENT_MAX  = 8;

function loadRecent() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); }
  catch { return []; }
}

function saveRecent(item, prev) {
  const next = [item, ...prev.filter(r => r.characterId !== item.characterId)].slice(0, RECENT_MAX);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch {}
  return next;
}

/* dataKey → 스프라이트 클래스 매핑 */
const SPRITE_MAP = {
  /* 귀검사(남) — sword_man.png (1000×274, 셀 200px) */
  '41f1cdc2ff58bb5fdc287be0db2a8df3_37495b941da3b1661bc900e68ef3b2c6': 'art-sword-man-0',
  '41f1cdc2ff58bb5fdc287be0db2a8df3_618326026de1a1f1cfba5dbd0b8396e7': 'art-sword-man-1',
  '41f1cdc2ff58bb5fdc287be0db2a8df3_6d459bc74ba73ee4fe5cdc4655400193': 'art-sword-man-2',
  '41f1cdc2ff58bb5fdc287be0db2a8df3_c9b492038ee3ca8d27d7004cf58d59f3': 'art-sword-man-3',
  '41f1cdc2ff58bb5fdc287be0db2a8df3_92da05ec93fb43406e193ffb9a2a629b': 'art-sword-man-4',
};

/* ── 직업 일러스트 카드 ── */
function JobCard({ job, onClick }) {
  const spriteClass = SPRITE_MAP[job.dataKey];

  /* 스프라이트 없는 직업: 개별 파일 fallback (webp → png → 없음) */
  const [imgSrc, setImgSrc] = useState(spriteClass ? null : `/media/job_art/${job.dataKey}.webp`);
  const [noArt,  setNoArt]  = useState(false);

  const handleError = () => {
    if (imgSrc?.endsWith('.webp')) setImgSrc(`/media/job_art/${job.dataKey}.png`);
    else setNoArt(true);
  };

  const hasArt = spriteClass || (!noArt && imgSrc);

  return (
    <button className={`job-card${!hasArt ? ' job-card--no-art' : ''}`} onClick={() => onClick(job)}>
      {spriteClass ? (
        <div className={`job-card-art ${spriteClass}`} />
      ) : !noArt ? (
        <img className="job-card-img" src={imgSrc} alt="" onError={handleError} />
      ) : null}
      <div className="job-card-overlay">
        <p className="job-card-name">{job.jobName.replace(/^眞\s*/, '眞 ')}</p>
        <p className="job-card-char">{job.characterName}</p>
      </div>
    </button>
  );
}

/* ── 직업 카드 그리드 ── */
function JobGrid({ jobs, onJobChange }) {
  return (
    <div className="job-card-grid">
      {jobs.map(j => (
        <JobCard key={j.dataKey} job={j} onClick={onJobChange} />
      ))}
    </div>
  );
}

/* ── 캐릭터 검색 탭 ── */
function CharacterSearch({ jobs, onCharacterLoad }) {
  const [servers,        setServers]        = useState([]);
  const [selectedServer, setSelectedServer] = useState('all');
  const [query,          setQuery]          = useState('');
  const [searching,      setSearching]      = useState(false);
  const [selecting,      setSelecting]      = useState(null); /* 선택 중인 characterId */
  const [results,        setResults]        = useState(null); /* null=초기, []=없음 */
  const [msg,            setMsg]            = useState('');
  const [msgErr,         setMsgErr]         = useState(false);
  const [recentChars,    setRecentChars]    = useState(loadRecent);

  useEffect(() => {
    fetch('/api/character/servers')
      .then(r => r.json())
      .then(data => Array.isArray(data) ? setServers(data) : null)
      .catch(() => {});
  }, []);

  const doSearch = useCallback(async () => {
    const name = query.trim();
    if (!name) return;
    setSearching(true);
    setResults(null);
    setMsg('');
    setMsgErr(false);
    try {
      const url = `/api/character/search?name=${encodeURIComponent(name)}` +
                  (selectedServer !== 'all' ? `&server=${selectedServer}` : '');
      const res  = await fetch(url);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? '검색 실패');
      setResults(data);
      if (data.length === 0) { setMsg('검색 결과가 없습니다.'); setMsgErr(false); }
    } catch (e) {
      setResults([]);
      setMsg(e.message || '검색 중 오류가 발생했습니다.');
      setMsgErr(true);
    } finally {
      setSearching(false);
    }
  }, [query, selectedServer]);

  const handleSelect = useCallback(async (item) => {
    setSelecting(item.characterId);
    setMsg('');
    setMsgErr(false);
    try {
      const res  = await fetch(`/api/character/${item.serverId}/${item.characterId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? '캐릭터 정보 조회 실패');
      if (!data.hasData) {
        setMsg('지원하지 않는 직업입니다.');
        setMsgErr(true);
        return;
      }
      const job = jobs.find(j => j.dataKey === data.dataKey);
      if (!job) { setMsg('직업 데이터를 찾을 수 없습니다.'); setMsgErr(true); return; }

      /* 최근 검색 저장 */
      setRecentChars(prev => saveRecent(item, prev));

      onCharacterLoad({
        job,
        characterName:           item.characterName,
        serverId:                item.serverId,
        characterId:             item.characterId,
        serverName:              item.serverName,
        fame:                    data.fame ?? 0,
        skillLevels:             data.skillLevels            ?? [],
        evolutions:              data.evolutions             ?? [],
        enhancements:            data.enhancements           ?? [],
        cooldown_reduction:      data.cooldown_reduction     ?? null,
        cooldown_recovery_speed: data.cooldown_recovery_speed ?? null,
      });
    } catch (e) {
      setMsg(e.message || '오류가 발생했습니다.');
      setMsgErr(true);
    } finally {
      setSelecting(null);
    }
  }, [jobs, onCharacterLoad]);

  const showRecent  = recentChars.length > 0 && results === null;
  const showResults = results !== null && results.length > 0;

  return (
    <div className="home-search-body">

      {/* 검색 바 */}
      <div className="home-search-bar">
        <select
          className="home-server-select"
          value={selectedServer}
          onChange={e => setSelectedServer(e.target.value)}
        >
          <option value="all">전체 서버</option>
          {servers.map(s => (
            <option key={s.serverId} value={s.serverId}>{s.serverName}</option>
          ))}
        </select>
        <input
          className="home-search-input"
          type="text"
          placeholder="캐릭터 닉네임"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && doSearch()}
        />
        <button
          className="home-search-btn"
          onClick={doSearch}
          disabled={searching || !query.trim()}
        >
          {searching ? '검색 중…' : '검색'}
        </button>
      </div>

      {msg && (
        <p className={`home-search-msg${msgErr ? ' error' : ''}`}>{msg}</p>
      )}

      {/* 최근 검색 */}
      {showRecent && (
        <section className="home-section">
          <h3 className="home-section-title">최근 검색</h3>
          <div className="char-card-row">
            {recentChars.map(item => (
              <CharacterCard
                key={item.characterId}
                item={item}
                onClick={handleSelect}
                loading={selecting === item.characterId}
              />
            ))}
          </div>
        </section>
      )}

      {/* 검색 결과 */}
      {showResults && (
        <section className="home-section">
          <h3 className="home-section-title">검색 결과 ({results.length})</h3>
          <div className="char-card-grid">
            {results.map(item => (
              <CharacterCard
                key={`${item.serverId}-${item.characterId}`}
                item={item}
                onClick={handleSelect}
                loading={selecting === item.characterId}
              />
            ))}
          </div>
        </section>
      )}

    </div>
  );
}

/* ── HomePage (export) ── */
export default function HomePage({ jobs, tab, onJobChange, onCharacterLoad }) {
  return (
    <div className="home-page">
      <div className="home-body">
        {tab !== 'job' ? (
          <CharacterSearch jobs={jobs} onCharacterLoad={onCharacterLoad} />
        ) : (
          <JobGrid jobs={jobs} onJobChange={onJobChange} />
        )}
      </div>
    </div>
  );
}
