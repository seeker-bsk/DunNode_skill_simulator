'use strict';

const express  = require('express');
const cors     = require('cors');
const fs       = require('fs');
const path     = require('path');
const { spawn } = require('child_process');

const app    = express();
const PORT   = 5000;
const TIMEOUT_MS     = 5000;
const SIMULATOR_PATH = path.join(__dirname, '..', 'core', 'simulator.exe');
const DATA_DIR       = path.join(__dirname, '..', 'data', 'skills');
const JOBS_FILE      = path.join(__dirname, '..', 'data', 'jobs.json');
const SCRIPTS_DIR    = path.join(__dirname, '..', 'scripts');

app.use(cors());
app.use(express.json());
app.use('/media', express.static(path.join(__dirname, '..', 'media')));

/* jobGrowId는 32자리 hex 문자열만 허용 (경로 순회 방지) */
function isValidJobGrowId(id) {
    return typeof id === 'string' && /^[0-9a-f]{32}$/.test(id);
}

/* ── C 코어 subprocess 호출 헬퍼 ─────────────────────────────────────── */
function runSimulator(payload) {
    return new Promise((resolve, reject) => {
        const child = spawn(SIMULATOR_PATH);
        let output = '';

        const timer = setTimeout(() => {
            child.kill();
            reject(Object.assign(new Error('timeout'), { statusCode: 504 }));
        }, TIMEOUT_MS);

        child.stdout.on('data', chunk => { output += chunk; });

        child.on('close', code => {
            clearTimeout(timer);
            if (code !== 0) {
                let body;
                try { body = JSON.parse(output); } catch { body = { error: 'simulator_error' }; }
                return reject(Object.assign(new Error('simulator error'), { statusCode: 502, body }));
            }
            resolve(output);
        });

        child.on('error', err => {
            clearTimeout(timer);
            reject(Object.assign(err, { statusCode: 503 }));
        });

        child.stdin.write(JSON.stringify(payload));
        child.stdin.end();
    });
}

/* ── GET /ping ───────────────────────────────────────────────────────── */
app.get('/ping', (_req, res) => {
    res.json({ status: 'ok' });
});

/* ── GET /jobs ────────────────────────────────────────────────────────
 * jobs.json 전체 반환. hasData 필드를 동적으로 추가한다. */
app.get('/jobs', (_req, res) => {
    try {
        const jobs = JSON.parse(fs.readFileSync(JOBS_FILE, 'utf8'));
        const result = jobs.map(j => ({
            ...j,
            hasData: fs.existsSync(path.join(DATA_DIR, `${j.dataKey}_merged.json`))
        }));
        res.json(result);
    } catch {
        res.status(500).json({ error: 'jobs_load_error' });
    }
});

/* ── GET /tree/:dataKey ───────────────────────────────────────────────
 * dataKey = {jobId}_{jobGrowId}. 직업별 merged.json을 그대로 반환한다. */
app.get('/tree/:dataKey', (req, res) => {
    const { dataKey } = req.params;
    if (!/^[0-9a-f]{32}_[0-9a-f]{32}$/.test(dataKey)) {
        return res.status(400).json({ error: 'invalid_data_key' });
    }

    const filePath = path.join(DATA_DIR, `${dataKey}_merged.json`);
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'not_found', dataKey });
    }

    try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        res.json(data);
    } catch {
        res.status(500).json({ error: 'parse_error' });
    }
});

/* ── POST /api/simulate ───────────────────────────────────────────────
 * 요청 body를 그대로 C 코어 stdin에 전달하고 stdout을 반환한다.
 * 비즈니스 로직은 C 코어에만 있다. */
app.post('/api/simulate', async (req, res) => {
    if (!req.body || typeof req.body !== 'object') {
        return res.status(400).json({ error: 'invalid_input', field: 'body' });
    }

    try {
        const output = await runSimulator(req.body);
        const result = JSON.parse(output);
        res.json(result);
    } catch (err) {
        const status = err.statusCode ?? 500;
        const body   = err.body ?? { error: err.message ?? 'internal_error' };
        res.status(status).json(body);
    }
});

/* ── POST /skills/rebuild/:dataKey ───────────────────────────────────
 * merge_skills.js를 실행해 merged.json을 재생성한다.
 * dataKey = {jobId}_{jobGrowId} */
app.post('/skills/rebuild/:dataKey', (req, res) => {
    const { dataKey } = req.params;
    if (!/^[0-9a-f]{32}_[0-9a-f]{32}$/.test(dataKey)) {
        return res.status(400).json({ error: 'invalid_data_key' });
    }
    const [jobId, jobGrowId] = dataKey.split('_');

    const scriptPath = path.join(SCRIPTS_DIR, 'merge_skills.js');
    const child = spawn('node', [scriptPath, `--jobId=${jobId}`, `--jobGrowId=${jobGrowId}`]);
    let stdout = '';
    let stderr = '';

    const timer = setTimeout(() => {
        child.kill();
        if (!res.headersSent) res.status(504).json({ error: 'timeout' });
    }, TIMEOUT_MS);

    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });

    child.on('close', code => {
        clearTimeout(timer);
        if (res.headersSent) return;
        if (code !== 0) {
            return res.status(500).json({ error: 'merge_failed', detail: stderr.trim() });
        }
        res.json({ status: 'ok', dataKey, log: stdout.trim() });
    });

    child.on('error', () => {
        clearTimeout(timer);
        if (!res.headersSent) res.status(503).json({ error: 'merge_script_not_found' });
    });
});

app.listen(PORT, () => {
    console.log(`server running on http://localhost:${PORT}`);
});
