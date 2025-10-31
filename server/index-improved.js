import express from 'express';
import multer from 'multer';
import AdmZip from 'adm-zip';
import { glob } from 'glob';
import { nanoid } from 'nanoid';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { logger } from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Create necessary directories
const logsDir = path.join(__dirname, '../logs');
const runsDir = path.join(__dirname, '../runs');
[logsDir, runsDir].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

// Security middleware
app.use(helmet({
    contentSecurityPolicy: false, // Allow inline scripts for simple HTML
    crossOriginEmbedderPolicy: false, // Allow videos to be embedded
}));

app.use(cors({
    origin: config.security.corsOrigin,
    credentials: true,
}));

// Rate limiting
const limiter = rateLimit({
    windowMs: config.security.rateLimitWindowMs,
    max: config.security.rateLimitMaxRequests,
    message: 'Too many requests from this IP, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
});

app.use('/start', limiter);

// Body parser
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// In-memory storage (consider using a database in production)
const runs = new Map();
const clients = new Map();

// Static file serving
app.use(express.static(path.join(__dirname, '../public')));
app.use('/videos', express.static(path.join(__dirname, '../runs')));
app.use('/screenshots', express.static(path.join(__dirname, '../runs')));
app.use('/results', express.static(path.join(__dirname, '../runs')));

// Multer configuration with file size limits
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: config.upload.maxFileSizeMB * 1024 * 1024, // Convert MB to bytes
    },
    fileFilter: (req, file, cb) => {
        const isZip = file.originalname.toLowerCase().endsWith('.zip');
        const isSpec = /\.cy\.(js|ts|mjs)$/i.test(file.originalname);
        
        if (isZip || isSpec) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type. Please upload a .zip or a .cy.{js,ts,mjs} file.'));
        }
    },
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        ok: true,
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        runsCount: runs.size,
    });
});

// Start a new Cypress run
app.post('/start', upload.single('file'), async (req, res) => {
    try {
        const { file, body: { baseUrl } } = req;
        
        if (!file) {
            return res.status(400).json({
                ok: false,
                error: 'No file uploaded',
            });
        }

        // Validate baseUrl if provided
        if (baseUrl && !isValidUrl(baseUrl)) {
            return res.status(400).json({
                ok: false,
                error: 'Invalid baseUrl format. Must be a valid HTTP(S) URL.',
            });
        }

        logger.info(`Starting new run with file: ${file.originalname}`, { baseUrl });

        const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${nanoid(6)}`;
        const runPath = path.join(__dirname, '../runs', runId);
        const workPath = path.join(runPath, 'work');

        fs.mkdirSync(runPath, { recursive: true });
        fs.mkdirSync(workPath, { recursive: true });

        const isZip = file.originalname.toLowerCase().endsWith('.zip');
        const isSpec = /\.cy\.(js|ts|mjs)$/i.test(file.originalname);

        if (isZip) {
            logger.info(`Extracting ZIP file for run ${runId}`);
            const zip = new AdmZip(file.buffer);
            zip.extractAllTo(workPath, true);
        } else if (isSpec) {
            logger.info(`Setting up single spec file for run ${runId}`);
            const specPath = path.join(workPath, 'cypress', 'e2e');
            fs.mkdirSync(specPath, { recursive: true });
            fs.writeFileSync(path.join(specPath, file.originalname), file.buffer);

            // Create minimal Cypress config
            const cypressConfigContent = `const { defineConfig } = require('cypress');

module.exports = defineConfig({
    e2e: {
        specPattern: 'cypress/e2e/**/*.cy.*',
        supportFile: false,
        video: ${config.cypress.videoEnabled},
    },
});
`;
            fs.writeFileSync(path.join(workPath, 'cypress.config.cjs'), cypressConfigContent);
        } else {
            return res.status(400).json({
                ok: false,
                error: 'Invalid file type. Please upload a .zip or a .cy.{js,ts,mjs} file.',
            });
        }

        runs.set(runId, {
            id: runId,
            createdAt: new Date(),
            status: 'queued',
            baseUrl,
            filename: file.originalname,
            paths: { runPath, workPath },
        });

        res.json({
            ok: true,
            runId,
            stream: `/runs/${runId}/stream`,
        });

        // Run Cypress in the background
        setImmediate(() => runCypress(runId));

        // Cleanup old runs if needed
        cleanupOldRuns();
    } catch (error) {
        logger.error('Error starting run:', error);
        res.status(500).json({
            ok: false,
            error: 'Failed to start Cypress run',
            message: error.message,
        });
    }
});

// Get all runs
app.get('/runs', (req, res) => {
    try {
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
    } catch (error) {
        logger.error('Error fetching runs:', error);
        res.status(500).json({
            ok: false,
            error: 'Failed to fetch runs',
        });
    }
});

// Get a specific run
app.get('/runs/:id', (req, res) => {
    try {
        const run = runs.get(req.params.id);
        if (!run) {
            return res.status(404).json({
                ok: false,
                error: 'Run not found',
            });
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
    } catch (error) {
        logger.error('Error fetching run:', error);
        res.status(500).json({
            ok: false,
            error: 'Failed to fetch run details',
        });
    }
});

// SSE stream for live logs
app.get('/runs/:id/stream', (req, res) => {
    const runId = req.params.id;
    
    if (!runs.has(runId)) {
        return res.status(404).json({
            ok: false,
            error: 'Run not found',
        });
    }

    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
    });

    if (!clients.has(runId)) {
        clients.set(runId, []);
    }
    clients.get(runId).push(res);

    logger.info(`Client connected to stream for run ${runId}`);

    req.on('close', () => {
        const runClients = clients.get(runId) || [];
        clients.set(runId, runClients.filter(c => c !== res));
        logger.info(`Client disconnected from stream for run ${runId}`);
    });
});

// Helper function to broadcast to SSE clients
function broadcast(runId, data) {
    const runClients = clients.get(runId) || [];
    runClients.forEach(client => {
        try {
            client.write(`data: ${data}\n\n`);
        } catch (error) {
            logger.error(`Error broadcasting to client for run ${runId}:`, error);
        }
    });
}

// Run Cypress tests
async function runCypress(runId) {
    const run = runs.get(runId);
    if (!run) {
        logger.error(`Run ${runId} not found`);
        return;
    }

    try {
        run.status = 'running';
        logger.info(`Starting Cypress run ${runId}`);

        const videosFolder = path.join(run.paths.runPath, 'cypress', 'videos');
        const screenshotsFolder = path.join(run.paths.runPath, 'cypress', 'screenshots');
        const resultsFolder = path.join(run.paths.runPath, 'results');

        fs.mkdirSync(videosFolder, { recursive: true });
        fs.mkdirSync(screenshotsFolder, { recursive: true });
        fs.mkdirSync(resultsFolder, { recursive: true });

        const cypressCommand = [
            'run',
            '--project', run.paths.workPath,
            '--browser', config.cypress.browser,
            '--headless',
            '--config', `videosFolder=${videosFolder},screenshotsFolder=${screenshotsFolder}`,
            '--reporter', 'json',
            '--reporter-options', `output=${path.join(resultsFolder, 'results.json')}`,
        ];

        if (run.baseUrl) {
            cypressCommand.splice(cypressCommand.indexOf('--config') + 1, 0, `baseUrl=${run.baseUrl},`);
        }

        const configFile = await findConfigFile(run.paths.workPath);
        if (configFile) {
            cypressCommand.push('--config-file', configFile);
            logger.info(`Using config file: ${configFile}`);
        } else {
            cypressCommand.push('--spec', path.join(run.paths.workPath, 'cypress', 'e2e', '**', '*.cy.*'));
        }

        logger.info(`Cypress command: cypress ${cypressCommand.join(' ')}`);

        const cypressProcess = spawn('cypress', cypressCommand, {
            cwd: run.paths.workPath,
            env: { ...process.env, NO_COLOR: '1' },
        });

        cypressProcess.stdout.on('data', (data) => {
            const message = data.toString();
            logger.debug(`[Run ${runId}] ${message}`);
            broadcast(runId, message);
        });

        cypressProcess.stderr.on('data', (data) => {
            const message = data.toString();
            logger.warn(`[Run ${runId}] ${message}`);
            broadcast(runId, message);
        });

        cypressProcess.on('error', (error) => {
            logger.error(`Failed to start Cypress for run ${runId}:`, error);
            run.status = 'failed';
            broadcast(runId, `ERROR: ${error.message}`);
        });

        cypressProcess.on('close', (code) => {
            run.status = code === 0 ? 'done' : 'failed';
            fs.writeFileSync(path.join(run.paths.runPath, 'exit-code.txt'), code.toString());
            
            logger.info(`Cypress run ${runId} finished with code ${code}`);
            broadcast(runId, `RUN_DONE status=${run.status} code=${code}`);

            // Close all SSE connections after a short delay
            setTimeout(() => {
                const runClients = clients.get(runId) || [];
                runClients.forEach(client => {
                    try {
                        client.end();
                    } catch (error) {
                        logger.error(`Error closing client connection:`, error);
                    }
                });
                clients.delete(runId);
            }, 250);
        });
    } catch (error) {
        logger.error(`Error running Cypress for run ${runId}:`, error);
        run.status = 'failed';
        broadcast(runId, `ERROR: ${error.message}`);
    }
}

// Find Cypress config file
async function findConfigFile(workPath) {
    const configFiles = [
        'cypress.config.mjs',
        'cypress.config.ts',
        'cypress.config.js',
        'cypress.config.cjs',
        'cypress.json',
    ];
    
    for (const file of configFiles) {
        const files = await glob(path.join(workPath, file));
        if (files.length > 0) {
            return files[0];
        }
    }
    return null;
}

// Get videos for a run
function getRunVideos(runId) {
    const run = runs.get(runId);
    if (!run) return [];
    
    const videosPath = path.join(run.paths.runPath, 'cypress', 'videos');
    if (!fs.existsSync(videosPath)) return [];
    
    try {
        return fs.readdirSync(videosPath)
            .filter(file => file.endsWith('.mp4'))
            .map(file => `/videos/${runId}/cypress/videos/${file}`);
    } catch (error) {
        logger.error(`Error reading videos for run ${runId}:`, error);
        return [];
    }
}

// Get screenshots for a run
function getRunScreenshots(runId) {
    const run = runs.get(runId);
    if (!run) return [];
    
    const screenshotsPath = path.join(run.paths.runPath, 'cypress', 'screenshots');
    if (!fs.existsSync(screenshotsPath)) return [];
    
    try {
        const screenshots = [];
        const walk = (dir, baseUrl) => {
            const files = fs.readdirSync(dir);
            files.forEach(file => {
                const filePath = path.join(dir, file);
                const stat = fs.statSync(filePath);
                if (stat.isDirectory()) {
                    walk(filePath, `${baseUrl}/${file}`);
                } else if (file.match(/\.(png|jpg|jpeg)$/i)) {
                    screenshots.push(`${baseUrl}/${file}`);
                }
            });
        };
        walk(screenshotsPath, `/screenshots/${runId}/cypress/screenshots`);
        return screenshots;
    } catch (error) {
        logger.error(`Error reading screenshots for run ${runId}:`, error);
        return [];
    }
}

// Get results JSON for a run
function getRunResults(runId) {
    const run = runs.get(runId);
    if (!run) return null;
    
    const resultsPath = path.join(run.paths.runPath, 'results', 'results.json');
    if (!fs.existsSync(resultsPath)) return null;
    
    return `/results/${runId}/results/results.json`;
}

// Validate URL
function isValidUrl(string) {
    try {
        const url = new URL(string);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch (_) {
        return false;
    }
}

// Cleanup old runs to prevent disk space issues
function cleanupOldRuns() {
    try {
        const runsArray = Array.from(runs.entries())
            .sort((a, b) => b[1].createdAt - a[1].createdAt);

        if (runsArray.length > config.upload.maxRunsRetention) {
            const toDelete = runsArray.slice(config.upload.maxRunsRetention);
            
            toDelete.forEach(([runId, run]) => {
                try {
                    fs.rmSync(run.paths.runPath, { recursive: true, force: true });
                    runs.delete(runId);
                    logger.info(`Cleaned up old run: ${runId}`);
                } catch (error) {
                    logger.error(`Error cleaning up run ${runId}:`, error);
                }
            });
        }
    } catch (error) {
        logger.error('Error during cleanup:', error);
    }
}

// Schedule periodic cleanup
setInterval(() => {
    logger.info('Running scheduled cleanup');
    cleanupOldRuns();
}, config.upload.cleanupIntervalHours * 60 * 60 * 1000);

// Error handling middleware
app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({
                ok: false,
                error: `File too large. Maximum size is ${config.upload.maxFileSizeMB}MB`,
            });
        }
    }
    
    logger.error('Unhandled error:', err);
    res.status(500).json({
        ok: false,
        error: 'Internal server error',
        message: config.nodeEnv === 'development' ? err.message : undefined,
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        ok: false,
        error: 'Not found',
    });
});

// Graceful shutdown
process.on('SIGTERM', () => {
    logger.info('SIGTERM received, shutting down gracefully');
    server.close(() => {
        logger.info('Server closed');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    logger.info('SIGINT received, shutting down gracefully');
    server.close(() => {
        logger.info('Server closed');
        process.exit(0);
    });
});

// Start server
const server = app.listen(config.port, () => {
    logger.info(`Cypress runner listening at http://localhost:${config.port}`);
    logger.info(`Environment: ${config.nodeEnv}`);
    logger.info(`Max file size: ${config.upload.maxFileSizeMB}MB`);
});

export default app;
