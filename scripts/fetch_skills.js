'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');

function loadEnv() {
  const envPath = path.resolve(__dirname, '../.env');
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const m = line.match(/^([^=#]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim();
  }
}

function parseArgs() {
  const args = {};
  for (const arg of process.argv.slice(2)) {
    const m = arg.match(/^--(\w+)=(.+)$/);
    if (m) args[m[1]] = m[2];
  }
  return args;
}

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`JSON parse error: ${data.slice(0, 300)}`)); }
      });
    }).on('error', reject);
  });
}

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function normalizeEntry(entry) {
  return {
    level: entry.level,
    coolTime: entry.coolTime ?? null,
    castingTime: entry.castingTime ?? null,
    optionValue: entry.optionValue ?? {}
  };
}

/* 전 레벨 저장 — 선형 보간 없이 레벨별 정확한 수치 사용 */
function allLevelData(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  return rows.map(normalizeEntry);
}

async function main() {
  loadEnv();
  const { jobId, jobGrowId } = parseArgs();

  if (!jobId || !jobGrowId) {
    console.error('Usage: node fetch_skills.js --jobId=<id> --jobGrowId=<id>');
    process.exit(1);
  }

  const apiKey = process.env.NEOPLE_API_KEY;
  if (!apiKey) {
    console.error('NEOPLE_API_KEY not set in .env');
    process.exit(1);
  }

  const BASE = 'https://api.neople.co.kr/df';

  /* 1. 스킬 목록 조회 */
  console.log(`Fetching skill list...  jobId=${jobId}  jobGrowId=${jobGrowId}`);
  const listData = await get(`${BASE}/skills/${jobId}?jobGrowId=${jobGrowId}&apikey=${apiKey}`);

  if (!listData.skills) {
    console.error('Unexpected response:', JSON.stringify(listData).slice(0, 300));
    process.exit(1);
  }

  const activeSkills = listData.skills;
  console.log(`Total skills: ${activeSkills.length}`);

  /* 2. 스킬별 상세 조회 */
  const results = [];
  for (let i = 0; i < activeSkills.length; i++) {
    const skill = activeSkills[i];
    process.stdout.write(`  [${i + 1}/${activeSkills.length}] ${skill.name} ... `);

    const detail = await get(`${BASE}/skills/${jobId}/${skill.skillId}?apikey=${apiKey}`);

    const levelInfo = detail.levelInfo ?? {};
    results.push({
      skillId:            skill.skillId,             // 목록 응답에만 존재
      name:               detail.name,
      type:               detail.type,
      requiredLevel:      detail.requiredLevel,
      requiredLevelRange: detail.requiredLevelRange ?? 1,
      maxLevel:           detail.maxLevel,
      preRequiredSkill:   detail.preRequiredSkill ?? null,
      levelData:          allLevelData(levelInfo.rows),
      optionDesc:         levelInfo.optionDesc ?? null,
      evolution:          detail.evolution ?? null,
      enhancement:        detail.enhancement ?? null
    });

    console.log('done');
    await delay(120); /* API 부하 방지 */
  }

  /* 3. 저장 */
  const outDir = path.resolve(__dirname, '../data/skills');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${jobGrowId}_base.json`);
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2), 'utf8');
  console.log(`\nSaved → ${outPath}  (${results.length} skills)`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
