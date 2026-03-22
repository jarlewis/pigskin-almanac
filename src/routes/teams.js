const { Router } = require('express');
const { query } = require('../db/connection');
const { staticCache, liveCache } = require('../middleware/cache-headers');
const { CURRENT_SEASON } = require('../sync/dataset-configs');

const router = Router();

// GET /api/teams — all 32 teams
router.get('/', staticCache, async (req, res) => {
  const { rows } = await query(
    `SELECT * FROM teams WHERE team_abbr NOT IN ('OAK','SD','STL') ORDER BY team_name`
  );
  res.json(rows);
});

// GET /api/teams/:abbr — single team with current record
router.get('/:abbr', liveCache, async (req, res) => {
  const { abbr } = req.params;
  const season = parseInt(req.query.season) || CURRENT_SEASON;

  const [teamResult, standingsResult] = await Promise.all([
    query('SELECT * FROM teams WHERE team_abbr = $1', [abbr.toUpperCase()]),
    query('SELECT * FROM standings WHERE team = $1 AND season = $2', [abbr.toUpperCase(), season]),
  ]);

  if (!teamResult.rows.length) return res.status(404).json({ error: 'Team not found' });

  res.json({
    ...teamResult.rows[0],
    record: standingsResult.rows[0] || null,
  });
});

// GET /api/teams/:abbr/roster
router.get('/:abbr/roster', staticCache, async (req, res) => {
  const { abbr } = req.params;
  const season = parseInt(req.query.season) || CURRENT_SEASON;

  const { rows } = await query(
    `SELECT * FROM rosters WHERE team = $1 AND season = $2 ORDER BY position, full_name`,
    [abbr.toUpperCase(), season]
  );
  res.json(rows);
});

// GET /api/teams/:abbr/schedule
router.get('/:abbr/schedule', liveCache, async (req, res) => {
  const { abbr } = req.params;
  const season = parseInt(req.query.season) || CURRENT_SEASON;
  const team = abbr.toUpperCase();

  const { rows } = await query(
    `SELECT * FROM schedules
     WHERE season = $1 AND (home_team = $2 OR away_team = $2)
     ORDER BY week`,
    [season, team]
  );
  res.json(rows);
});

// GET /api/teams/:abbr/stats
router.get('/:abbr/stats', liveCache, async (req, res) => {
  const { abbr } = req.params;
  const season = parseInt(req.query.season) || CURRENT_SEASON;
  const team = abbr.toUpperCase();

  const { rows } = await query(
    `SELECT
       SUM(passing_yards) AS total_pass_yards,
       SUM(passing_tds) AS total_pass_tds,
       SUM(rushing_yards) AS total_rush_yards,
       SUM(rushing_tds) AS total_rush_tds,
       SUM(receiving_yards) AS total_rec_yards,
       SUM(receiving_tds) AS total_rec_tds,
       SUM(interceptions) AS total_ints,
       SUM(fantasy_points_ppr) AS total_fantasy_ppr
     FROM player_stats_season
     WHERE recent_team = $1 AND season = $2`,
    [team, season]
  );
  res.json(rows[0] || {});
});

module.exports = router;
