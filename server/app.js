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
const SCRIPTS_DIR    = path.join(__dirname, '..', 'scripts');

app.use(cors());
app.use(express.json());

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

/* ── GET /tree/:jobGrowId ─────────────────────────────────────────────
 * 직업별 merged.json을 읽어 그대로 반환한다.
 * C 코어가 읽는 최종 파일이므로 Node.js에서 가공하지 않는다. */
app.get('/tree/:jobGrowId', (req, res) => {
    const { jobGrowId } = req.params;
    if (!isValidJobGrowId(jobGrowId)) {
        return res.status(400).json({ error: 'invalid_job_grow_id' });
    }

    const filePath = path.join(DATA_DIR, `${jobGrowId}_merged.json`);
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'not_found', jobGrowId });
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

/* ── POST /skills/rebuild/:jobGrowId ─────────────────────────────────
 * merge_skills.js를 실행해 merged.json을 재생성한다. */
app.post('/skills/rebuild/:jobGrowId', (req, res) => {
    const { jobGrowId } = req.params;
    if (!isValidJobGrowId(jobGrowId)) {
        return res.status(400).json({ error: 'invalid_job_grow_id' });
    }

    const scriptPath = path.join(SCRIPTS_DIR, 'merge_skills.js');
    const child = spawn('node', [scriptPath, `--jobGrowId=${jobGrowId}`]);
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
        res.json({ status: 'ok', jobGrowId, log: stdout.trim() });
    });

    child.on('error', () => {
        clearTimeout(timer);
        if (!res.headersSent) res.status(503).json({ error: 'merge_script_not_found' });
    });
});

app.listen(PORT, () => {
    console.log(`server running on http://localhost:${PORT}`);
});
