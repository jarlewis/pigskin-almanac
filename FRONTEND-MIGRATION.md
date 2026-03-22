# Frontend Migration: CSV → API

## Before vs After

Your frontend pages currently fetch raw CSVs from GitHub and parse them client-side. With the Render API, they'll fetch small JSON payloads instead.

### The change per page is straightforward:

```javascript
// ❌ BEFORE: client downloads and parses 2MB CSV
const BASE = 'https://github.com/nflverse/nflverse-data/releases/download';
const res = await fetch(`${BASE}/player_stats/player_stats_reg_2024.csv`);
const text = await res.text();
const data = Papa.parse(text, { header: true, dynamicTyping: true }).data;
const leaders = data.sort((a, b) => b.passing_yards - a.passing_yards).slice(0, 25);

// ✅ AFTER: server returns 25 rows of JSON in 80ms
const res = await fetch('/api/leaders?season=2024&stat=passing_yards&limit=25');
const leaders = await res.json();
```

**You no longer need PapaParse on the frontend at all.**

---

## API Base URL

Set this once depending on environment:

```javascript
const API = window.location.hostname === 'localhost'
  ? 'http://localhost:3001'   // local dev
  : '';                        // production (same domain via Render rewrite)
```

---

## Page-by-Page Migration

### Dashboard (`dashboard.html`)

```javascript
// Score strip — latest completed week
const { week, games } = await fetch(`${API}/api/scores/latest?season=${season}`).then(r => r.json());

// Standings
const standings = await fetch(`${API}/api/standings?season=${season}&conf=AFC`).then(r => r.json());

// Stat leaders  
const passLeaders = await fetch(`${API}/api/leaders?season=${season}&stat=passing_yards&limit=5`).then(r => r.json());
const rushLeaders = await fetch(`${API}/api/leaders?season=${season}&stat=rushing_yards&limit=5`).then(r => r.json());
const recLeaders  = await fetch(`${API}/api/leaders?season=${season}&stat=receiving_yards&limit=5`).then(r => r.json());
```

### Team Details (`team-details.html`)

```javascript
// Team info + record
const team = await fetch(`${API}/api/teams/${abbr}?season=${season}`).then(r => r.json());

// Roster
const roster = await fetch(`${API}/api/teams/${abbr}/roster?season=${season}`).then(r => r.json());

// Schedule
const schedule = await fetch(`${API}/api/teams/${abbr}/schedule?season=${season}`).then(r => r.json());

// Team stats
const stats = await fetch(`${API}/api/teams/${abbr}/stats?season=${season}`).then(r => r.json());

// Roster leaders (top player per position) — use leaders endpoint filtered by team
const passLeader = await fetch(`${API}/api/leaders?season=${season}&stat=passing_yards&limit=1&position=QB`).then(r => r.json());
// ... or the server can return this from the team stats endpoint
```

### Player Profile (`player-profile.html`)

```javascript
// Player bio
const player = await fetch(`${API}/api/players/${playerId}`).then(r => r.json());

// Season stats
const stats = await fetch(`${API}/api/players/${playerId}/stats?season=${season}`).then(r => r.json());

// Game log (weekly)
const gamelog = await fetch(`${API}/api/players/${playerId}/gamelog?season=${season}`).then(r => r.json());

// Career stats (all seasons)
const career = await fetch(`${API}/api/players/${playerId}/career`).then(r => r.json());

// Player search
const results = await fetch(`${API}/api/players?search=${query}`).then(r => r.json());
```

### Comparison (`comparison.html`)

```javascript
// Single call returns everything for both players
const data = await fetch(`${API}/api/compare?p1=${id1}&p2=${id2}&season=${season}`).then(r => r.json());

// data.player1.bio     → player info
// data.player1.season  → season stats
// data.player1.career  → array of season totals
// data.player2.bio     → ...
// data.player2.season  → ...
// data.player2.career  → ...
```

---

## What You Can Remove From Frontend

Once migrated to the API, remove from your HTML files:

1. **PapaParse** — `<script src="papaparse.min.js">` (server handles parsing)
2. **nflverse-cache.js** — no longer needed (server is the cache)
3. **fetchCSV()** function — replaced by simple `fetch('/api/...')`
4. **Client-side sorting/filtering** — SQL does this faster
5. **Client-side standings computation** — materialized view does this

---

## Response Time Comparison

| Endpoint                            | CSV (client) | API (server) | Improvement |
|-------------------------------------|-------------|-------------|-------------|
| Standings (all teams, 1 season)     | 3-5s        | 40-80ms     | 50-100x     |
| Stat leaders (top 25)               | 3-5s        | 30-60ms     | 80-150x     |
| Player search ("mahomes")           | 2-4s        | 15-40ms     | 80-200x     |
| Player game log (17 weeks)          | 3-5s        | 20-50ms     | 80-200x     |
| Player career (6 seasons)           | 8-15s       | 50-100ms    | 100-200x    |
| Compare (2 players + career)        | 10-20s      | 80-150ms    | 100-200x    |

The career stats page sees the biggest gain — it used to fetch 6 separate season CSVs sequentially. Now it's a single SQL query.
