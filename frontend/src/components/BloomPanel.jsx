import { useState, useEffect, useMemo } from "react";

function toIconName(name) {
  return name.replace(/ : /g, "_").replace(/ /g, "_");
}
function buildIconUrls(skill, job) {
  if (!job) return [];
  const enc = encodeURIComponent;
  const fname = toIconName(skill.name);
  const charDir = enc(job.characterName);
  const jobDir = enc(job.jobName.replace(/^眞\s*/, ""));
  const comDir = enc(job.characterName + "공통");
  const base = "/media/skill_icon";
  return [
    `${base}/${charDir}/${jobDir}/${fname}.webp`,
    `${base}/${charDir}/${jobDir}/${fname}.png`,
    `${base}/${charDir}/${comDir}/${fname}.webp`,
    `${base}/${charDir}/${comDir}/${fname}.png`,
    `${base}/공통/${fname}.webp`,
    `${base}/공통/${fname}.png`,
  ];
}

function SkillIcon({ skill, job }) {
  const [iconIdx, setIconIdx] = useState(0);
  const urls = useMemo(() => buildIconUrls(skill, job), [skill.skill_id, job]);
  useEffect(() => setIconIdx(0), [skill.skill_id]);

  if (!urls.length || iconIdx >= urls.length) {
    return <div className="bloom-icon-fallback">{skill.name.slice(0, 2)}</div>;
  }
  return (
    <img
      className="bloom-icon"
      src={urls[iconIdx]}
      alt={skill.name}
      draggable={false}
      onError={() => setIconIdx((i) => i + 1)}
    />
  );
}

function BloomRow({ skill, job, value, options, onChange }) {
  return (
    <div className="bloom-grid-row">
      <div className="bloom-skill-cell">
        <SkillIcon skill={skill} job={job} />
        <span className="bloom-skill-name">{skill.name}</span>
      </div>
      {options.map(([label, i, color]) => (
        <button
          key={i}
          className={`bloom-opt-btn ${color}${value === i ? " active" : ""}`}
          onClick={() => onChange(skill.skill_id, value === i ? 0 : i)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export default function BloomPanel({
  skills,
  selectedJob,
  onEnhancementChange,
  onEvolutionChange,
}) {
  const evolveSkills = useMemo(
    () => skills.filter((s) => s.can_evolve),
    [skills],
  );
  const enhanceSkills = useMemo(
    () => skills.filter((s) => s.can_enhance),
    [skills],
  );

  if (!evolveSkills.length && !enhanceSkills.length) {
    return <div className="loading-center">개화/강화 가능한 스킬 없음</div>;
  }

  return (
    <div className="bloom-panel">
      {evolveSkills.length > 0 && (
        <>
          <h3 className="bloom-section-title bloom-section-title-violet">
            스킬 개화
          </h3>
          <div className="bloom-grid">
            {evolveSkills.map((skill) => (
              <BloomRow
                key={skill.skill_id}
                skill={skill}
                job={selectedJob}
                value={skill.bloom_type || 0}
                options={[
                  [skill.bloom_option_1?.name || "개화 I", 1, "violet"],
                  [skill.bloom_option_2?.name || "개화 II", 2, "violet"],
                ]}
                onChange={onEvolutionChange}
              />
            ))}
          </div>
        </>
      )}

      {evolveSkills.length > 0 && enhanceSkills.length > 0 && (
        <hr className="bloom-divider" />
      )}

      {enhanceSkills.length > 0 && (
        <>
          <h3 className="bloom-section-title bloom-section-title-enhance">스킬 강화</h3>
          <div className="bloom-grid">
            {enhanceSkills.map((skill) => {
              const e1 = skill.enhancement_atk_1
                ? `+${Math.round(skill.enhancement_atk_1 * 100)}% 공격력`
                : "강화 I";
              const e2 = skill.enhancement_atk_2
                ? `+${Math.round(skill.enhancement_atk_2 * 100)}% +CDR`
                : "강화 II";
              return (
                <BloomRow
                  key={skill.skill_id}
                  skill={skill}
                  job={selectedJob}
                  value={skill.enhancement_type || 0}
                  options={[
                    [e1, 1, "red"],
                    [e2, 2, "blue"],
                  ]}
                  onChange={onEnhancementChange}
                />
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
