require('dotenv').config();
const express = require('express');
const cors = require('cors');
const compression = require('compression');
const helmet = require('helmet');
const cron = require('node-cron');

const teamsRoutes = require('./routes/teams');
const playersRoutes = require('./routes/players');
const { standings, leaders, games, compare } = require('./routes/standings');
const { runFullSync, runLiveSync, runBackfill, datasetStats } = require('./sync/sync-runner');
const { CURRENT_SEASON } = require('./sync/dataset-configs');
const { query } = require('./db/connection');

const app = express();
const PORT = process.env.PORT || 3001;

// ── Middleware ─────────────────────────────────────────────

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  maxAge: 86400,
}));
app.use(compression());
app.use(express.json());

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (req.path.startsWith('/api')) {
      console.log(`${req.method} ${req.path} → ${res.statusCode} (${duration}ms)`);
    }
  });
  next();
});

// ── API Routes ────────────────────────────────────────────

app.use('/api/teams', teamsRoutes);
app.use('/api/players', playersRoutes);
app.use('/api/standings', standings);
app.use('/api/leaders', leaders);
app.use('/api/games', games);
app.use('/api/compare', compare);

// Sync status endpoint
app.get('/api/sync/status', async (req, res) => {
  const { rows } = await query(
    'SELECT dataset_key, last_synced, row_count, duration_ms FROM sync_log ORDER BY last_synced DESC'
  );
  const stats = datasetStats();
  res.json({
    datasets: rows,
    config: stats,
    server_time: new Date().toISOString(),
    season: process.env.CURRENT_SEASON || '2025',
  });
});

// Manual sync trigger (protected — add auth in production)
app.post('/api/sync/trigger', async (req, res) => {
  const mode = req.query.mode || 'live'; // live | backfill | full
  try {
    let results;
    if (mode === 'backfill') results = await runBackfill(req.query.force === 'true');
    else if (mode === 'full') results = await runFullSync();
    else results = await runLiveSync();
    res.json({ status: 'complete', mode, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// ── Error handling ────────────────────────────────────────

app.use((err, req, res, _next) => {
  console.error(`[error] ${req.method} ${req.path}:`, err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Start server ──────────────────────────────────────────

app.listen(PORT, async () => {
  const stats = datasetStats();
  console.log(`[server] Pigskin Almanac API running on port ${PORT}`);
  console.log(`[server] Season: ${CURRENT_SEASON} | ${stats.total} datasets (${stats.live} live, ${stats.backfill} archive)`);
  console.log(`[server] Ranges: player_stats 1999-${CURRENT_SEASON}, rosters 2002-${CURRENT_SEASON}, snap_counts 2012-${CURRENT_SEASON}`);

  // On first startup, backfill historical data (runs once, skips if already done)
  if (process.env.SYNC_ON_STARTUP === 'true') {
    console.log('[server] Running startup backfill + live sync...');
    try {
      await runBackfill();  // Only fetches seasons not yet in sync_log
      await runLiveSync();  // Current season + single-file datasets
    } catch (err) {
      console.error('[server] Startup sync failed:', err.message);
    }
  }

  // Cron: only live sync (current season) — fast, runs every 15 min
  const cronSchedule = process.env.SYNC_CRON || '*/15 * * * *';
  cron.schedule(cronSchedule, async () => {
    try {
      await runLiveSync();
    } catch (err) {
      console.error('[cron] Live sync failed:', err.message);
    }
  });
  console.log(`[server] Live sync cron scheduled: ${cronSchedule}`);
});
