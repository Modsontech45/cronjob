const cron = require('node-cron');
const https = require('https');
const http = require('http');
require('dotenv').config();

// Configuration
const BACKEND_URL = process.env.BACKEND_URL || 'https://anac-backend.onrender.com';
const PING_ENDPOINT = process.env.PING_ENDPOINT || '/api/health';
const CRON_SCHEDULE = process.env.CRON_SCHEDULE || '*/5 * * * *'; // Every 5 minutes
const PORT = process.env.PORT || 3001;

// Track ping statistics
let stats = {
  totalPings: 0,
  successfulPings: 0,
  failedPings: 0,
  lastPingTime: null,
  lastPingStatus: null,
  lastResponseTime: null,
  startTime: new Date(),
};

// Ping function
function pingBackend() {
  const url = `${BACKEND_URL}${PING_ENDPOINT}`;
  const startTime = Date.now();

  console.log(`[${new Date().toISOString()}] Pinging ${url}...`);

  const protocol = url.startsWith('https') ? https : http;

  const req = protocol.get(url, (res) => {
    const responseTime = Date.now() - startTime;

    stats.totalPings++;
    stats.lastPingTime = new Date().toISOString();
    stats.lastResponseTime = responseTime;

    if (res.statusCode >= 200 && res.statusCode < 300) {
      stats.successfulPings++;
      stats.lastPingStatus = 'success';
      console.log(`[${new Date().toISOString()}] Ping successful - Status: ${res.statusCode}, Response time: ${responseTime}ms`);
    } else {
      stats.failedPings++;
      stats.lastPingStatus = 'failed';
      console.log(`[${new Date().toISOString()}] Ping failed - Status: ${res.statusCode}, Response time: ${responseTime}ms`);
    }

    // Consume response data to free up memory
    res.resume();
  });

  req.on('error', (error) => {
    const responseTime = Date.now() - startTime;

    stats.totalPings++;
    stats.failedPings++;
    stats.lastPingTime = new Date().toISOString();
    stats.lastPingStatus = 'error';
    stats.lastResponseTime = responseTime;

    console.error(`[${new Date().toISOString()}] Ping error: ${error.message}`);
  });

  req.setTimeout(30000, () => {
    req.destroy();
    stats.totalPings++;
    stats.failedPings++;
    stats.lastPingTime = new Date().toISOString();
    stats.lastPingStatus = 'timeout';
    console.error(`[${new Date().toISOString()}] Ping timeout after 30 seconds`);
  });
}

// Schedule the cron job
console.log(`
========================================
   ANAC Backend Keep-Alive Service
========================================
Backend URL: ${BACKEND_URL}
Ping Endpoint: ${PING_ENDPOINT}
Schedule: ${CRON_SCHEDULE} (every 5 minutes)
Started at: ${new Date().toISOString()}
========================================
`);

// Validate cron expression
if (!cron.validate(CRON_SCHEDULE)) {
  console.error('Invalid cron schedule expression!');
  process.exit(1);
}

// Schedule the cron job
cron.schedule(CRON_SCHEDULE, () => {
  pingBackend();
});

// Initial ping on startup
console.log('[Startup] Running initial ping...');
pingBackend();

// Create a simple HTTP server for health checks (useful for deployment platforms)
const server = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'running',
      service: 'ANAC Cron Job',
      backendUrl: BACKEND_URL,
      schedule: CRON_SCHEDULE,
      stats: {
        ...stats,
        uptime: Math.floor((Date.now() - stats.startTime.getTime()) / 1000) + ' seconds',
        successRate: stats.totalPings > 0
          ? ((stats.successfulPings / stats.totalPings) * 100).toFixed(2) + '%'
          : 'N/A',
      },
    }, null, 2));
  } else if (req.url === '/ping') {
    // Manual ping trigger
    pingBackend();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'Ping triggered manually' }));
  } else {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  }
});

server.listen(PORT, () => {
  console.log(`Health check server running on port ${PORT}`);
  console.log(`Endpoints:`);
  console.log(`  - GET /health - Check service status and stats`);
  console.log(`  - GET /ping   - Trigger manual ping`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received. Shutting down gracefully...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received. Shutting down gracefully...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
