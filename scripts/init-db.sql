-- Pigskin Almanac — PostgreSQL Schema
-- Run once: psql $DATABASE_URL -f scripts/init-db.sql

-- ── Sync tracking ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sync_log (
  dataset_key   TEXT PRIMARY KEY,
  last_synced   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_modified TEXT,          -- HTTP Last-Modified header from GitHub
  etag          TEXT,          -- HTTP ETag header from GitHub
  row_count     INTEGER,
  duration_ms   INTEGER
);

-- ── Teams ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS teams (
  team_abbr         TEXT PRIMARY KEY,
  team_name         TEXT,
  team_nick         TEXT,
  team_conf         TEXT,
  team_division     TEXT,
  team_color        TEXT,
  team_color2       TEXT,
  team_color3       TEXT,
  team_color4       TEXT,
  team_logo_espn    TEXT,
  team_logo_wikipedia TEXT,
  team_wordmark     TEXT,
  team_id           INTEGER
);

CREATE INDEX IF NOT EXISTS idx_teams_conf ON teams(team_conf);
CREATE INDEX IF NOT EXISTS idx_teams_division ON teams(team_division);

-- ── Players ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS players (
  gsis_id               TEXT PRIMARY KEY,
  display_name          TEXT,
  first_name            TEXT,
  last_name             TEXT,
  position              TEXT,
  position_group        TEXT,
  team_abbr             TEXT,
  jersey_number         INTEGER,
  status                TEXT,
  status_description    TEXT,
  height                INTEGER,       -- inches
  weight                INTEGER,       -- lbs
  birth_date            DATE,
  college               TEXT,
  years_of_experience   INTEGER,
  rookie_year           INTEGER,
  draft_club            TEXT,
  draft_number          INTEGER,
  headshot              TEXT,
  espn_id               INTEGER,
  sportradar_id         TEXT,
  yahoo_id              INTEGER,
  pfr_id                TEXT
);

CREATE INDEX IF NOT EXISTS idx_players_name ON players USING gin(to_tsvector('english', display_name));
CREATE INDEX IF NOT EXISTS idx_players_team ON players(team_abbr);
CREATE INDEX IF NOT EXISTS idx_players_position ON players(position);
CREATE INDEX IF NOT EXISTS idx_players_status ON players(status);

-- ── Schedules (game results) ──────────────────────────────

CREATE TABLE IF NOT EXISTS schedules (
  game_id       TEXT PRIMARY KEY,
  season        INTEGER NOT NULL,
  game_type     TEXT,           -- REG, WC, DIV, CON, SB
  week          INTEGER,
  gameday       TEXT,
  weekday       TEXT,
  gametime      TEXT,
  away_team     TEXT,
  home_team     TEXT,
  away_score    INTEGER,
  home_score    INTEGER,
  location      TEXT,
  roof          TEXT,
  surface       TEXT,
  overtime      BOOLEAN,
  old_game_id   TEXT,
  away_rest     INTEGER,
  home_rest     INTEGER,
  away_moneyline INTEGER,
  home_moneyline INTEGER,
  spread_line   REAL,
  total_line    REAL,
  result        INTEGER,        -- home score - away score
  total         INTEGER         -- home score + away score
);

CREATE INDEX IF NOT EXISTS idx_schedules_season ON schedules(season);
CREATE INDEX IF NOT EXISTS idx_schedules_week ON schedules(season, week);
CREATE INDEX IF NOT EXISTS idx_schedules_teams ON schedules(home_team, away_team);
CREATE INDEX IF NOT EXISTS idx_schedules_game_type ON schedules(season, game_type);

-- ── Player Stats (season totals) ──────────────────────────

CREATE TABLE IF NOT EXISTS player_stats_season (
  player_id             TEXT NOT NULL,
  season                INTEGER NOT NULL,
  player_name           TEXT,
  player_display_name   TEXT,
  position              TEXT,
  position_group        TEXT,
  recent_team           TEXT,
  headshot_url          TEXT,
  games                 INTEGER,

  -- Passing
  completions           INTEGER,
  attempts              INTEGER,
  passing_yards         INTEGER,
  passing_tds           INTEGER,
  interceptions         INTEGER,
  sacks                 INTEGER,
  sack_yards            INTEGER,
  sack_fumbles          INTEGER,
  passing_air_yards     INTEGER,
  passing_yards_after_catch INTEGER,
  passing_first_downs   INTEGER,
  passing_2pt_conversions INTEGER,
  passer_rating         REAL,
  pacr                  REAL,
  dakota                REAL,

  -- Rushing
  carries               INTEGER,
  rushing_yards         INTEGER,
  rushing_tds           INTEGER,
  rushing_fumbles       INTEGER,
  rushing_fumbles_lost  INTEGER,
  rushing_first_downs   INTEGER,
  rushing_2pt_conversions INTEGER,

  -- Receiving
  targets               INTEGER,
  receptions            INTEGER,
  receiving_yards       INTEGER,
  receiving_tds         INTEGER,
  receiving_fumbles     INTEGER,
  receiving_fumbles_lost INTEGER,
  receiving_air_yards   INTEGER,
  receiving_yards_after_catch INTEGER,
  receiving_first_downs INTEGER,
  receiving_2pt_conversions INTEGER,

  -- Kicking
  fg_made               REAL,
  fg_att                REAL,
  fg_long               REAL,
  fg_pct                REAL,
  pat_made              REAL,
  pat_att               REAL,

  -- Fantasy
  fantasy_points        REAL,
  fantasy_points_ppr    REAL,

  PRIMARY KEY (player_id, season)
);

CREATE INDEX IF NOT EXISTS idx_pss_team ON player_stats_season(recent_team, season);
CREATE INDEX IF NOT EXISTS idx_pss_position ON player_stats_season(position, season);
CREATE INDEX IF NOT EXISTS idx_pss_passing ON player_stats_season(season, passing_yards DESC);
CREATE INDEX IF NOT EXISTS idx_pss_rushing ON player_stats_season(season, rushing_yards DESC);
CREATE INDEX IF NOT EXISTS idx_pss_receiving ON player_stats_season(season, receiving_yards DESC);

-- ── Player Stats (weekly game log) ────────────────────────

CREATE TABLE IF NOT EXISTS player_stats_weekly (
  player_id             TEXT NOT NULL,
  season                INTEGER NOT NULL,
  week                  INTEGER NOT NULL,
  player_name           TEXT,
  player_display_name   TEXT,
  position              TEXT,
  position_group        TEXT,
  recent_team           TEXT,
  opponent_team         TEXT,

  -- Same stat columns as season table
  completions           INTEGER,
  attempts              INTEGER,
  passing_yards         INTEGER,
  passing_tds           INTEGER,
  interceptions         INTEGER,
  sacks                 INTEGER,
  passer_rating         REAL,
  carries               INTEGER,
  rushing_yards         INTEGER,
  rushing_tds           INTEGER,
  targets               INTEGER,
  receptions            INTEGER,
  receiving_yards       INTEGER,
  receiving_tds         INTEGER,
  fantasy_points        REAL,
  fantasy_points_ppr    REAL,

  -- Kicking
  fg_made               REAL,
  fg_att                REAL,
  pat_made              REAL,
  pat_att               REAL,

  PRIMARY KEY (player_id, season, week)
);

CREATE INDEX IF NOT EXISTS idx_psw_team_week ON player_stats_weekly(recent_team, season, week);
CREATE INDEX IF NOT EXISTS idx_psw_player ON player_stats_weekly(player_id, season);

-- ── Rosters ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS rosters (
  id                SERIAL PRIMARY KEY,
  season            INTEGER NOT NULL,
  team              TEXT NOT NULL,
  gsis_id           TEXT,
  full_name         TEXT,
  position          TEXT,
  jersey_number     INTEGER,
  status            TEXT,
  college           TEXT,
  height            INTEGER,
  weight            INTEGER,
  birth_date        DATE,
  years_exp         INTEGER,
  headshot_url      TEXT,
  UNIQUE(season, team, gsis_id)
);

CREATE INDEX IF NOT EXISTS idx_rosters_team ON rosters(team, season);

-- ── Draft Picks ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS draft_picks (
  id            SERIAL PRIMARY KEY,
  season        INTEGER NOT NULL,
  round         INTEGER,
  pick          INTEGER,
  team          TEXT,
  pfr_id        TEXT,
  pfr_name      TEXT,
  position      TEXT,
  category      TEXT,
  side          TEXT,
  college       TEXT,
  age           REAL,
  -- Career stats
  rush_yards    INTEGER,
  pass_yards    INTEGER,
  rec_yards     INTEGER,
  total_tds     INTEGER,
  probowls      INTEGER,
  allpro        INTEGER,
  seasons_started INTEGER,
  UNIQUE(season, pick)
);

CREATE INDEX IF NOT EXISTS idx_draft_season ON draft_picks(season);
CREATE INDEX IF NOT EXISTS idx_draft_team ON draft_picks(team, season);

-- ── Materialized view: standings ──────────────────────────
-- Pre-computed standings, refreshed by sync job

CREATE MATERIALIZED VIEW IF NOT EXISTS standings AS
WITH game_results AS (
  SELECT season, home_team AS team, home_score AS pf, away_score AS pa,
    CASE WHEN home_score > away_score THEN 1 ELSE 0 END AS win,
    CASE WHEN home_score < away_score THEN 1 ELSE 0 END AS loss,
    CASE WHEN home_score = away_score THEN 1 ELSE 0 END AS tie
  FROM schedules WHERE game_type = 'REG' AND home_score IS NOT NULL
  UNION ALL
  SELECT season, away_team AS team, away_score AS pf, home_score AS pa,
    CASE WHEN away_score > home_score THEN 1 ELSE 0 END AS win,
    CASE WHEN away_score < home_score THEN 1 ELSE 0 END AS loss,
    CASE WHEN away_score = home_score THEN 1 ELSE 0 END AS tie
  FROM schedules WHERE game_type = 'REG' AND home_score IS NOT NULL
)
SELECT
  g.season,
  g.team,
  t.team_name,
  t.team_conf,
  t.team_division,
  t.team_color,
  t.team_logo_espn,
  SUM(g.win) AS wins,
  SUM(g.loss) AS losses,
  SUM(g.tie) AS ties,
  SUM(g.pf) AS points_for,
  SUM(g.pa) AS points_against,
  SUM(g.pf) - SUM(g.pa) AS point_diff,
  ROUND(
    (SUM(g.win) + 0.5 * SUM(g.tie))::NUMERIC /
    NULLIF(SUM(g.win) + SUM(g.loss) + SUM(g.tie), 0), 3
  ) AS win_pct
FROM game_results g
JOIN teams t ON t.team_abbr = g.team
GROUP BY g.season, g.team, t.team_name, t.team_conf, t.team_division, t.team_color, t.team_logo_espn;

CREATE UNIQUE INDEX IF NOT EXISTS idx_standings_pk ON standings(season, team);
CREATE INDEX IF NOT EXISTS idx_standings_conf ON standings(season, team_conf, win_pct DESC);

-- Done
SELECT 'Schema initialized successfully' AS status;
