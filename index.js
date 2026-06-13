const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Cache to avoid repeated yt-dlp calls for same video
const cache = new Map();
const CACHE_TTL = 3 * 60 * 60 * 1000; // 3 hours (YouTube URLs expire ~6h)

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'stupid-music-server' });
});

// GET /stream/:videoId — returns direct audio URL
app.get('/stream/:videoId', async (req, res) => {
  const { videoId } = req.params;

  if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    return res.status(400).json({ error: 'Invalid videoId' });
  }

  // Check cache
  const cached = cache.get(videoId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    console.log(`Cache hit: ${videoId}`);
    return res.json({ url: cached.url, videoId });
  }

  try {
    console.log(`Resolving: ${videoId}`);

    // yt-dlp: get best audio-only URL, no download
    const cmd = [
      'yt-dlp',
      '--no-playlist',
      '--no-warnings',
      '-f', 'bestaudio[ext=m4a]/bestaudio/best',
      '--get-url',
      `https://www.youtube.com/watch?v=${videoId}`
    ].join(' ');

    const { stdout, stderr } = await execAsync(cmd, { timeout: 30000 });
    const url = stdout.trim().split('\n')[0];

    if (!url || !url.startsWith('http')) {
      return res.status(404).json({ error: 'Could not resolve audio URL' });
    }

    // Cache it
    cache.set(videoId, { url, timestamp: Date.now() });

    console.log(`Resolved: ${videoId} -> ${url.substring(0, 60)}...`);
    res.json({ url, videoId });

  } catch (err) {
    console.error(`Error resolving ${videoId}:`, err.message);
    res.status(500).json({ error: 'Failed to resolve audio', detail: err.message });
  }
});

// Cleanup old cache entries every hour
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of cache.entries()) {
    if (now - val.timestamp > CACHE_TTL) cache.delete(key);
  }
}, 60 * 60 * 1000);

app.listen(PORT, () => {
  console.log(`Stupid Music Server running on port ${PORT}`);
});
