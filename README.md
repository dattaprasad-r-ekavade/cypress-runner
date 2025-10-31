# Cypress Video Runner 🎥

A production-ready, Dockerized Node.js/Express web application that runs Cypress tests and lets users preview and download test run videos. Upload either a complete Cypress project (ZIP) or a single test spec file, and watch your tests run with live streaming logs.

## ✨ Features

- 📦 **Dual Upload Support**: Accept ZIP files (full Cypress projects) or single spec files
- 🎬 **Video Recording**: Automatically record and serve test execution videos
- 📸 **Screenshot Capture**: Capture and organize test failure screenshots
- 🔴 **Live Streaming**: Real-time test execution logs via Server-Sent Events (SSE)
- 🐳 **Docker Ready**: Fully containerized with Docker and docker-compose
- 🔒 **Security Hardened**: Rate limiting, CORS, Helmet, input validation
- 📊 **Results Export**: JSON test results with download capability
- 🧹 **Auto Cleanup**: Automatic cleanup of old test runs
- 📝 **Structured Logging**: Winston-based logging with file rotation
- ⚡ **Health Checks**: Built-in health endpoint for monitoring

## 🏗️ Architecture

```
cypress-runner/
├── server/
│   ├── index.js           # Original server (fixed)
│   ├── index-improved.js  # Enhanced server with security & logging
│   ├── config.js          # Configuration management
│   └── logger.js          # Winston logger setup
├── public/
│   └── index.html         # Web UI
├── runs/                  # Test execution artifacts (auto-generated)
├── logs/                  # Application logs (auto-generated)
├── .env.example           # Environment variables template
├── docker-compose.yml     # Docker Compose configuration
├── Dockerfile             # Docker image definition
└── package.json           # Dependencies and scripts
```

## 🚀 Quick Start

### Prerequisites

- **Docker** and **Docker Compose** installed
- OR **Node.js 20+** and **Cypress** for local development

### Option 1: Using Docker Compose (Recommended)

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd cypress-runner
   ```

2. **Build and run**
   ```bash
   docker-compose up --build
   ```

3. **Access the application**
   - Open your browser to `http://localhost:3000`
   - Upload a test file and watch it run!

4. **Stop the application**
   ```bash
   docker-compose down
   ```

### Option 2: Using Docker Only

1. **Build the image**
   ```bash
   docker build -t cypress-runner .
   ```

2. **Run the container**
   ```bash
   docker run -p 3000:3000 -v $(pwd)/runs:/app/runs cypress-runner
   ```

### Option 3: Local Development

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Create environment file**
   ```bash
   cp .env.example .env
   ```

3. **Start the server**
   ```bash
   npm start
   ```

4. **Or use watch mode**
   ```bash
   npm run dev
   ```

## 📝 Configuration

Create a `.env` file based on `.env.example`:

```env
# Server Configuration
PORT=3000
NODE_ENV=development

# Upload Configuration
MAX_FILE_SIZE_MB=100
MAX_RUNS_RETENTION=50
CLEANUP_INTERVAL_HOURS=24

# Cypress Configuration
CYPRESS_BROWSER=chrome
CYPRESS_VIDEO_ENABLED=true

# Security
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100
CORS_ORIGIN=*

# Logging
LOG_LEVEL=info
```

### Configuration Options

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3000 | Server port |
| `MAX_FILE_SIZE_MB` | 100 | Maximum upload file size in MB |
| `MAX_RUNS_RETENTION` | 50 | Maximum number of test runs to keep |
| `CLEANUP_INTERVAL_HOURS` | 24 | How often to run cleanup |
| `CYPRESS_BROWSER` | chrome | Browser to use for tests |
| `RATE_LIMIT_MAX_REQUESTS` | 100 | Max requests per window |
| `LOG_LEVEL` | info | Logging level (error, warn, info, debug) |

## 📡 API Endpoints

### Health Check
```
GET /health
Response: { ok: true, timestamp: "...", uptime: 123, runsCount: 5 }
```

### Start a Test Run
```
POST /start
Content-Type: multipart/form-data
Fields:
  - file: .zip or .cy.{js,ts,mjs} file
  - baseUrl: (optional) base URL for tests

Response: { ok: true, runId: "...", stream: "/runs/:id/stream" }
```

### List All Runs
```
GET /runs
Response: [{ id, createdAt, status, baseUrl, videos[], screenshots[], resultsJson }]
```

### Get Specific Run
```
GET /runs/:id
Response: { id, createdAt, status, baseUrl, videos[], screenshots[], resultsJson }
```

### Stream Live Logs (SSE)
```
GET /runs/:id/stream
Content-Type: text/event-stream
```

## 🎯 Usage Examples

### Example 1: Upload a Single Test File

Create a simple test file `demo.cy.js`:
```javascript
describe('My Test', () => {
  it('visits example.com', () => {
    cy.visit('https://example.com')
    cy.contains('Example Domain')
  })
})
```

Upload via the web UI or curl:
```bash
curl -F "file=@demo.cy.js" -F "baseUrl=https://example.com" http://localhost:3000/start
```

### Example 2: Upload a ZIP Project

Create a ZIP with this structure:
```
my-tests.zip
└── cypress/
    └── e2e/
        └── test.cy.js
```

Upload via the web UI or curl:
```bash
curl -F "file=@my-tests.zip" http://localhost:3000/start
```

## 🔒 Security Features

- **Rate Limiting**: Prevents abuse with configurable rate limits
- **CORS Protection**: Configurable CORS policies
- **Helmet**: Sets secure HTTP headers
- **Input Validation**: Validates file types and URLs
- **File Size Limits**: Prevents DOS attacks via large uploads
- **Non-root User**: Docker container runs as non-root user
- **Sanitized Errors**: Production mode hides error details

## 🛠️ Development

### Code Quality Tools

```bash
# Lint code
npm run lint

# Fix lint issues
npm run lint:fix

# Format code
npm run format

# Check formatting
npm run format:check
```

### Project Structure

- **server/index.js**: Original server (syntax errors fixed)
- **server/index-improved.js**: Production-ready server with all enhancements
- **server/config.js**: Centralized configuration
- **server/logger.js**: Winston logging setup

To use the improved server, update package.json:
```json
"scripts": {
  "start": "node server/index-improved.js"
}
```

## 📊 Monitoring

### Health Check
```bash
curl http://localhost:3000/health
```

### Logs
Logs are written to:
- `logs/combined.log` - All logs
- `logs/error.log` - Error logs only
- Console output with colors (development)

### Docker Logs
```bash
# Follow logs
docker-compose logs -f

# View specific service
docker-compose logs -f cypress-runner
```

## 🐛 Troubleshooting

### Issue: Tests failing with "baseUrl is not set"
**Solution**: Provide a baseUrl in the upload form or ensure your Cypress config has one.

### Issue: Videos not appearing
**Solution**: Check that:
1. Tests ran successfully (status = 'done')
2. Video recording is enabled in config
3. Volume is properly mounted in Docker

### Issue: Container runs out of disk space
**Solution**: 
1. Reduce `MAX_RUNS_RETENTION`
2. Decrease `CLEANUP_INTERVAL_HOURS`
3. Manually clean up: `docker-compose down -v`

### Issue: Permission errors in Docker
**Solution**: Ensure proper permissions on mounted volumes:
```bash
chmod -R 755 runs logs
```

## 🚢 Deployment

### Deploy to Any Docker Host

1. **Build and push image**
   ```bash
   docker build -t your-registry/cypress-runner:latest .
   docker push your-registry/cypress-runner:latest
   ```

2. **Deploy with docker-compose**
   ```bash
   docker-compose up -d
   ```

### Deploy to sherpa.sh

The application is configured to work on sherpa.sh out of the box:
1. Push your repository
2. sherpa.sh will auto-detect the Dockerfile
3. Application runs on port 3000

### Environment Variables for Production

Update your production environment:
```env
NODE_ENV=production
MAX_FILE_SIZE_MB=50
MAX_RUNS_RETENTION=25
CLEANUP_INTERVAL_HOURS=12
LOG_LEVEL=warn
CORS_ORIGIN=https://yourdomain.com
```

## 📦 Volume Persistence

Important directories to persist:
- `/app/runs` - Test execution artifacts (videos, screenshots, results)
- `/app/logs` - Application logs

Docker Compose handles this automatically via:
```yaml
volumes:
  - ./runs:/app/runs
  - ./logs:/app/logs
```

## 🧪 Testing

### Test the Application

1. **Upload a test file** via the UI
2. **Watch live logs** stream in real-time
3. **View the video** once the test completes
4. **Download results** in JSON format

### Sample Test File

Use the included `demo.cy.js`:
```javascript
describe('My First Test', () => {
  it('Does not do much!', () => {
    expect(true).to.equal(true)
  })
})
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run linting and formatting
5. Submit a pull request

## 📄 License

MIT License - feel free to use this project however you'd like.

## 🙏 Acknowledgments

- Built with [Cypress](https://www.cypress.io/)
- Base image: [cypress/included](https://hub.docker.com/r/cypress/included)
- Powered by [Express](https://expressjs.com/)

## 📞 Support

For issues and questions:
1. Check the troubleshooting section
2. Review the logs in `logs/combined.log`
3. Open an issue on GitHub

---

**Made with ❤️ for the testing community**
