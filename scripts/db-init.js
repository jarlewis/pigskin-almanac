#!/usr/bin/env node
/**
 * db-init.js — Initialize the Pigskin Almanac database schema
 * Runs scripts/init-db.sql via the pg client (no psql CLI required).
 * Safe to re-run: all SQL statements use IF NOT EXISTS.
 *
 * Usage:
 *   node scripts/db-init.js
 *   npm run init-db
 */

require('dotenv').config();
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const sql = fs.readFileSync(path.join(__dirname, 'init-db.sql'), 'utf8');

async function init() {
  if (!process.env.DATABASE_URL) {
    console.error('[db-init] ERROR: DATABASE_URL is not set');
    process.exit(1);
  }

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  });

  try {
    await client.connect();
    console.log('[db-init] Connected to database');
    await client.query(sql);
    console.log('[db-init] Schema initialized successfully');
  } catch (err) {
    console.error('[db-init] ERROR:', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

init();
