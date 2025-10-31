import dotenv from 'dotenv';

dotenv.config();

export const config = {
    port: parseInt(process.env.PORT || '3000', 10),
    nodeEnv: process.env.NODE_ENV || 'development',
    
    upload: {
        maxFileSizeMB: parseInt(process.env.MAX_FILE_SIZE_MB || '100', 10),
        maxRunsRetention: parseInt(process.env.MAX_RUNS_RETENTION || '50', 10),
        cleanupIntervalHours: parseInt(process.env.CLEANUP_INTERVAL_HOURS || '24', 10),
    },
    
    cypress: {
        browser: process.env.CYPRESS_BROWSER || 'chrome',
        videoEnabled: process.env.CYPRESS_VIDEO_ENABLED !== 'false',
    },
    
    security: {
        rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10),
        rateLimitMaxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10),
        corsOrigin: process.env.CORS_ORIGIN || '*',
    },
    
    logging: {
        level: process.env.LOG_LEVEL || 'info',
    },
};
