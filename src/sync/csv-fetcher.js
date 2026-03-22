const Papa = require('papaparse');

const BASE = 'https://github.com/nflverse/nflverse-data/releases/download';

/**
 * Fetch a CSV from nflverse, with conditional request support.
 * Returns { data, lastModified, etag, notModified }
 */
const fetchNflverseCSV = async (tag, file, { lastModified, etag } = {}) => {
  const url = `${BASE}/${tag}/${file}`;
  const headers = {};

  if (lastModified) headers['If-Modified-Since'] = lastModified;
  if (etag) headers['If-None-Match'] = etag;

  const response = await fetch(url, { headers });

  if (response.status === 304) {
    return { data: null, notModified: true };
  }

  if (!response.ok) {
    throw new Error(`Fetch failed: ${url} → ${response.status}`);
  }

  const text = await response.text();

  const parsed = await new Promise((resolve, reject) => {
    Papa.parse(text, {
      header: true,
      dynamicTyping: true,
      skipEmptyLines: true,
      complete: (result) => resolve(result.data),
      error: (err) => reject(err),
    });
  });

  return {
    data: parsed,
    lastModified: response.headers.get('last-modified'),
    etag: response.headers.get('etag'),
    notModified: false,
  };
};

module.exports = { fetchNflverseCSV };
