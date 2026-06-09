import { useState } from 'react';

const CHAR_IMG_BASE = 'https://img-api.neople.co.kr/df/servers';

export default function CharacterCard({ item, onClick, loading = false }) {
  const [imgErr, setImgErr] = useState(false);
  const imgUrl = `${CHAR_IMG_BASE}/${item.serverId}/characters/${item.characterId}?zoom=2`;

  return (
    <button
      className="char-card"
      onClick={() => !loading && onClick(item)}
      disabled={loading}
      type="button"
    >
      <div className="char-card-header">
        <span className="char-card-job">{item.jobGrowName}</span>
        <span className="char-card-server">{item.serverName}</span>
      </div>
      <div className="char-card-img-wrap">
        {!imgErr ? (
          <img
            src={imgUrl}
            alt={item.characterName}
            className="char-card-img"
            onError={() => setImgErr(true)}
          />
        ) : (
          <div className="char-card-img-fallback">
            {item.jobGrowName?.[0] ?? '?'}
          </div>
        )}
      </div>
      <div className="char-card-footer">
        <div className="char-card-level">Lv. {item.level}</div>
        <div className="char-card-name">{item.characterName}</div>
      </div>
    </button>
  );
}
