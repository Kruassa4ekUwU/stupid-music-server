const express = require('express');
const cors = require('cors');
const https = require('https');
const http = require('http');

const app = express();
const PORT = process.env.PORT || 3000;
app.use(cors());

const cache = new Map();
const CACHE_TTL = 3 * 60 * 60 * 1000; // 3 hours

// Public Piped instances — tried in order
const PIPED_INSTANCES = [
  'pipedapi.kavin.rocks',
  'pipedapi.moomoo.me',
  'piped-api.garudalinux.org',
  'api.piped.yt',
  'pipedapi.in.projectsegfau.lt',
];

function fetchJson(hostname, path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname,
      path,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36',
        'Accept': 'application/json',
      },
      timeout: 10000,
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (e) { reject(new Error('JSON parse error')); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

async function resolveWithPiped(videoId) {
  for (const instance of PIPED_INSTANCES) {
    try {
      console.log(`Trying Piped: ${instance}`);
      const { status, body } = await fetchJson(instance, `/streams/${videoId}`);
      
      if (status !== 200 || !body.audioStreams) continue;

      // Pick best audio stream — prefer m4a, then webm, then any
      const streams = body.audioStreams;
      const m4a = streams.find(s => s.mimeType && s.mimeType.includes('m4a'));
      const webm = streams.find(s => s.mimeType && s.mimeType.includes('webm'));
      const best = m4a || webm || streams[0];

      if (best && best.url) {
        console.log(`Got stream from ${instance}: ${best.mimeType} ${best.bitrate}bps`);
        return best.url;
      }
    } catch (e) {
      console.log(`${instance} failed: ${e.message}`);
    }
  }
  return null;
}

app.get('/health', (req, res) => {
  res.json({ status: 'ok', instances: PIPED_INSTANCES.length });
});

app.get('/stream/:videoId', async (req, res) => {
  const { videoId } = req.params;

  if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    return res.status(400).json({ error: 'Invalid videoId' });
  }

  // Cache check
  const cached = cache.get(videoId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    console.log(`Cache hit: ${videoId}`);
    return res.json({ url: cached.url, videoId });
  }

  const url = await resolveWithPiped(videoId);

  if (!url) {
    return res.status(404).json({ error: 'Не удалось получить аудио. Попробуй другой трек.' });
  }

  cache.set(videoId, { url, timestamp: Date.now() });
  res.json({ url, videoId });
});

// Clear expired cache
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of cache.entries()) {
    if (now - v.timestamp > CACHE_TTL) cache.delete(k);
  }
}, 60 * 60 * 1000);

app.listen(PORT, () => console.log(`Stupid Music Server on port ${PORT}`));
