> You are building a Dockerized Node/Express web app that runs Cypress tests and then lets users **preview and download the run video**.
> It must accept **either** (A) a ZIP containing a Cypress project **or** (B) a **single spec file** like `demo.cy.js`.
> Implement everything end-to-end with minimal deps, clear comments, and a simple UI.
>
> ## Goal
>
> * A Dockerized Node/Express app that:
>
>   1. serves a small web UI,
>   2. accepts **uploads**:
>
>      * **ZIP**: contains `cypress/e2e/*.cy.{js,ts}` and optional config, **or**
>      * **Single spec file**: `*.cy.{js,ts,mjs}` (e.g., `demo.cy.js`)
>   3. runs Cypress **headless** (Chrome) against an optional **Base URL**,
>   4. streams **live logs** via SSE,
>   5. saves artifacts (videos, screenshots, JSON results),
>   6. shows **inline video preview** and **download links**.
> * Deployable on **sherpa.sh** (Docker build/run). HTTP on **port 3000**.
>
> ## Tech constraints
>
> * Node 20+, **Express**, **Multer**, **Adm-Zip**, **glob**, **nanoid**. Vanilla JS frontend (no frameworks).
> * Base image: `FROM cypress/included:13.13.2` (so browsers are preinstalled).
>
> ## Project layout
>
> ```
> cypress-runner/
> ├─ Dockerfile
> ├─ package.json
> ├─ server/
> │  └─ index.js
> └─ public/
>    └─ index.html
> ```
>
> ## Upload behavior
>
> * Endpoint: `POST /start` (`multipart/form-data`)
>
>   * Field **`file`** (required): either a **ZIP** or a **single file** whose name matches `*.cy.{js,ts,mjs}`.
>   * Field **`baseUrl`** (optional).
> * **ZIP path**: unzip into `runs/<id>/work/` and use any provided Cypress config.
> * **Single-file path**:
>
>   * Create directories:
>
>     * `runs/<id>/work/cypress/e2e/`
>     * `runs/<id>/cypress/videos/`
>     * `runs/<id>/cypress/screenshots/`
>     * `runs/<id>/results/`
>   * Save the uploaded spec into `runs/<id>/work/cypress/e2e/<original-name>` (e.g., `demo.cy.js`).
>   * If **no config provided** (single-file case), **auto-generate** `runs/<id>/work/cypress.config.js` with:
>
>     * `e2e.specPattern = "cypress/e2e/**/*.cy.*"`
>     * do not set `baseUrl` here; we’ll inject it via CLI `--config` if provided.
>     * Enable default video recording (Cypress does this in headless by default).
>
> ## Endpoints
>
> * `GET /health` → `{ ok: true }`
> * `POST /start` → `{ ok: true, runId, stream: "/runs/:id/stream" }`
> * `GET /runs` → list runs (newest first) with:
>
>   * `id`, `createdAt`, `status` (`queued|running|done|failed`), `baseUrl`
>   * `videos`: array of public URLs to `.mp4`
>   * `resultsJson`: public URL if present
> * `GET /runs/:id` → details for one run: `videos`, `screenshots`, `resultsJson`
> * `GET /runs/:id/stream` → **SSE** streaming Cypress stdout/stderr; on finish send `RUN_DONE status=<done|failed> code=<exitCode>` and end the stream.
> * Static routes:
>
>   * `/videos` → `runs/<id>/cypress/videos/**`
>   * `/screenshots` → `runs/<id>/cypress/screenshots/**`
>   * `/results` → `runs/<id>/results/**`
>
> ## Cypress invocation rules
>
> * On run start, compute:
>
>   * `root = /app/runs/<id>`
>   * `work = /app/runs/<id>/work`
>   * `videos = /app/runs/<id>/cypress/videos`
>   * `screenshots = /app/runs/<id>/cypress/screenshots`
>   * `results = /app/runs/<id>/results`
> * Determine config file by checking, in order, inside **`work/`**:
>
>   * `cypress.config.mjs`, `cypress.config.ts`, `cypress.config.js`, `cypress.json`
> * If none exists (single-file path), use the **auto-generated** `cypress.config.js`.
> * Invoke Cypress with:
>
>   * `cypress run --browser chrome --headless`
>   * `--config videosFolder=<videos>,screenshotsFolder=<screenshots>[,baseUrl=<baseUrlIfProvided>]`
>   * If config file exists: `--config-file <path>`
>   * Else: `--spec <work>/cypress/e2e/**/*.cy.*`
>   * `--reporter json --reporter-options output=<results>/results.json`
> * Stream stdout/stderr lines to all SSE clients in real time.
>
> ## Server implementation details
>
> * Maintain an in-memory `Map` of runs (`id`, `createdAt`, `status`, `baseUrl`, `paths`).
> * `id` format: ISO timestamp plus `nanoid(6)` suffix (safe for folder names).
> * After Cypress exits, write `exit-code.txt`, broadcast `RUN_DONE`, then close SSE clients after ~250ms.
> * **File-type detection** for `file`:
>
>   * If filename ends with `.zip` → treat as ZIP.
>   * Else if it matches `/\.cy\.(js|ts|mjs)$/i` → treat as **single spec**.
>   * Otherwise, reject with 400 and a helpful message.
> * When handling **single spec**:
>
>   * Write uploaded buffer directly; **do not** eval user code.
>   * Generate minimal `cypress.config.js` only if missing.
>
> ## Frontend (single HTML file, vanilla JS)
>
> * A responsive UI with:
>
>   * Upload form: `<input type="file" name="file" accept=".zip,.cy.js,.cy.ts,.cy.mjs" required>` and optional Base URL field.
>   * **Live Logs** `<pre>` that subscribes to `/runs/:id/stream`.
>   * **Latest Result** area with inline `<video controls>` + **Download** and `results.json` links.
>   * **Runs** panel listing previous runs with per-video **Preview** and **Download** links.
> * After `/start`, open an `EventSource` for the stream; on `RUN_DONE`, refresh runs and auto-load the newest run’s first video into the player.
> * Graceful messages when no videos exist yet.
>
> ## package.json
>
> ```json
> {
>   "name": "cypress-video-runner",
>   "private": true,
>   "type": "module",
>   "scripts": { "start": "node server/index.js" },
>   "dependencies": {
>     "adm-zip": "^0.5.10",
>     "express": "^4.19.2",
>     "glob": "^11.0.0",
>     "multer": "^1.4.5-lts.2",
>     "nanoid": "^5.0.7"
>   }
> }
> ```
>
> ## Dockerfile
>
> ```dockerfile
> FROM cypress/included:13.13.2
> WORKDIR /app
> COPY package*.json ./
> RUN npm ci
> COPY server ./server
> COPY public ./public
> RUN mkdir -p /app/runs
> EXPOSE 3000
> CMD ["node", "server/index.js"]
> ```
>
> ## Acceptance criteria
>
> * **Local**:
>
>   1. `docker build -t cypress-video-runner .`
>   2. `docker run -p 3000:3000 cypress-video-runner`
>   3. Open `http://localhost:3000`
>   4. **Test A (single file)**: upload `demo.cy.js` that visits a public URL and asserts something → see logs → after finish, inline video appears with **Download** link.
>   5. **Test B (zip)**: upload a ZIP with `cypress/e2e/*.cy.js` (+ optional config) → same behavior.
>   6. `/runs` returns run metadata; `/runs/:id` lists artifacts; `/results/<id>/results.json` is downloadable.
> * **On sherpa.sh**: same behavior at the public app URL on port 3000.
>
> ## Security notes (comment in code)
>
> * Treat uploads as untrusted; in production add auth, size limits, MIME checks, storage quotas, and periodic cleanup.
> * Do not execute arbitrary user scripts outside Cypress.
>
> ## Nice-to-haves (if time permits)
>
> * Show spec filename next to the video when single-file mode is used.
> * Add a “Copy shareable link” to each video.
> * Basic dark mode toggle.


