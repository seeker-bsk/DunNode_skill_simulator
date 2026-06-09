"use strict";

require("dotenv").config({
  path: require("path").join(__dirname, "..", ".env"),
});

const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const app = express();
const PORT = 5000;
const TIMEOUT_MS = 5000;
const SIMULATOR_PATH = path.join(__dirname, "..", "core", "simulator.exe");
const DATA_DIR = path.join(__dirname, "..", "data", "skills");
const JOBS_FILE = path.join(__dirname, "..", "data", "jobs.json");
const SCRIPTS_DIR = path.join(__dirname, "..", "scripts");

app.use(cors());
app.use(express.json());
app.use("/media", express.static(path.join(__dirname, "..", "media")));

/* jobGrowId는 32자리 hex 문자열만 허용 (경로 순회 방지) */
function isValidJobGrowId(id) {
  return typeof id === "string" && /^[0-9a-f]{32}$/.test(id);
}

/* ── C 코어 subprocess 호출 헬퍼 ─────────────────────────────────────── */
function runSimulator(payload) {
  return new Promise((resolve, reject) => {
    const child = spawn(SIMULATOR_PATH);
    let output = "";

    const timer = setTimeout(() => {
      child.kill();
      reject(Object.assign(new Error("timeout"), { statusCode: 504 }));
    }, TIMEOUT_MS);

    child.stdout.on("data", (chunk) => {
      output += chunk;
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        let body;
        try {
          body = JSON.parse(output);
        } catch {
          body = { error: "simulator_error" };
        }
        return reject(
          Object.assign(new Error("simulator error"), {
            statusCode: 502,
            body,
          }),
        );
      }
      resolve(output);
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(Object.assign(err, { statusCode: 503 }));
    });

    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

/* ── GET /ping ───────────────────────────────────────────────────────── */
app.get("/ping", (_req, res) => {
  res.json({ status: "ok" });
});

/* ── GET /jobs ────────────────────────────────────────────────────────
 * jobs.json 전체 반환. hasData 필드를 동적으로 추가한다. */
app.get("/jobs", (_req, res) => {
  try {
    const jobs = JSON.parse(fs.readFileSync(JOBS_FILE, "utf8"));
    const result = jobs.map((j) => ({
      ...j,
      hasData: fs.existsSync(path.join(DATA_DIR, `${j.dataKey}_merged.json`)),
    }));
    res.json(result);
  } catch {
    res.status(500).json({ error: "jobs_load_error" });
  }
});

/* ── GET /tree/:dataKey ───────────────────────────────────────────────
 * dataKey = {jobId}_{jobGrowId}. 직업별 merged.json을 그대로 반환한다. */
app.get("/tree/:dataKey", (req, res) => {
  const { dataKey } = req.params;
  if (!/^[0-9a-f]{32}_[0-9a-f]{32}$/.test(dataKey)) {
    return res.status(400).json({ error: "invalid_data_key" });
  }

  const filePath = path.join(DATA_DIR, `${dataKey}_merged.json`);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "not_found", dataKey });
  }

  try {
    const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
    res.json(data);
  } catch {
    res.status(500).json({ error: "parse_error" });
  }
});

/* ── POST /api/simulate ───────────────────────────────────────────────
 * 요청 body를 그대로 C 코어 stdin에 전달하고 stdout을 반환한다.
 * 비즈니스 로직은 C 코어에만 있다. */
app.post("/api/simulate", async (req, res) => {
  if (!req.body || typeof req.body !== "object") {
    return res.status(400).json({ error: "invalid_input", field: "body" });
  }

  try {
    const output = await runSimulator(req.body);
    const result = JSON.parse(output);
    res.json(result);
  } catch (err) {
    const status = err.statusCode ?? 500;
    const body = err.body ?? { error: err.message ?? "internal_error" };
    res.status(status).json(body);
  }
});

/* ── POST /skills/rebuild/:dataKey ───────────────────────────────────
 * merge_skills.js를 실행해 merged.json을 재생성한다.
 * dataKey = {jobId}_{jobGrowId} */
app.post("/skills/rebuild/:dataKey", (req, res) => {
  const { dataKey } = req.params;
  if (!/^[0-9a-f]{32}_[0-9a-f]{32}$/.test(dataKey)) {
    return res.status(400).json({ error: "invalid_data_key" });
  }
  const [jobId, jobGrowId] = dataKey.split("_");

  const scriptPath = path.join(SCRIPTS_DIR, "merge_skills.js");
  const child = spawn("node", [
    scriptPath,
    `--jobId=${jobId}`,
    `--jobGrowId=${jobGrowId}`,
  ]);
  let stdout = "";
  let stderr = "";

  const timer = setTimeout(() => {
    child.kill();
    if (!res.headersSent) res.status(504).json({ error: "timeout" });
  }, TIMEOUT_MS);

  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  child.on("close", (code) => {
    clearTimeout(timer);
    if (res.headersSent) return;
    if (code !== 0) {
      return res
        .status(500)
        .json({ error: "merge_failed", detail: stderr.trim() });
    }
    res.json({ status: "ok", dataKey, log: stdout.trim() });
  });

  child.on("error", () => {
    clearTimeout(timer);
    if (!res.headersSent)
      res.status(503).json({ error: "merge_script_not_found" });
  });
});

/* ── Neople API ───────────────────────────────────────────────────── */
const NEOPLE_BASE = "https://api.neople.co.kr/df";
const NEOPLE_TIMEOUT_MS = 8000;

/* 서버 목록 캐시 — 첫 요청 시 로드, 이후 재사용 */
let serverCache = null;

/* merged.json 존재 여부로 "지원 직업" 판정 */
function hasJobData(dataKey) {
  return (
    /^[0-9a-f]{32}_[0-9a-f]{32}$/.test(dataKey) &&
    fs.existsSync(path.join(DATA_DIR, `${dataKey}_merged.json`))
  );
}

/* jobs.json 중 merged.json이 있는 직업 목록 반환 */
function getSupportedJobs() {
  try {
    const jobs = JSON.parse(fs.readFileSync(JOBS_FILE, "utf8"));
    return jobs.filter((j) => hasJobData(j.dataKey));
  } catch {
    return [];
  }
}

async function neopleGet(endpoint) {
  const key = process.env.NEOPLE_API_KEY;
  if (!key)
    throw Object.assign(new Error("NEOPLE_API_KEY not configured"), {
      statusCode: 503,
    });

  const sep = endpoint.includes("?") ? "&" : "?";
  const url = `${NEOPLE_BASE}${endpoint}${sep}apikey=${key}`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(NEOPLE_TIMEOUT_MS),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw Object.assign(new Error(body?.message ?? "neople_api_error"), {
      statusCode: res.status,
    });
  }
  return body;
}

/* Neople /servers → [{ serverId, serverName }] (캐시) */
async function fetchServers() {
  if (serverCache) return serverCache;
  const data = await neopleGet("/servers");
  serverCache = (data.rows ?? []).map((s) => ({
    serverId: s.serverId,
    serverName: s.serverName,
  }));
  return serverCache;
}

/* ── GET /api/character/servers ──────────────────────────────────── */
app.get("/api/character/servers", async (_req, res) => {
  try {
    res.json(await fetchServers());
  } catch (err) {
    res
      .status(err.statusCode ?? 500)
      .json({ error: err.message ?? "servers_error" });
  }
});

/* ── GET /api/character/search?name=<name>&server=<serverId|all> ─
 * server 지정 시 해당 서버만 검색, 미지정/'all' 시 전 서버 병렬 검색 */
app.get("/api/character/search", async (req, res) => {
  const { name, server } = req.query;
  if (!name) return res.status(400).json({ error: "missing_params" });

  try {
    const [allServers, supportedJobs] = await Promise.all([
      fetchServers(),
      Promise.resolve(getSupportedJobs()),
    ]);

    if (supportedJobs.length === 0) return res.json([]);

    /* server 파라미터로 대상 서버 필터링 */
    const targetServers =
      server && server !== "all" && /^[a-z]+$/.test(server)
        ? allServers.filter((s) => s.serverId === server)
        : allServers;

    /* 서버 × 직업 모든 조합을 병렬 요청; 개별 실패는 빈 배열로 무시 */
    const tasks = targetServers.flatMap((srv) =>
      supportedJobs.map((job) =>
        neopleGet(
          `/servers/${srv.serverId}/characters` +
            `?characterName=${encodeURIComponent(name)}` +
            `&jobId=${job.jobId}&jobGrowId=${job.jobGrowId}&wordType=full`,
        )
          .then((data) =>
            (data.rows ?? []).map((c) => ({
              characterId: c.characterId,
              characterName: c.characterName,
              level: c.level,
              serverId: srv.serverId,
              serverName: srv.serverName,
              jobId: c.jobId,
              jobGrowId: c.jobGrowId,
              jobGrowName: c.jobGrowName ?? job.jobName,
            })),
          )
          .catch(() => []),
      ),
    );

    const results = (await Promise.all(tasks)).flat().slice(0, 10);
    res.json(results);
  } catch (err) {
    res
      .status(err.statusCode ?? 500)
      .json({ error: err.message ?? "search_error" });
  }
});

/* ── GET /api/character/:serverId/:characterId ───────────────────── */
app.get("/api/character/:serverId/:characterId", async (req, res) => {
  const { serverId, characterId } = req.params;
  if (!/^[a-z]+$/.test(serverId))
    return res.status(400).json({ error: "invalid_server" });
  if (!/^[0-9a-f]+$/.test(characterId))
    return res.status(400).json({ error: "invalid_character_id" });

  try {
    const [charData, styleData, statusData] = await Promise.all([
      neopleGet(`/servers/${serverId}/characters/${characterId}`),
      neopleGet(`/servers/${serverId}/characters/${characterId}/skill/style`),
      neopleGet(`/servers/${serverId}/characters/${characterId}/status`),
    ]);

    const dataKey = `${charData.jobId}_${charData.jobGrowId}`;
    const hasData = hasJobData(dataKey);

    /* 실제 경로: skill.style.active / skill.style.passive */
    const style = styleData?.skill?.style ?? {};
    const activeArr = style.active ?? [];
    const passiveArr = style.passive ?? [];
    const allSkills = [...activeArr, ...passiveArr];

    const skillLevels = hasData
      ? allSkills
          .map((s) => ({ skillId: s.skillId, level: s.level }))
          .filter((s) => s.level > 0)
      : [];
    const evolutions = hasData
      ? (style.evolution ?? []).map((s) => ({
          skillId: s.skillId,
          type: s.type,
        }))
      : [];
    const enhancements = hasData
      ? (style.enhancement ?? []).map((s) => ({
          skillId: s.skillId,
          type: s.type,
        }))
      : [];

    /* status에서 쿨타임 감소 / 쿨타임 회복 속도 추출 */
    const statusArr = statusData?.status ?? [];
    const findStat = (name) =>
      statusArr.find((s) => s.name === name)?.value ?? null;
    const cooldown_reduction = findStat("쿨타임 감소"); /* % 정수 (예: 30) */
    const cooldown_recovery_speed =
      findStat("쿨타임 회복속도"); /* % 정수 (예: 40) */

    res.json({
      dataKey,
      hasData,
      skillLevels,
      evolutions,
      enhancements,
      cooldown_reduction,
      cooldown_recovery_speed,
      fame: charData.fame ?? 0,
    });
  } catch (err) {
    res
      .status(err.statusCode ?? 500)
      .json({ error: err.message ?? "character_error" });
  }
});

app.listen(PORT, () => {
  console.log(`server running on http://localhost:${PORT}`);
});
