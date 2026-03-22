const { Router } = require('express');
const { query } = require('../db/connection');
const { liveCache, shortCache, staticCache } = require('../middleware/cache-headers');
const { CURRENT_SEASON } = require('../sync/dataset-configs');

const standings = Router();
const leaders = Router();
const games = Router();
const compare = Router();

// ── Standings ─────────────────────────────────────────────

// GET /api/standings?season=2024&conf=AFC
standings.get('/', liveCache, async (req, res) => {
  const season = parseInt(req.query.season) || CURRENT_SEASON;
  const conf = req.query.conf?.toUpperCase();

  const conditions = ['season = $1'];
  const params = [season];

  if (conf === 'AFC' || conf === 'NFC') {
    conditions.push('team_conf = $2');
    params.push(conf);
  }

  const { rows } = await query(
    `SELECT * FROM standings
     WHERE ${conditions.join(' AND ')}
     ORDER BY win_pct DESC, point_diff DESC`,
    params
  );
  res.json(rows);
});


// ── Stat Leaders ──────────────────────────────────────────

const ALLOWED_STATS = [
  'passing_yards', 'passing_tds', 'passer_rating', 'interceptions',
  'rushing_yards', 'rushing_tds', 'carries',
  'receptions', 'receiving_yards', 'receiving_tds', 'targets',
  'fantasy_points', 'fantasy_points_ppr',
  'fg_made', 'fg_pct', 'sacks',
];

// GET /api/leaders?season=2024&stat=passing_yards&limit=25&position=QB
leaders.get('/', liveCache, async (req, res) => {
  const season = parseInt(req.query.season) || CURRENT_SEASON;
  const stat = req.query.stat || 'passing_yards';
  const limit = Math.min(parseInt(req.query.limit) || 25, 100);
  const position = req.query.position;

  if (!ALLOWED_STATS.includes(stat)) {
    return res.status(400).json({ error: `Invalid stat. Allowed: ${ALLOWED_STATS.join(', ')}` });
  }

  const conditions = ['s.season = $1', `s.${stat} IS NOT NULL`, `s.${stat} > 0`];
  const params = [season];
  let i = 2;

  if (position) {
    conditions.push(`s.position = $${i}`);
    params.push(position);
    i++;
  }

  const { rows } = await query(
    `SELECT s.player_id, s.player_display_name, s.position, s.recent_team, s.games,
            s.${stat},
            s.passing_yards, s.passing_tds, s.rushing_yards, s.rushing_tds,
            s.receiving_yards, s.receiving_tds, s.receptions, s.fantasy_points_ppr,
            p.headshot, t.team_logo_espn, t.team_name, t.team_color
     FROM player_stats_season s
     LEFT JOIN players p ON p.gsis_id = s.player_id
     LEFT JOIN teams t ON t.team_abbr = s.recent_team
     WHERE ${conditions.join(' AND ')}
     ORDER BY s.${stat} DESC
     LIMIT $${i}`,
    [...params, limit]
  );
  res.json(rows);
});


// ── Games / Scores ────────────────────────────────────────

// GET /api/scores?season=2024&week=14
games.get('/scores', shortCache, async (req, res) => {
  const season = parseInt(req.query.season) || CURRENT_SEASON;
  const week = req.query.week ? parseInt(req.query.week) : null;

  const conditions = ['s.season = $1'];
  const params = [season];
  let i = 2;

  if (week) {
    conditions.push(`s.week = $${i}`);
    params.push(week);
    i++;
  }

  const { rows } = await query(
    `SELECT s.*,
            ht.team_name AS home_name, ht.team_logo_espn AS home_logo, ht.team_color AS home_color,
            at.team_name AS away_name, at.team_logo_espn AS away_logo, at.team_color AS away_color
     FROM schedules s
     LEFT JOIN teams ht ON ht.team_abbr = s.home_team
     LEFT JOIN teams at ON at.team_abbr = s.away_team
     WHERE ${conditions.join(' AND ')}
     ORDER BY s.week, s.gameday, s.gametime`,
    params
  );
  res.json(rows);
});

// GET /api/scores/latest — most recent completed week
games.get('/scores/latest', shortCache, async (req, res) => {
  const season = parseInt(req.query.season) || CURRENT_SEASON;

  const { rows: [latestWeek] } = await query(
    `SELECT MAX(week) AS week FROM schedules
     WHERE season = $1 AND game_type = 'REG' AND home_score IS NOT NULL`,
    [season]
  );

  if (!latestWeek?.week) return res.json([]);

  const { rows } = await query(
    `SELECT s.*,
            ht.team_name AS home_name, ht.team_logo_espn AS home_logo,
            at.team_name AS away_name, at.team_logo_espn AS away_logo
     FROM schedules s
     LEFT JOIN teams ht ON ht.team_abbr = s.home_team
     LEFT JOIN teams at ON at.team_abbr = s.away_team
     WHERE s.season = $1 AND s.week = $2 AND s.game_type = 'REG'
     ORDER BY s.gameday, s.gametime`,
    [season, latestWeek.week]
  );
  res.json({ week: latestWeek.week, games: rows });
});

// GET /api/games/:game_id — single game detail with player stats
games.get('/:game_id', liveCache, async (req, res) => {
  const { game_id } = req.params;

  const [gameResult, statsResult] = await Promise.all([
    query(
      `SELECT s.*,
              ht.team_name AS home_name, ht.team_logo_espn AS home_logo, ht.team_color AS home_color,
              at.team_name AS away_name, at.team_logo_espn AS away_logo, at.team_color AS away_color
       FROM schedules s
       LEFT JOIN teams ht ON ht.team_abbr = s.home_team
       LEFT JOIN teams at ON at.team_abbr = s.away_team
       WHERE s.game_id = $1`,
      [game_id]
    ),
    // Parse season/week from game_id format: "2024_14_KC_BUF"
    query(
      `SELECT w.* FROM player_stats_weekly w
       WHERE w.season = $1 AND w.week = $2
         AND (w.recent_team = $3 OR w.recent_team = $4)
       ORDER BY w.recent_team, w.position, w.fantasy_points_ppr DESC NULLS LAST`,
      [
        ...game_id.split('_').slice(0, 2).map(Number),
        ...game_id.split('_').slice(2),
      ]
    ),
  ]);

  if (!gameResult.rows.length) return res.status(404).json({ error: 'Game not found' });

  res.json({
    game: gameResult.rows[0],
    playerStats: statsResult.rows,
  });
});


// ── Compare ───────────────────────────────────────────────

// GET /api/compare?p1=ID&p2=ID&season=2024
compare.get('/', liveCache, async (req, res) => {
  const { p1, p2 } = req.query;
  const season = parseInt(req.query.season) || CURRENT_SEASON;

  if (!p1 || !p2) return res.status(400).json({ error: 'Provide p1 and p2 player IDs' });

  const [bio1, bio2, stats1, stats2, career1, career2] = await Promise.all([
    query('SELECT * FROM players WHERE gsis_id = $1', [p1]),
    query('SELECT * FROM players WHERE gsis_id = $1', [p2]),
    query('SELECT * FROM player_stats_season WHERE player_id = $1 AND season = $2', [p1, season]),
    query('SELECT * FROM player_stats_season WHERE player_id = $1 AND season = $2', [p2, season]),
    query('SELECT * FROM player_stats_season WHERE player_id = $1 ORDER BY season DESC', [p1]),
    query('SELECT * FROM player_stats_season WHERE player_id = $1 ORDER BY season DESC', [p2]),
  ]);

  res.json({
    player1: { bio: bio1.rows[0] || null, season: stats1.rows[0] || null, career: career1.rows },
    player2: { bio: bio2.rows[0] || null, season: stats2.rows[0] || null, career: career2.rows },
  });
});


module.exports = { standings, leaders, games, compare };
