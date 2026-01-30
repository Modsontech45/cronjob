const cron = require('node-cron');
const https = require('https');
const http = require('http');
require('dotenv').config();

/* ================= CONFIG ================= */

const BACKEND_URLS = (process.env.BACKEND_URLS )
  .split(',')
  .map(u => u.trim())
  .filter(Boolean);

const PING_ENDPOINT = process.env.PING_ENDPOINT || '/api/health';
const CRON_SCHEDULE = process.env.CRON_SCHEDULE || '* * * * *'; // every minute
const PING_INTERVAL_MS = 10_000; // 🔥 ping every 10 seconds
const REQUEST_TIMEOUT_MS = 7_000;
const PORT = process.env.PORT || 3001;

/* ================= STATS ================= */

const stats = {
  servers: {},
  globalStats: {
    totalPings: 0,
    successfulPings: 0,
    failedPings: 0,
  },
  startTime: new Date(),
};

BACKEND_URLS.forEach(url => {
  stats.servers[url] = {
    totalPings: 0,
    successfulPings: 0,
    failedPings: 0,
    lastPingTime: null,
    lastPingStatus: null,
    lastResponseTime: null,
  };
});

/* ================= PING LOGIC ================= */

function pingServer(backendUrl) {
  return new Promise(resolve => {
    const url = backendUrl + PING_ENDPOINT;
    const protocol = url.startsWith('https') ? https : http;
    const start = Date.now();

    const req = protocol.get(url, res => {
      const responseTime = Date.now() - start;

      const serverStats = stats.servers[backendUrl];
      serverStats.totalPings++;
      serverStats.lastPingTime = new Date().toISOString();
      serverStats.lastResponseTime = responseTime;

      stats.globalStats.totalPings++;

      if (res.statusCode >= 200 && res.statusCode < 300) {
        serverStats.successfulPings++;
        serverStats.lastPingStatus = 'success';
        stats.globalStats.successfulPings++;
      } else {
        serverStats.failedPings++;
        serverStats.lastPingStatus = 'failed';
        stats.globalStats.failedPings++;
      }

      res.resume();
      resolve();
    });

    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy();
    });

    req.on('error', () => {
      const serverStats = stats.servers[backendUrl];
      serverStats.totalPings++;
      serverStats.failedPings++;
      serverStats.lastPingTime = new Date().toISOString();
      serverStats.lastPingStatus = 'error';

      stats.globalStats.totalPings++;
      stats.globalStats.failedPings++;
      resolve();
    });
  });
}

async function pingAllServers() {
  await Promise.all(BACKEND_URLS.map(pingServer));
}

/* ================= CRON ================= */

if (!cron.validate(CRON_SCHEDULE)) {
  console.error('❌ Invalid cron schedule');
  process.exit(1);
}

cron.schedule(CRON_SCHEDULE, () => {
  console.log(`[CRON] Starting high-frequency pings...`);

  const interval = setInterval(pingAllServers, PING_INTERVAL_MS);

  setTimeout(() => {
    clearInterval(interval);
    console.log(`[CRON] Ping cycle finished`);
  }, 60_000);
});

/* ================= HTTP SERVER ================= */

const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'running',
      servers: BACKEND_URLS.length,
      stats,
      uptime: Math.floor((Date.now() - stats.startTime) / 1000) + 's',
    }, null, 2));
  } else if (req.url === '/ping') {
    pingAllServers();
    res.end(JSON.stringify({ message: 'Manual ping triggered' }));
  } else {
    res.writeHead(404);
    res.end();
  }
});

server.listen(PORT, () => {
  console.log(`✅ Health server running on port ${PORT}`);
});
