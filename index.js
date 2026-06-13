const express = require('express');
const cors = require('cors');
const { exec, execSync } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

const cache = new Map();
const CACHE_TTL = 2 * 60 * 60 * 1000;

// Try multiple strategies to get audio URL
async function resolveAudio(videoId) {
  const strategies = [
    // Strategy 1: Android client (bypasses most bot detection)
    `yt-dlp --no-playlist --no-warnings --extractor-args "youtube:player_client=android" -f "bestaudio[ext=m4a]/bestaudio" --get-url "https://www.youtube.com/watch?v=${videoId}"`,
    
    // Strategy 2: TV client
    `yt-dlp --no-playlist --no-warnings --extractor-args "youtube:player_client=tv_embedded" -f "bestaudio" --get-url "https://www.youtube.com/watch?v=${videoId}"`,

    // Strategy 3: iOS client
    `yt-dlp --no-playlist --no-warnings --extractor-args "youtube:player_client=ios" -f "bestaudio" --get-url "https://www.youtube.com/watch?v=${videoId}"`,

    // Strategy 4: Invidious instance as source
    `yt-dlp --no-playlist --no-warnings -f "bestaudio" --get-url "https://yewtu.be/watch?v=${videoId}"`,
  ];

  for (const cmd of strategies) {
    try {
      console.log(`Trying: ${cmd.substring(0, 60)}...`);
      const { stdout } = await execAsync(cmd, { timeout: 30000 });
      const url = stdout.trim().split('\n')[0];
      if (url && url.startsWith('http')) {
        console.log(`Success with strategy`);
        return url;
      }
    } catch (e) {
      console.log(`Strategy failed: ${e.message.substring(0, 100)}`);
    }
  }
  return null;
}

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
    return res.json({ url: cached.url, videoId });
  }

  const url = await resolveAudio(videoId);
  
  if (!url) {
    return res.status(403).json({ 
      error: 'YouTube заблокировал запрос. Попробуй другой трек или подожди немного.' 
    });
  }

  cache.set(videoId, { url, timestamp: Date.now() });
  res.json({ url, videoId });
});

// Update yt-dlp every 6 hours to stay fresh
setInterval(async () => {
  try {
    await execAsync('yt-dlp -U');
    console.log('yt-dlp updated');
  } catch (e) {}
}, 6 * 60 * 60 * 1000);

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of cache.entries()) {
    if (now - v.timestamp > CACHE_TTL) cache.delete(k);
  }
}, 60 * 60 * 1000);

app.listen(PORT, () => console.log(`Stupid Music Server on port ${PORT}`));
