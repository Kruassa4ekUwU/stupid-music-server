const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const cache = new Map();
const CACHE_TTL = 2 * 60 * 60 * 1000; // 2 hours

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/stream/:videoId', async (req, res) => {
  const { videoId } = req.params;

  if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    return res.status(400).json({ error: 'Invalid videoId' });
  }

  const cached = cache.get(videoId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    console.log(`Cache hit: ${videoId}`);
    return res.json({ url: cached.url, videoId });
  }

  try {
    console.log(`Resolving: ${videoId}`);

    const cmd = [
      'yt-dlp',
      '--no-playlist',
      '--no-warnings',
      '--no-check-certificates',
      // Bypass bot detection
      '--extractor-args', '"youtube:player_client=android,web"',
      '--add-header', '"User-Agent:Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.210 Mobile Safari/537.36"',
      '--add-header', '"Accept-Language:en-US,en;q=0.9"',
      '-f', 'bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio/best',
      '--get-url',
      `"https://www.youtube.com/watch?v=${videoId}"`
    ].join(' ');

    const { stdout } = await execAsync(cmd, { timeout: 45000 });
    const url = stdout.trim().split('\n')[0];

    if (!url || !url.startsWith('http')) {
      return res.status(404).json({ error: 'Could not resolve audio URL' });
    }

    cache.set(videoId, { url, timestamp: Date.now() });
    console.log(`OK: ${videoId}`);
    res.json({ url, videoId });

  } catch (err) {
    console.error(`Error ${videoId}:`, err.message);

    // Try fallback with piped.video
    try {
      const fallbackCmd = `yt-dlp --no-playlist --no-warnings -f bestaudio --get-url "https://piped.video/watch?v=${videoId}"`;
      const { stdout: fb } = await execAsync(fallbackCmd, { timeout: 30000 });
      const fbUrl = fb.trim().split('\n')[0];
      if (fbUrl && fbUrl.startsWith('http')) {
        cache.set(videoId, { url: fbUrl, timestamp: Date.now() });
        return res.json({ url: fbUrl, videoId });
      }
    } catch (e2) {
      console.error('Fallback also failed:', e2.message);
    }

    res.status(500).json({ error: 'Failed', detail: err.message });
  }
});

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of cache.entries()) {
    if (now - v.timestamp > CACHE_TTL) cache.delete(k);
  }
}, 60 * 60 * 1000);

app.listen(PORT, () => console.log(`Server on port ${PORT}`));
