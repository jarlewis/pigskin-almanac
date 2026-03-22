# Local Development Setup

## Prerequisites

- **Node.js 20+** — `node --version`
- **Podman** — `podman --version` (no daemon required, rootless by default)
- **psql** CLI — `psql --version` (for running SQL scripts against the database)

### Installing Prerequisites

**Podman:**
```bash
# Mac
brew install podman
podman machine init
podman machine start

# Fedora / RHEL / CentOS
sudo dnf install podman

# Ubuntu / Debian
sudo apt install podman

# Windows
# Download from https://podman.io — includes podman-desktop GUI
winget install RedHat.Podman
# Then: podman machine init && podman machine start
```

**psql CLI (if not already installed):**
```bash
# Mac
brew install libpq && brew link --force libpq

# Ubuntu / Debian
sudo apt install postgresql-client

# Fedora / RHEL
sudo dnf install postgresql

# Windows — comes with the Postgres installer, or:
# scoop install postgresql
```

---

## 1. Start Postgres with Podman

```bash
podman run -d \
  --name pigskin-db \
  -e POSTGRES_USER=pigskin \
  -e POSTGRES_PASSWORD=pigskin \
  -e POSTGRES_DB=pigskin_almanac \
  -p 5432:5432 \
  postgres:16
```

Verify it's running:

```bash
podman ps
# CONTAINER ID  IMAGE                       STATUS       PORTS                   NAMES
# a1b2c3d4e5f6  docker.io/library/postgres  Up 5 sec...  0.0.0.0:5432->5432/tcp  pigskin-db

psql postgresql://pigskin:pigskin@localhost:5432/pigskin_almanac -c "SELECT 1"
# Should return:  1
```

> **Podman on Mac/Windows:** If `localhost` doesn't connect, the Podman
> machine may use a different IP. Check with `podman machine inspect`
> and look for the `ConnectionInfo` address, or try `127.0.0.1` explicitly.

---

## 2. Project Setup

```bash
cd pigskin-almanac
cp .env.example .env
npm install
```

The `.env` file should contain:

```
DATABASE_URL=postgresql://pigskin:pigskin@localhost:5432/pigskin_almanac
NODE_ENV=development
CURRENT_SEASON=2024
SYNC_ON_STARTUP=false
SYNC_CRON=*/15 * * * *
PORT=3001
```

> Set `CURRENT_SEASON=2024` for testing since 2025 data may be
> incomplete depending on when you're running this.

`dotenv` is already included in `package.json` and loaded by
`server.js` and `sync-runner.js` — no manual step needed.

---

## 3. Initialize the Database

```bash
source .env
psql $DATABASE_URL -f scripts/init-db.sql
```

You should see:

```
CREATE TABLE
CREATE INDEX
...
 Schema initialized successfully
```

Verify tables exist:

```bash
psql $DATABASE_URL -c "\dt"
```

---

## 4. Load Data

### Quick start: current season only (~2 minutes)

```bash
node -e "
require('dotenv').config();
const { syncDataset } = require('./src/sync/sync-runner');

const quickLoad = [
  { key:'teams', tag:'teams', file:'teams.csv', table:'teams', upsertKey:['team_abbr'], interval:0 },
  { key:'players', tag:'players', file:'players.csv', table:'players', upsertKey:['gsis_id'], interval:0 },
  { key:'schedules', tag:'schedules', file:'schedules.csv', table:'schedules', upsertKey:['game_id'], interval:0 },
  { key:'draft_picks', tag:'draft_picks', file:'draft_picks.csv', table:'draft_picks', upsertKey:['season','pick'], interval:0 },
  { key:'ps_reg_2024', tag:'player_stats', file:'player_stats_reg_2024.csv', table:'player_stats_season', upsertKey:['player_id','season'], extraColumns:{season:2024}, interval:0 },
  { key:'ps_wk_2024', tag:'player_stats', file:'player_stats_2024.csv', table:'player_stats_weekly', upsertKey:['player_id','season','week'], extraColumns:{season:2024}, interval:0 },
  { key:'rosters_2024', tag:'rosters', file:'roster_2024.csv', table:'rosters', upsertKey:['season','team','gsis_id'], extraColumns:{season:2024}, interval:0 },
];

(async () => {
  for (const ds of quickLoad) {
    try {
      const r = await syncDataset(ds, true);
      console.log(r.status === 'synced' ? '✓ ' + r.key + ': ' + r.rows + ' rows' : '→ ' + r.key + ': ' + r.status);
    } catch(e) { console.error('✗ ' + ds.key + ': ' + e.message); }
  }
  console.log('\\nDone! Refreshing standings...');
  const { query } = require('./src/db/connection');
  await query('REFRESH MATERIALIZED VIEW standings');
  console.log('Standings ready.');
  process.exit(0);
})();
"
```

### Load a range of seasons (~5 minutes for 5 seasons)

```bash
node -e "
require('dotenv').config();
const { syncDataset } = require('./src/sync/sync-runner');
const { ALL_DATASETS } = require('./src/sync/dataset-configs');

(async () => {
  const targets = ALL_DATASETS.filter(d =>
    !d.extraColumns || (d.extraColumns.season >= 2020 && d.extraColumns.season <= 2024)
  );
  console.log('Loading ' + targets.length + ' datasets...');
  for (const ds of targets) {
    try {
      const r = await syncDataset(ds, true);
      if (r.status === 'synced') console.log('✓ ' + r.key + ': ' + r.rows + ' rows');
    } catch(e) { if (!e.message.includes('404')) console.error('✗ ' + ds.key + ': ' + e.message); }
    await new Promise(r => setTimeout(r, 300));
  }
  const { query } = require('./src/db/connection');
  await query('REFRESH MATERIALIZED VIEW standings');
  console.log('Done!');
  process.exit(0);
})();
"
```

### Full backfill: all seasons 1999–2024 (~15-30 minutes)

```bash
npm run sync:backfill
```

---

## 5. Start the Server

```bash
npm run dev
```

Expected output:

```
[server] Pigskin Almanac API running on port 3001
[server] Season: 2024 | 235 datasets (31 live, 199 archive)
[server] Ranges: player_stats 1999-2025, rosters 2002-2025, snap_counts 2012-2025
[server] Live sync cron scheduled: */15 * * * *
```

---

## 6. Test the API

Open another terminal:

```bash
# Health check
curl http://localhost:3001/health

# Sync status — see what's loaded
curl http://localhost:3001/api/sync/status | jq .

# All 32 teams
curl http://localhost:3001/api/teams | jq '.[0:3]'

# Single team with record
curl http://localhost:3001/api/teams/KC?season=2024 | jq .

# Team roster
curl http://localhost:3001/api/teams/SF/roster?season=2024 | jq '.[0:5]'

# Team schedule
curl http://localhost:3001/api/teams/BUF/schedule?season=2024 | jq '.[0:3]'

# Player search
curl "http://localhost:3001/api/players?search=mahomes" | jq .

# Player season stats
curl http://localhost:3001/api/players/00-0033873/stats?season=2024 | jq .

# Player game log
curl http://localhost:3001/api/players/00-0033873/gamelog?season=2024 | jq '.[0:3]'

# Player career (all seasons)
curl http://localhost:3001/api/players/00-0033873/career | jq .

# AFC standings
curl "http://localhost:3001/api/standings?season=2024&conf=AFC" | jq '.[0:5]'

# Passing leaders
curl "http://localhost:3001/api/leaders?season=2024&stat=passing_yards&limit=10" | jq .

# Latest scores
curl "http://localhost:3001/api/games/scores/latest?season=2024" | jq .

# Compare two players
curl "http://localhost:3001/api/compare?p1=00-0033873&p2=00-0035228&season=2024" | jq .
```

> Install `jq` for pretty JSON: `brew install jq` / `sudo apt install jq` / `sudo dnf install jq`

---

## 7. Test with the Frontend

Put your HTML files in a `frontend/` folder inside the project, then run the dev proxy server:

```bash
# Terminal 1: API server
npm run dev

# Terminal 2: Frontend + proxy (serves HTML on :8080, proxies /api/* to :3001)
npm run dev:frontend
```

Open `http://localhost:8080/dashboard.html` — everything is same-origin, no CORS issues.

In your HTML files, API calls just use relative paths:

```javascript
const teams = await fetch('/api/teams').then(r => r.json());
const leaders = await fetch('/api/leaders?season=2024&stat=passing_yards').then(r => r.json());
```

---

## Inspect the Database

```bash
psql $DATABASE_URL
```

```sql
-- Row counts across all tables
SELECT 'teams' AS tbl, COUNT(*) FROM teams
UNION ALL SELECT 'players', COUNT(*) FROM players
UNION ALL SELECT 'schedules', COUNT(*) FROM schedules
UNION ALL SELECT 'player_stats_season', COUNT(*) FROM player_stats_season
UNION ALL SELECT 'player_stats_weekly', COUNT(*) FROM player_stats_weekly
UNION ALL SELECT 'rosters', COUNT(*) FROM rosters
UNION ALL SELECT 'draft_picks', COUNT(*) FROM draft_picks
UNION ALL SELECT 'standings', COUNT(*) FROM standings;

-- Top 5 passers in 2024
SELECT player_display_name, recent_team, passing_yards, passing_tds
FROM player_stats_season
WHERE season = 2024
ORDER BY passing_yards DESC
LIMIT 5;

-- 49ers 2024 record
SELECT team, wins, losses, ties, win_pct, points_for, points_against, point_diff
FROM standings
WHERE team = 'SF' AND season = 2024;

-- What's been synced
SELECT dataset_key, row_count, last_synced, duration_ms
FROM sync_log
ORDER BY last_synced DESC
LIMIT 20;
```

---

## Podman Management

```bash
# Check container status
podman ps -a

# View Postgres logs
podman logs pigskin-db

# Stop (preserves data)
podman stop pigskin-db

# Start again later
podman start pigskin-db

# Stop and delete (data is gone)
podman stop pigskin-db && podman rm pigskin-db

# Shell into the container
podman exec -it pigskin-db psql -U pigskin pigskin_almanac
```

### Persist data across container rebuilds

By default, `podman rm` destroys the database. To keep data on disk:

```bash
# Create a named volume
podman volume create pigskin-pgdata

# Start with volume mount
podman run -d \
  --name pigskin-db \
  -e POSTGRES_USER=pigskin \
  -e POSTGRES_PASSWORD=pigskin \
  -e POSTGRES_DB=pigskin_almanac \
  -p 5432:5432 \
  -v pigskin-pgdata:/var/lib/postgresql/data \
  postgres:16
```

Now you can `podman rm pigskin-db` and recreate it — the volume keeps your data.

```bash
# List volumes
podman volume ls

# Inspect a volume (see where it lives on disk)
podman volume inspect pigskin-pgdata

# Nuclear option: delete volume and all data
podman volume rm pigskin-pgdata
```

---

## Troubleshooting

### "connection refused" on port 5432
Container isn't running:
```bash
podman start pigskin-db
```

If on Mac/Windows, make sure the Podman machine is up:
```bash
podman machine start
```

### "could not connect to server" after Podman machine restart
The machine IP may have changed. Check:
```bash
podman machine inspect --format '{{.ConnectionInfo.PodmanSocket.Path}}'
```
Or just use `podman machine stop && podman machine start` and retry.

### "relation does not exist"
Run the schema script:
```bash
source .env && psql $DATABASE_URL -f scripts/init-db.sql
```

### Sync errors with 404
Expected for old seasons missing certain file types (snap_counts before 2012, nextgen before 2016). The sync runner logs `not_found` and continues.

### "cannot refresh materialized view concurrently"
First run has no data in the view. The sync runner handles this automatically. If you hit it manually:
```bash
psql $DATABASE_URL -c "REFRESH MATERIALIZED VIEW standings"
```

### Rootless Podman: port 5432 permission denied
On Linux, rootless Podman can't bind ports below 1024 by default. Either:
```bash
# Use a higher port
podman run -d --name pigskin-db ... -p 15432:5432 postgres:16
# Then update .env: DATABASE_URL=postgresql://pigskin:pigskin@localhost:15432/pigskin_almanac
```
Or allow low ports:
```bash
sudo sysctl net.ipv4.ip_unprivileged_port_start=0
```

### Slow backfill
The 500ms delay between GitHub requests is intentional — GitHub rate limits unauthenticated requests to 60/hour. If you're authenticated, you can reduce the delay in `sync-runner.js`.
