import express from 'express';
import multer from 'multer';
import AdmZip from 'adm-zip';
import { glob } from 'glob';
import { nanoid } from 'nanoid';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = 3000;

const runs = new Map();

app.use(express.static(path.join(__dirname, '../public')));
app.use('/videos', express.static(path.join(__dirname, '../runs')));
app.use('/screenshots', express.static(path.join(__dirname, '../runs')));

const upload = multer({ storage: multer.memoryStorage() });

app.get('/health', (req, res) => {
    res.json({ ok: true });
});

app.post('/start', upload.single('file'), async (req, res) => {
    console.log('Uploaded file:', req.file.originalname);
    const { file, body: {baseUrl} } = req;
    const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${nanoid(6)}`;
    const runPath = path.join(__dirname, '../runs', runId);
    const workPath = path.join(runPath, 'work');

    fs.mkdirSync(runPath, { recursive: true });
    fs.mkdirSync(workPath, { recursive: true });

    const isZip = file.originalname.endsWith('.zip');
    const isSpec = /\.cy\.(js|ts|mjs)$/i.test(file.originalname);
    
        if (isZip) {
            const zip = new AdmZip(file.buffer);
            zip.extractAllTo(workPath, true);
        } else if (isSpec) {
            const specPath = path.join(workPath, 'cypress', 'e2e');
            fs.mkdirSync(specPath, { recursive: true });
            fs.writeFileSync(path.join(specPath, file.originalname), file.buffer);
    
            const cypressConfigContent = `
                        const { defineConfig } = require('cypress');
            
                        module.exports = defineConfig({
                            e2e: {
                                specPattern: 'cypress/e2e/**/*.cy.*',
                    supportFile: false,
                    video: true,
                            },
                        });
                    `;
                    fs.writeFileSync(path.join(workPath, 'cypress.config.cjs'), cypressConfigContent);        } else {
        return res.status(400).json({ ok: false, error: 'Invalid file type. Please upload a .zip or a .cy.{js,ts,mjs} file.' });
    }

    runs.set(runId, { id: runId, createdAt: new Date(), status: 'queued', baseUrl, filename: file.originalname, paths: { runPath, workPath } });

    res.json({ ok: true, runId, stream: `/runs/${runId}/stream` });

    // Run Cypress in the background
    runCypress(runId);
});

app.get('/runs', (req, res) => {
    const runList = Array.from(runs.values()).sort((a, b) => b.createdAt - a.createdAt);
    res.json(runList.map(run => ({
        id: run.id,
        createdAt: run.createdAt,
        status: run.status,
        baseUrl: run.baseUrl,
        filename: run.filename,
        videos: getRunVideos(run.id),
        screenshots: getRunScreenshots(run.id),
        resultsJson: getRunResults(run.id),
    })));
});

app.get('/runs/:id', (req, res) => {
    const run = runs.get(req.params.id);
    if (!run) {
        return res.status(404).json({ ok: false, error: 'Run not found' });
    }
    res.json({
        id: run.id,
        createdAt: run.createdAt,
        status: run.status,
        baseUrl: run.baseUrl,
        filename: run.filename,
        videos: getRunVideos(run.id),
        screenshots: getRunScreenshots(run.id),
        resultsJson: getRunResults(run.id),
    });
});

const clients = new Map();

app.get('/runs/:id/stream', (req, res) => {
    const runId = req.params.id;
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
    });

    if (!clients.has(runId)) {
        clients.set(runId, []);
    }
    clients.get(runId).push(res);

    req.on('close', () => {
        const runClients = clients.get(runId) || [];
        clients.set(runId, runClients.filter(c => c !== res));
    });
});

function broadcast(runId, data) {
    // Strip ANSI color codes and escape sequences
    const cleanData = data.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '').replace(/\x1B\[[\?]?[0-9;]*[a-zA-Z]/g, '');
    const runClients = clients.get(runId) || [];
    runClients.forEach(client => client.write(`data: ${cleanData}\n\n`));
}

async function runCypress(runId) {
    const run = runs.get(runId);
    run.status = 'running';

    const videosFolder = path.join(run.paths.runPath, 'cypress', 'videos');
    const screenshotsFolder = path.join(run.paths.runPath, 'cypress', 'screenshots');
    const resultsFolder = path.join(run.paths.runPath, 'results');

    fs.mkdirSync(videosFolder, { recursive: true });
    fs.mkdirSync(screenshotsFolder, { recursive: true });
    fs.mkdirSync(resultsFolder, { recursive: true });

    const cypressCommand = [
        'run',
        '--project', run.paths.workPath,
        '--browser', 'chrome',
        '--headless',
        '--config', `videosFolder=${videosFolder},screenshotsFolder=${screenshotsFolder}`,
        '--reporter', 'json',
        '--reporter-options', `output=${path.join(resultsFolder, 'results.json')}`,
    ];

    if (run.baseUrl) {
        cypressCommand.push('--config', `baseUrl=${run.baseUrl}`);
    }

    const configFile = await findConfigFile(run.paths.workPath);
    if (configFile) {
        cypressCommand.push('--config-file', configFile);
    } else {
        cypressCommand.push('--spec', path.join(run.paths.workPath, 'cypress', 'e2e', '**', '*.cy.*'));
    }

    const cypressProcess = spawn('cypress', cypressCommand, { cwd: run.paths.workPath });

    cypressProcess.stdout.on('data', (data) => {
        console.log(data.toString());
        broadcast(runId, data.toString());
    });

    cypressProcess.stderr.on('data', (data) => {
        console.log(data.toString());
        broadcast(runId, data.toString());
    });

    cypressProcess.on('close', (code) => {
        run.status = code === 0 ? 'done' : 'failed';
        fs.writeFileSync(path.join(run.paths.runPath, 'exit-code.txt'), code.toString());
        
        // Move videos and screenshots from work directory to run directory
        const workVideos = path.join(run.paths.workPath, 'cypress', 'videos');
        const workScreenshots = path.join(run.paths.workPath, 'cypress', 'screenshots');
        const targetVideos = path.join(run.paths.runPath, 'cypress', 'videos');
        const targetScreenshots = path.join(run.paths.runPath, 'cypress', 'screenshots');
        
        // Move videos if they exist in work directory
        if (fs.existsSync(workVideos)) {
            fs.cpSync(workVideos, targetVideos, { recursive: true, force: true });
        }
        
        // Move screenshots if they exist in work directory
        if (fs.existsSync(workScreenshots)) {
            fs.cpSync(workScreenshots, targetScreenshots, { recursive: true, force: true });
        }
        
        broadcast(runId, `RUN_DONE status=${run.status} code=${code}`);
        setTimeout(() => {
            const runClients = clients.get(runId) || [];
            runClients.forEach(client => client.end());
            clients.delete(runId);
        }, 250);
    });
}

async function findConfigFile(workPath) {
    const configFiles = ['cypress.config.mjs', 'cypress.config.ts', 'cypress.config.js', 'cypress.config.cjs', 'cypress.json'];
    for (const file of configFiles) {
        const files = await glob(path.join(workPath, file));
        if (files.length > 0) {
            return files[0];
        }
    }
    return null;
}

function getRunVideos(runId) {
    const run = runs.get(runId);
    if (!run) return [];
    const videosPath = path.join(run.paths.runPath, 'cypress', 'videos');
    if (!fs.existsSync(videosPath)) return [];
    
    const videos = [];
    const walkDir = (dir, baseUrl) => {
        const files = fs.readdirSync(dir);
        files.forEach(file => {
            const filePath = path.join(dir, file);
            const stat = fs.statSync(filePath);
            if (stat.isDirectory()) {
                walkDir(filePath, `${baseUrl}/${file}`);
            } else if (file.match(/\.mp4$/i)) {
                videos.push(`${baseUrl}/${file}`);
            }
        });
    };
    
    walkDir(videosPath, `/videos/${runId}/cypress/videos`);
    return videos;
}

function getRunScreenshots(runId) {
    const run = runs.get(runId);
    if (!run) return [];
    const screenshotsPath = path.join(run.paths.runPath, 'cypress', 'screenshots');
    if (!fs.existsSync(screenshotsPath)) return [];
    
    const screenshots = [];
    const walkDir = (dir, baseUrl) => {
        const files = fs.readdirSync(dir);
        files.forEach(file => {
            const filePath = path.join(dir, file);
            const stat = fs.statSync(filePath);
            if (stat.isDirectory()) {
                walkDir(filePath, `${baseUrl}/${file}`);
            } else if (file.match(/\.(png|jpg|jpeg)$/i)) {
                screenshots.push(`${baseUrl}/${file}`);
            }
        });
    };
    
    walkDir(screenshotsPath, `/screenshots/${runId}/cypress/screenshots`);
    return screenshots;
}

function getRunResults(runId) {
    const run = runs.get(runId);
    if (!run) return null;
    const resultsPath = path.join(run.paths.runPath, 'results', 'results.json');
    if (!fs.existsSync(resultsPath)) return null;
    return `/results/${runId}/results/results.json`;
}

app.use('/results', express.static(path.join(__dirname, '../runs')));

app.listen(port, () => {
    console.log(`Cypress runner listening at http://localhost:${port}`);
});
