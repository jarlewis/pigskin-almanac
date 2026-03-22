# Pigskin Almanac — Render + PostgreSQL Architecture

## Why This Approach

**Before (client-side CSV):**
```
Browser → GitHub (3-8s download) → PapaParse (200-500ms parse) → Render UI
         ↑ Every page, every user, every time
```

**After (server-side Postgres):**
```
Browser → Render API (50-150ms JSON) → Render UI
                ↓
          PostgreSQL (indexed, pre-parsed)
                ↑
          Cron Sync Job (every 15 min, pulls nflverse CSVs into Postgres)
```

**Performance gains:**
- API responses: ~50-150ms vs 3-8s (CSV download + parse)
- Payload size: ~10-50KB JSON vs 1-5MB CSV (only send what the page needs)
- Queries: SQL filtering/sorting/pagination vs client-side JS
- Cold start: Zero — data is always in Postgres, ready to serve

---

## Render Services

| Service              | Render Type       | Details                               |
|----------------------|-------------------|---------------------------------------|
| **API Server**       | Web Service       | Node.js/Express, serves JSON API      |
| **PostgreSQL**       | Render Database   | Stores all nflverse data              |
| **Sync Worker**      | Cron Job          | Pulls CSVs → Postgres every 15 min    |
| **Frontend**         | Static Site       | HTML/JS served from Render CDN        |

---

## Database Schema

### `teams`
Core team reference data. Updated daily from `teams.csv`.

### `players`
Player bios and IDs. Updated every 12h from `players.csv`.

### `schedules`
Game results and upcoming games. Updated every 15 min from `schedules.csv`.

### `player_stats_weekly`
Per-game player stats. Updated after games from `player_stats_{season}.csv`.

### `player_stats_season`
Season totals per player. Updated after games from `player_stats_reg_{season}.csv`.

### `team_stats`
Team-level season stats. Updated after games from `team_stats_reg_{season}.csv`.

### `rosters`
Season-level rosters. Updated daily from `roster_{season}.csv`.

### `draft_picks`
Historical draft data. Updated yearly from `draft_picks.csv`.

### `sync_log`
Tracks last sync time per dataset to avoid redundant re-imports.

---

## Sync Strategy

The sync job runs every 15 minutes and checks each dataset:

1. Fetch the CSV from GitHub with `If-Modified-Since` header
2. If `304 Not Modified` → skip (no new data)
3. If `200` → parse CSV, upsert rows into Postgres, update `sync_log`

This means during the offseason, the sync job does almost nothing (everything returns 304). During game days, it picks up new scores and stats within 15 minutes.

**Season-aware sync:** The job only syncs the current season's weekly data. Historical seasons are synced once and then left alone.

---

## API Design

All endpoints return JSON. The API is read-only — no auth required.

```
GET /api/teams                              → all 32 teams
GET /api/teams/:abbr                        → single team with computed record
GET /api/teams/:abbr/roster?season=2024     → team roster
GET /api/teams/:abbr/schedule?season=2024   → team schedule + results
GET /api/teams/:abbr/stats?season=2024      → team offensive/defensive totals

GET /api/players?search=mahomes             → fuzzy player search
GET /api/players/:id                        → player bio
GET /api/players/:id/stats?season=2024      → season totals
GET /api/players/:id/gamelog?season=2024     → weekly game log
GET /api/players/:id/career                 → multi-season career stats

GET /api/standings?season=2024&conf=AFC     → computed standings
GET /api/leaders?season=2024&stat=passing_yards&limit=25  → stat leaders
GET /api/scores?season=2024&week=14         → game scores for a week
GET /api/games/:game_id                     → single game box score

GET /api/compare?p1=00-0033873&p2=00-0035228&season=2024  → side-by-side stats

GET /api/sync/status                        → last sync times per dataset
```

---

## Folder Structure

```
pigskin-almanac/
├── package.json
├── render.yaml                    ← Render Blueprint (IaC)
├── scripts/
│   └── init-db.sql                ← Schema + indexes
├── src/
│   ├── server.js                  ← Express entry point
│   ├── db/
│   │   ├── connection.js          ← pg Pool setup
│   │   └── schema.sql             ← Full DDL
│   ├── sync/
│   │   ├── sync-runner.js         ← Main sync orchestrator
│   │   ├── csv-fetcher.js         ← Download + parse CSV
│   │   └── dataset-configs.js     ← Per-dataset sync config
│   ├── routes/
│   │   ├── teams.js
│   │   ├── players.js
│   │   ├── standings.js
│   │   ├── leaders.js
│   │   ├── games.js
│   │   └── compare.js
│   └── middleware/
│       └── cache-headers.js       ← HTTP cache-control
```

---

## Deployment

### Option A: Render Blueprint (`render.yaml`)

One-click deploy. Render reads the YAML and provisions all services.

### Option B: Manual Setup

1. Create a PostgreSQL database on Render (choose the free tier to start)
2. Create a Web Service pointing to your repo
3. Set environment variables:
   - `DATABASE_URL` → Render provides this automatically
   - `NODE_ENV=production`
   - `CURRENT_SEASON=2025`
4. Run `scripts/init-db.sql` against your database
5. Deploy — the sync job runs on startup and then every 15 min via `node-cron`

---

## Cost Estimate (Render)

| Resource          | Tier          | Cost/mo  |
|-------------------|---------------|----------|
| PostgreSQL        | Starter       | $7       |
| Web Service       | Starter       | $7       |
| Static Site       | Free          | $0       |
| **Total**         |               | **$14**  |

The free tier works for development (PostgreSQL free tier expires after 90 days on Render, so plan to upgrade for production).
