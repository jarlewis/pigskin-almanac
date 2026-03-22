/**
 * dev-server.js
 *
 * Serves your frontend HTML files on port 8080 and proxies
 * /api/* requests to the backend on port 3001.
 *
 * Usage:
 *   1. Put your HTML files in a ./frontend folder
 *   2. Start the API:  npm run dev          (port 3001)
 *   3. Start this:     node dev-server.js   (port 8080)
 *   4. Open:           http://localhost:8080/dashboard.html
 *
 * No CORS issues — everything is same-origin from the browser's perspective.
 */

require('dotenv').config();
const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const path = require('path');

const app = express();
const FRONTEND_PORT = 8080;
const API_TARGET = process.env.API_TARGET || 'http://localhost:3001';

// Proxy /api/* to the backend
app.use('/api', createProxyMiddleware({
  target: API_TARGET,
  changeOrigin: true,
  logLevel: 'warn',
}));

// Serve frontend static files
app.use(express.static(path.join(__dirname, 'frontend')));

// Fallback to index for SPA routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'dashboard.html'));
});

app.listen(FRONTEND_PORT, () => {
  console.log(`[dev] Frontend: http://localhost:${FRONTEND_PORT}`);
  console.log(`[dev] API proxy: /api/* → ${API_TARGET}`);
  console.log(`[dev] Put HTML files in ./frontend/`);
});
