function getSkillName(skillId, skills) {
  return skills.find(s => s.skill_id === skillId)?.name ?? skillId.slice(0, 8) + '…';
}

export default function ResultPanel({ result, loading, skills, onSimulate, onAutoOptimize }) {
  const hasResult = result && !result.error && result.total_damage != null;
  const spAlloc   = result?.optimization?.sp_allocation;

  return (
    <div className="result-panel">
      <h3>시뮬레이션</h3>

      {/* 실행 버튼 */}
      <div className="result-buttons">
        <button
          className="btn-simulate"
          onClick={onSimulate}
          disabled={loading || skills.length === 0}
        >
          {loading ? '계산 중…' : '시뮬레이션'}
        </button>
        <button
          className="btn-optimize"
          onClick={onAutoOptimize}
          disabled={loading || skills.length === 0}
          title="SP를 자동으로 배분해 최적 스킬트리를 계산합니다"
        >
          {loading ? '계산 중…' : '자동 최적화'}
        </button>
      </div>

      {/* 에러 */}
      {result?.error && (
        <div className="result-error">
          오류: {result.error}
        </div>
      )}

      {/* 정상 결과 */}
      {hasResult && (
        <div className="result-appear">
          <div className="result-total">
            <span className="result-total-label">총 데미지</span>
            {Math.round(result.total_damage).toLocaleString()}
          </div>

          {/* SP 배분 결과 (자동 최적화 시) */}
          {spAlloc && (
            <div className="sp-alloc-info">
              <span>SP 사용: {spAlloc.sp_used} / 남음: {spAlloc.sp_remaining}</span>
              <span>마스터 스킬 수: {spAlloc.skills_mastered}개</span>
            </div>
          )}

          {/* 스킬별 기여도 */}
          {Array.isArray(result.skill_stats) && result.skill_stats.length > 0 && (
            <div className="contribution-list">
              {[...result.skill_stats]
                .sort((a, b) => b.contribution_pct - a.contribution_pct)
                .map(s => (
                  <div key={s.skill_id} className="contribution-row">
                    <span className="contribution-name">
                      {getSkillName(s.skill_id, skills)}
                    </span>
                    <span className="contribution-pct">
                      {s.contribution_pct.toFixed(1)}%
                    </span>
                    <span className="contribution-count">
                      ×{s.use_count}
                    </span>
                    <div className="contribution-bar-wrap">
                      <div
                        className="contribution-bar"
                        style={{ width: `${s.contribution_pct}%` }}
                      />
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
