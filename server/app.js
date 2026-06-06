'use strict';

const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const path = require('path');

const app = express();
const PORT = 5000;
const TIMEOUT_MS = 5000;
const SIMULATOR_PATH = path.join(__dirname, '..', 'core', 'simulator.exe');

app.use(cors());
app.use(express.json());

app.get('/ping', (req, res) => {
    const child = spawn(SIMULATOR_PATH);
    let output = '';

    const timer = setTimeout(() => {
        child.kill();
        res.status(504).json({ error: 'timeout' });
    }, TIMEOUT_MS);

    child.stdout.on('data', d => { output += d; });
    child.stdin.end();

    child.on('close', code => {
        clearTimeout(timer);
        if (res.headersSent) return;
        if (code !== 0) return res.status(500).json({ error: 'simulator error' });
        let core;
        try { core = JSON.parse(output); } catch { core = { raw: output }; }
        res.json({ status: 'ok', c_core: core.status ?? 'unknown' });
    });

    child.on('error', () => {
        clearTimeout(timer);
        if (!res.headersSent) res.status(503).json({ error: 'simulator not found' });
    });
});

app.listen(PORT, () => {
    console.log(`server running on http://localhost:${PORT}`);
});
