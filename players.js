const { Router } = require('express');
const { query } = require('../db/connection');
const { staticCache, liveCache } = require('../middleware/cache-headers');
const { CURRENT_SEASON } = require('../sync/dataset-configs');

const router = Router();

// GET /api/players?search=mahomes&position=QB&team=KC&limit=25
router.get('/', liveCache, async (req, res) => {
  const { search, position, team, status, limit = 50 } = req.query;
  const conditions = [];
  const params = [];
  let i = 1;

  if (search) {
    conditions.push(`display_name ILIKE $${i}`);
    params.push(`%${search}%`);
    i++;
  }
  if (position) { conditions.push(`position = $${i}`); params.push(position); i++; }
  if (team) { conditions.push(`team_abbr = $${i}`); params.push(team.toUpperCase()); i++; }
  if (status) { conditions.push(`status = $${i}`); params.push(status); i++; }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows } = await query(
    `SELECT gsis_id, display_name, position, position_group, team_abbr, jersey_number,
            status, headshot, height, weight, birth_date, college, years_of_experience
     FROM players ${where}
     ORDER BY display_name
     LIMIT $${i}`,
    [...params, Math.min(parseInt(limit), 200)]
  );
  res.json(rows);
});

// GET /api/players/:id — full player bio
router.get('/:id', staticCache, async (req, res) => {
  const { rows } = await query('SELECT * FROM players WHERE gsis_id = $1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Player not found' });
  res.json(rows[0]);
});

// GET /api/players/:id/stats?season=2024
router.get('/:id/stats', liveCache, async (req, res) => {
  const season = parseInt(req.query.season) || CURRENT_SEASON;
  const { rows } = await query(
    'SELECT * FROM player_stats_season WHERE player_id = $1 AND season = $2',
    [req.params.id, season]
  );
  res.json(rows[0] || null);
});

// GET /api/players/:id/gamelog?season=2024
router.get('/:id/gamelog', liveCache, async (req, res) => {
  const season = parseInt(req.query.season) || CURRENT_SEASON;
  const { rows } = await query(
    `SELECT * FROM player_stats_weekly
     WHERE player_id = $1 AND season = $2
     ORDER BY week`,
    [req.params.id, season]
  );
  res.json(rows);
});

// GET /api/players/:id/career — all seasons
router.get('/:id/career', staticCache, async (req, res) => {
  const { rows } = await query(
    `SELECT * FROM player_stats_season
     WHERE player_id = $1
     ORDER BY season DESC`,
    [req.params.id]
  );
  res.json(rows);
});

module.exports = router;
