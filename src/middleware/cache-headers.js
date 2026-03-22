/**
 * Set Cache-Control headers based on data freshness.
 * 
 * Static data (teams, draft) → cache 1 hour
 * Live data (scores, stats)  → cache 60 seconds
 * User-specific (compare)    → no cache
 */
const cacheHeaders = (maxAge = 60) => (req, res, next) => {
  res.set('Cache-Control', `public, max-age=${maxAge}, stale-while-revalidate=${maxAge * 2}`);
  next();
};

const staticCache = cacheHeaders(3600);   // 1 hour
const liveCache = cacheHeaders(60);       // 1 minute
const shortCache = cacheHeaders(15);      // 15 seconds
const noCache = (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
};

module.exports = { cacheHeaders, staticCache, liveCache, shortCache, noCache };
