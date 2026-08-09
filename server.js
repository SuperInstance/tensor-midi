/**
 * TENSOR-MIDI SERVER
 * Serves the mixer and chart overlay, provides API endpoints for capture.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3939;
const BASE = __dirname;

const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.mid': 'audio/midi',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // ── API Routes ──
  if (url.pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, service: 'tensor-midi', version: '1.0.0' }));
    return;
  }

  if (url.pathname === '/api/pulse-grid' && req.method === 'GET') {
    const { PulseEngine } = require('./engine/pulse-engine');
    const engine = new PulseEngine();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(engine.getPulseGrid()));
    return;
  }

  if (url.pathname === '/api/capture' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { TensorMidiCapture } = require('./capture.js');
        const data = JSON.parse(body);
        const capture = new TensorMidiCapture({ roomId: data.roomId || 'bar-rail' });
        capture.loadMessages(data.messages || []);
        const tensor = capture.toJSON();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(tensor));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  if (url.pathname.startsWith('/api/analyze') && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { JazzAnalyzer } = require('./analysis/jazz-analyzer.js');
        const tensorData = JSON.parse(body);
        const analyzer = new JazzAnalyzer(tensorData);
        const analysis = analyzer.analyze();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(analysis));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // ── Static Files ──
  let filePath = url.pathname === '/' ? '/mixer.html' : url.pathname;
  filePath = path.join(BASE, filePath);

  // Prevent directory traversal
  if (!filePath.startsWith(BASE)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`╔══════════════════════════════════════════════╗`);
  console.log(`║  TENSOR-MIDI SERVER                          ║`);
  console.log(`║  Mixer:    http://localhost:${PORT}/           ║`);
  console.log(`║  Chart:    http://localhost:${PORT}/chart-overlay.html`);
  console.log(`║  API:      http://localhost:${PORT}/api/health  ║`);
  console.log(`╚══════════════════════════════════════════════╝`);
});
