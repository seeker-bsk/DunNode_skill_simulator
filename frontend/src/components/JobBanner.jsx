import { useState } from 'react';

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

/* 캐릭터 검색 경유 시 실제 캐릭터 이미지 */
function CharacterArt({ serverId, characterId }) {
  const [err, setErr] = useState(false);
  if (err) return null;
  return (
    <img
      className="banner-job-art"
      src={`https://img-api.neople.co.kr/df/servers/${serverId}/characters/${characterId}?zoom=3`}
      alt=""
      onError={() => setErr(true)}
    />
  );
}

/* ── JobBanner: 직업 선택 후 상단 compact 배너 ── */
export default function JobBanner({
  selectedJob,
  characterName,
  characterInfo,  /* { serverId, characterId, serverName, fame } | null */
}) {
  const hasChar = !!characterInfo;

  return (
    <div className="job-banner job-banner--filled">

      {/* 배경 아트 */}
      {hasChar ? (
        <CharacterArt
          serverId={characterInfo.serverId}
          characterId={characterInfo.characterId}
        />
      ) : (
        <JobArt dataKey={selectedJob?.dataKey} />
      )}

      {/* 텍스트 오버레이 */}
      <div className="banner-filled-wrap">
        <div className="banner-info">
          {hasChar ? (
            <>
              <span className="banner-char-name">{characterName}</span>
              <div className="banner-fame">
                <span className="banner-fame-icon">⚔</span>
                {characterInfo.fame > 0 ? characterInfo.fame.toLocaleString() : '—'}
              </div>
              <div className="banner-job-name">{selectedJob?.jobName}</div>
              <div className="banner-char-type">
                {selectedJob?.characterName}
                {characterInfo.serverName && ` · ${characterInfo.serverName}`}
              </div>
            </>
          ) : (
            <>
              <div className="banner-job-name">{selectedJob?.jobName}</div>
              <div className="banner-char-type">{selectedJob?.characterName}</div>
            </>
          )}
        </div>
      </div>

    </div>
  );
}
