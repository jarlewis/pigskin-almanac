const { query, getClient } = require('../db/connection');
const { fetchNflverseCSV } = require('./csv-fetcher');
const {
  ALL_DATASETS, LIVE_DATASETS, BACKFILL_DATASETS,
  datasetStats, TIER,
} = require('./dataset-configs');

// ── Helpers ───────────────────────────────────────────────

const needsSync = async (datasetKey, intervalMinutes) => {
  const result = await query(
    'SELECT last_synced, row_count FROM sync_log WHERE dataset_key = $1',
    [datasetKey]
  );
  if (result.rows.length === 0) return true;

  // Archive datasets with existing data: skip unless forced
  if (intervalMinutes >= TIER.ARCHIVE && result.rows[0].row_count > 0) {
    return false;
  }

  const elapsed = (Date.now() - new Date(result.rows[0].last_synced).getTime()) / 60000;
  return elapsed >= intervalMinutes;
};

const getSyncMeta = async (datasetKey) => {
  const result = await query(
    'SELECT last_modified, etag FROM sync_log WHERE dataset_key = $1',
    [datasetKey]
  );
  return result.rows[0] || {};
};

// ── Upsert Engine ─────────────────────────────────────────

const upsertRows = async (client, table, upsertKey, rows, extraColumns = {}) => {
  if (!rows.length) return 0;

  const tableColsResult = await client.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = $1`,
    [table]
  );
  const tableCols = new Set(tableColsResult.rows.map(r => r.column_name));

  const enrichedRows = rows.map(row => ({ ...row, ...extraColumns }));
  const dataCols = Object.keys(enrichedRows[0]).filter(c => tableCols.has(c.toLowerCase()));
  if (!dataCols.length) return 0;

  const colNames = dataCols.map(c => c.toLowerCase());
  const conflictCols = upsertKey.map(c => c.toLowerCase());
  const updateCols = colNames.filter(c => !conflictCols.includes(c));

  const BATCH = 500;
  let totalInserted = 0;

  for (let i = 0; i < enrichedRows.length; i += BATCH) {
    const batch = enrichedRows.slice(i, i + BATCH);
    const values = [];
    const placeholders = batch.map((row, ri) => {
      const rowPH = dataCols.map((col, ci) => {
        values.push(row[col] ?? null);
        return `$${ri * dataCols.length + ci + 1}`;
      });
      return `(${rowPH.join(',')})`;
    });

    const updateSet = updateCols.length
      ? `DO UPDATE SET ${updateCols.map(c => `${c} = EXCLUDED.${c}`).join(',')}`
      : 'DO NOTHING';

    await client.query(
      `INSERT INTO ${table} (${colNames.join(',')})
       VALUES ${placeholders.join(',')}
       ON CONFLICT (${conflictCols.join(',')}) ${updateSet}`,
      values
    );
    totalInserted += batch.length;
  }

  return totalInserted;
};

// ── Single Dataset Sync ───────────────────────────────────

const syncDataset = async (dataset, force = false) => {
  const start = Date.now();
  const { key, tag, file, table, upsertKey, extraColumns, interval } = dataset;

  if (!force && !(await needsSync(key, interval))) {
    return { key, status: 'skipped', reason: 'within interval or already backfilled' };
  }

  const meta = await getSyncMeta(key);
  let result;
  try {
    result = await fetchNflverseCSV(tag, file, {
      lastModified: force ? undefined : meta.last_modified,
      etag: force ? undefined : meta.etag,
    });
  } catch (err) {
    // Some historical files may not exist (e.g., very old seasons)
    if (err.message.includes('404')) {
      return { key, status: 'not_found', duration: Date.now() - start };
    }
    throw err;
  }

  if (result.notModified) {
    await query(
      `INSERT INTO sync_log (dataset_key, last_synced)
       VALUES ($1, NOW())
       ON CONFLICT (dataset_key) DO UPDATE SET last_synced = NOW()`,
      [key]
    );
    return { key, status: 'not_modified', duration: Date.now() - start };
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');
    const count = await upsertRows(client, table, upsertKey, result.data, extraColumns);
    await client.query('COMMIT');

    await query(
      `INSERT INTO sync_log (dataset_key, last_synced, last_modified, etag, row_count, duration_ms)
       VALUES ($1, NOW(), $2, $3, $4, $5)
       ON CONFLICT (dataset_key) DO UPDATE SET
         last_synced = NOW(), last_modified = $2, etag = $3, row_count = $4, duration_ms = $5`,
      [key, result.lastModified, result.etag, count, Date.now() - start]
    );

    return { key, status: 'synced', rows: count, duration: Date.now() - start };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

const refreshStandings = async () => {
  try {
    await query('REFRESH MATERIALIZED VIEW CONCURRENTLY standings');
  } catch {
    // View might not exist yet on first run, that's ok
    await query('REFRESH MATERIALIZED VIEW standings');
  }
};

// ── Sync Modes ────────────────────────────────────────────

/**
 * LIVE SYNC — runs on cron (every 15 min).
 * Only touches current season + single-file datasets.
 * Fast: ~10-30 datasets, most return 304 Not Modified.
 */
const runLiveSync = async () => {
  console.log(`[sync:live] Starting — ${LIVE_DATASETS.length} datasets to check`);
  const results = [];
  let synced = 0, skipped = 0, notMod = 0, errors = 0;

  for (const dataset of LIVE_DATASETS) {
    try {
      const result = await syncDataset(dataset);
      results.push(result);
      if (result.status === 'synced') { synced++; console.log(`  ✓ ${result.key}: ${result.rows} rows (${result.duration}ms)`); }
      else if (result.status === 'not_modified') { notMod++; }
      else { skipped++; }
    } catch (err) {
      errors++;
      console.error(`  ✗ ${dataset.key}: ${err.message}`);
      results.push({ key: dataset.key, status: 'error', error: err.message });
    }
  }

  await refreshStandings();
  console.log(`[sync:live] Done — synced:${synced} unchanged:${notMod} skipped:${skipped} errors:${errors}`);
  return results;
};

/**
 * BACKFILL — runs once on initial deploy or manually.
 * Downloads ALL historical seasons. Takes 10-30 minutes.
 * Rate-limited with a 500ms delay between datasets to avoid
 * hammering GitHub.
 */
const runBackfill = async (force = false) => {
  const stats = datasetStats();
  console.log(`[sync:backfill] Starting — ${stats.backfill} archive datasets`);
  console.log(`[sync:backfill] Season ranges: 1999-${stats.currentSeason}`);

  let synced = 0, skipped = 0, notFound = 0, errors = 0;

  for (const dataset of BACKFILL_DATASETS) {
    try {
      const result = await syncDataset(dataset, force);

      if (result.status === 'synced') {
        synced++;
        console.log(`  ✓ ${result.key}: ${result.rows} rows (${result.duration}ms)`);
      } else if (result.status === 'not_found') {
        notFound++;
        // Silently skip — some old seasons don't have all file types
      } else {
        skipped++;
      }

      // Rate limit: 500ms between GitHub requests
      await new Promise(r => setTimeout(r, 500));

    } catch (err) {
      errors++;
      console.error(`  ✗ ${dataset.key}: ${err.message}`);
      // Don't abort — continue with remaining datasets
    }
  }

  await refreshStandings();
  console.log(`[sync:backfill] Done — synced:${synced} skipped:${skipped} not_found:${notFound} errors:${errors}`);
};

/**
 * FULL SYNC — backfill + live.
 * Runs on first deploy: backfill archives, then do a live pass.
 */
const runFullSync = async () => {
  await runBackfill();
  await runLiveSync();
};

// ── CLI ───────────────────────────────────────────────────

if (require.main === module) {
  require('dotenv').config();
  const mode = process.argv[2] || 'live';
  const force = process.argv.includes('--force');

  const run = async () => {
    const stats = datasetStats();
    console.log(`[sync] ${stats.total} total datasets (${stats.live} live, ${stats.backfill} archive)`);

    if (mode === 'backfill') {
      await runBackfill(force);
    } else if (mode === 'full') {
      await runFullSync();
    } else {
      await runLiveSync();
    }
  };

  run()
    .then(() => { console.log('[sync] Exit 0'); process.exit(0); })
    .catch(err => { console.error('[sync] Fatal:', err); process.exit(1); });
}

module.exports = { runFullSync, runLiveSync, runBackfill, syncDataset, datasetStats };
