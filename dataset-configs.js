const CURRENT_SEASON = parseInt(process.env.CURRENT_SEASON || '2025');

// ── Season Ranges ─────────────────────────────────────────
// Actual year ranges available per dataset in nflverse-data releases.
// Source: nflreadr docs, nflfastR docs, nflverse-data GitHub releases.

const SEASON_RANGES = {
  player_stats:     { start: 1999, end: CURRENT_SEASON },
  player_stats_wk:  { start: 1999, end: CURRENT_SEASON },
  team_stats:       { start: 1999, end: CURRENT_SEASON },
  rosters:          { start: 2002, end: CURRENT_SEASON },
  weekly_rosters:   { start: 2002, end: CURRENT_SEASON },
  snap_counts:      { start: 2012, end: CURRENT_SEASON },
  nextgen_passing:  { start: 2016, end: CURRENT_SEASON },
  nextgen_rushing:  { start: 2016, end: CURRENT_SEASON },
  nextgen_receiving:{ start: 2016, end: CURRENT_SEASON },
  pfr_advstats:     { start: 2018, end: CURRENT_SEASON },
  injuries:         { start: 2009, end: CURRENT_SEASON },
  depth_charts:     { start: 2001, end: CURRENT_SEASON },
  ftn_charting:     { start: 2022, end: CURRENT_SEASON },
};

const range = (start, end) =>
  Array.from({ length: end - start + 1 }, (_, i) => start + i);

// ── Sync Tiers ────────────────────────────────────────────
//
// LIVE:     Current season — sync every 15 min
// RECENT:   Previous season — sync every 6 hours (corrections still land)
// ARCHIVE:  Everything older — sync once, then skip forever
//
// The runner checks sync_log. If an ARCHIVE dataset already has
// rows, it won't re-fetch unless you pass --force.

const TIER = {
  LIVE:    15,        // minutes
  RECENT:  360,       // 6 hours
  ARCHIVE: 999999,    // effectively once
};

const tierForSeason = (season) => {
  if (season === CURRENT_SEASON) return TIER.LIVE;
  if (season === CURRENT_SEASON - 1) return TIER.RECENT;
  return TIER.ARCHIVE;
};

// ── Single-File Datasets ──────────────────────────────────
// One file, all seasons baked in. No {season} in the filename.

const SINGLE_FILE_DATASETS = [
  { key: 'teams',       tag: 'teams',       file: 'teams.csv',       table: 'teams',       upsertKey: ['team_abbr'],              interval: 1440 },
  { key: 'players',     tag: 'players',     file: 'players.csv',     table: 'players',     upsertKey: ['gsis_id'],                interval: 720  },
  { key: 'schedules',   tag: 'schedules',   file: 'schedules.csv',   table: 'schedules',   upsertKey: ['game_id'],                interval: 15   },
  { key: 'draft_picks', tag: 'draft_picks', file: 'draft_picks.csv', table: 'draft_picks', upsertKey: ['season', 'pick'],          interval: 1440 },
  { key: 'combine',     tag: 'combine',     file: 'combine.csv',     table: 'combine',     upsertKey: ['pfr_id'],                 interval: 1440 },
  { key: 'trades',      tag: 'trades',      file: 'trades.csv',      table: 'trades',      upsertKey: ['season', 'pfr_id', 'trade_partner'], interval: 1440 },
];

// ── Per-Season Dataset Generator ──────────────────────────
// One file per season. We emit a config entry for every year.

const generateSeasonDatasets = () => {
  const ds = [];

  // Player Stats — regular season totals
  for (const s of range(SEASON_RANGES.player_stats.start, SEASON_RANGES.player_stats.end)) {
    ds.push({
      key: `player_stats_reg_${s}`, tag: 'player_stats',
      file: `player_stats_reg_${s}.csv`, table: 'player_stats_season',
      upsertKey: ['player_id', 'season'], extraColumns: { season: s },
      interval: tierForSeason(s),
    });
  }

  // Player Stats — weekly game logs
  for (const s of range(SEASON_RANGES.player_stats_wk.start, SEASON_RANGES.player_stats_wk.end)) {
    ds.push({
      key: `player_stats_wk_${s}`, tag: 'player_stats',
      file: `player_stats_${s}.csv`, table: 'player_stats_weekly',
      upsertKey: ['player_id', 'season', 'week'], extraColumns: { season: s },
      interval: tierForSeason(s),
    });
  }

  // Team Stats — regular season totals
  for (const s of range(SEASON_RANGES.team_stats.start, SEASON_RANGES.team_stats.end)) {
    ds.push({
      key: `team_stats_reg_${s}`, tag: 'stats_team',
      file: `team_stats_reg_${s}.csv`, table: 'team_stats',
      upsertKey: ['team', 'season'], extraColumns: { season: s },
      interval: tierForSeason(s),
    });
  }

  // Rosters — season level
  for (const s of range(SEASON_RANGES.rosters.start, SEASON_RANGES.rosters.end)) {
    ds.push({
      key: `rosters_${s}`, tag: 'rosters',
      file: `roster_${s}.csv`, table: 'rosters',
      upsertKey: ['season', 'team', 'gsis_id'], extraColumns: { season: s },
      interval: tierForSeason(s),
    });
  }

  // Snap Counts (2012+)
  for (const s of range(SEASON_RANGES.snap_counts.start, SEASON_RANGES.snap_counts.end)) {
    ds.push({
      key: `snap_counts_${s}`, tag: 'snap_counts',
      file: `snap_counts_${s}.csv`, table: 'snap_counts',
      upsertKey: ['pfr_player_id', 'game_id'], extraColumns: { season: s },
      interval: tierForSeason(s),
    });
  }

  // Injuries (2009+)
  for (const s of range(SEASON_RANGES.injuries.start, SEASON_RANGES.injuries.end)) {
    ds.push({
      key: `injuries_${s}`, tag: 'injuries',
      file: `injuries_${s}.csv`, table: 'injuries',
      upsertKey: ['season', 'team', 'gsis_id', 'week'],
      extraColumns: { season: s },
      interval: s === CURRENT_SEASON ? 60 : TIER.ARCHIVE,
    });
  }

  // NextGen Stats — three stat types (2016+)
  for (const type of ['passing', 'rushing', 'receiving']) {
    const rangeKey = `nextgen_${type}`;
    for (const s of range(SEASON_RANGES[rangeKey].start, SEASON_RANGES[rangeKey].end)) {
      ds.push({
        key: `nextgen_${type}_${s}`, tag: 'nextgen_stats',
        file: `nextgen_stats_${type}_${s}.csv`, table: 'nextgen_stats',
        upsertKey: ['player_gsis_id', 'season', 'week', 'stat_type'],
        extraColumns: { season: s, stat_type: type },
        interval: tierForSeason(s),
      });
    }
  }

  // Depth Charts (2001+)
  for (const s of range(SEASON_RANGES.depth_charts.start, SEASON_RANGES.depth_charts.end)) {
    ds.push({
      key: `depth_charts_${s}`, tag: 'depth_charts',
      file: `depth_charts_${s}.csv`, table: 'depth_charts',
      upsertKey: ['season', 'club_code', 'week', 'gsis_id', 'position'],
      extraColumns: { season: s },
      interval: s === CURRENT_SEASON ? 360 : TIER.ARCHIVE,
    });
  }

  // FTN Charting (2022+)
  for (const s of range(SEASON_RANGES.ftn_charting.start, SEASON_RANGES.ftn_charting.end)) {
    ds.push({
      key: `ftn_charting_${s}`, tag: 'ftn_charting',
      file: `ftn_charting_${s}.csv`, table: 'ftn_charting',
      upsertKey: ['nflverse_game_id', 'nflverse_play_id'],
      extraColumns: { season: s },
      interval: tierForSeason(s),
    });
  }

  // PFR Advanced Stats (2018+) — multiple stat types per season
  for (const type of ['pass', 'rush', 'rec', 'def']) {
    for (const s of range(SEASON_RANGES.pfr_advstats.start, SEASON_RANGES.pfr_advstats.end)) {
      ds.push({
        key: `pfr_advstats_${type}_${s}`, tag: 'pfr_advstats',
        file: `advstats_season_${type}_${s}.csv`, table: 'pfr_advstats',
        upsertKey: ['pfr_id', 'season', 'stat_type'],
        extraColumns: { season: s, stat_type: type },
        interval: tierForSeason(s),
      });
    }
  }

  // ESPN QBR — single files, not per-season
  ds.push({
    key: 'espn_qbr_season', tag: 'espn_data',
    file: 'qbr_season_level.csv', table: 'espn_qbr',
    upsertKey: ['player_id', 'season', 'season_type'],
    interval: 360,
  });
  ds.push({
    key: 'espn_qbr_weekly', tag: 'espn_data',
    file: 'qbr_week_level.csv', table: 'espn_qbr_weekly',
    upsertKey: ['player_id', 'season', 'game_week', 'season_type'],
    interval: 60,
  });

  return ds;
};


// ── Assembled Lists ───────────────────────────────────────

const ALL_DATASETS = [
  ...SINGLE_FILE_DATASETS,
  ...generateSeasonDatasets(),
];

// Live sync: only current season + single-file datasets
const LIVE_DATASETS = ALL_DATASETS.filter(d => d.interval <= TIER.RECENT);

// Backfill: archive datasets (historical seasons)
const BACKFILL_DATASETS = ALL_DATASETS.filter(d => d.interval >= TIER.ARCHIVE);

const datasetStats = () => ({
  total: ALL_DATASETS.length,
  live: LIVE_DATASETS.length,
  backfill: BACKFILL_DATASETS.length,
  currentSeason: CURRENT_SEASON,
  ranges: SEASON_RANGES,
});

module.exports = {
  ALL_DATASETS,
  LIVE_DATASETS,
  BACKFILL_DATASETS,
  SINGLE_FILE_DATASETS,
  CURRENT_SEASON,
  SEASON_RANGES,
  TIER,
  datasetStats,
  range,
};
