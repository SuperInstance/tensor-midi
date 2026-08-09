// ═══════════════════════════════════════════════════════════════════
// Tensor-MIDI Mixer Board — Main Application
// ═══════════════════════════════════════════════════════════════════
//
// This is the conductor. It wires together:
//   - MIDI Capture (listening to conversation)
//   - 12-Pulse Engine (driving the grid)
//   - Jazz Analyzer (reading the ensemble)
//   - Persistence (musical memory)
//   - Device Context (organic adaptation)
//   - Chart Plotter (spatial dimension)
//
// The mixer board IS the instrument. Play it.

import { MidiCapture } from './src/capture.js';
import { BeatClock, PulseGrid, tickToPosition, PULSES_PER_BAR, TICKS_PER_BAR, TICKS_PER_PULSE } from './src/engine.js';
import { JazzAnalyzer, JazzMode, ChordQuality } from './src/analyzer.js';
import { Persistence } from './src/persistence.js';
import { DeviceProfile, DeviceType, getTimeOfDay } from './src/device-context.js';
import { EVENT_NAMES, ActionType } from './src/swmidi.js';

// ── Initialize ─────────────────────────────────────────────
const capture = new MidiCapture();
const analyzer = new JazzAnalyzer();
const persistence = new Persistence();
const device = new DeviceProfile();

let isPlaying = false;
let isRecording = false;
let playbackTick = 0;
let animationId = null;
let lastFrameTime = 0;
let chartZoom = 1;
let vesselTrail = []; // for chart plotter

// ── Apply Device Profile ───────────────────────────────────
function applyDeviceProfile() {
  const vars = device.getCSSVariables();
  const root = document.documentElement;
  for (const [key, value] of Object.entries(vars)) {
    root.style.setProperty(key, value);
  }
  
  document.getElementById('device-info').textContent = device.description;
  
  // Set layout class
  const mainArea = document.getElementById('main-area');
  mainArea.classList.add(`layout-${device.layout}`);
  
  // Hide features not available on this device
  const features = device.features;
  if (!features.includes('chart')) {
    document.getElementById('chart-section').style.display = 'none';
  }
  if (!features.includes('analyzer')) {
    document.getElementById('jazz-bar').style.display = 'none';
  }
}

// ── Initialize Pulse Grid Display ──────────────────────────
function initPulseGrid() {
  const grid = document.getElementById('pulse-grid');
  grid.innerHTML = '';
  for (let i = 0; i < 12; i++) {
    const cell = document.createElement('div');
    cell.className = 'pulse-cell';
    cell.id = `pulse-${i}`;
    cell.innerHTML = `
      <span class="pulse-number">${i + 1}</span>
      <span class="pulse-count" id="pulse-count-${i}"></span>
    `;
    grid.appendChild(cell);
  }
}

// ── Initialize Chart Canvas ────────────────────────────────
function initChart() {
  const canvas = document.getElementById('chart-canvas');
  const ctx = canvas.getContext('2d');
  
  function resize() {
    const container = document.getElementById('chart-container');
    canvas.width = container.clientWidth;
    canvas.height = container.clientHeight;
    drawChart();
  }
  
  window.addEventListener('resize', resize);
  resize();
}

function drawChart() {
  const canvas = document.getElementById('chart-canvas');
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  
  // Clear with dark background
  ctx.fillStyle = '#0a0a15';
  ctx.fillRect(0, 0, w, h);
  
  // Draw nautical grid
  ctx.strokeStyle = 'rgba(96, 128, 240, 0.1)';
  ctx.lineWidth = 1;
  const gridSize = 40 * chartZoom;
  for (let x = 0; x < w; x += gridSize) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let y = 0; y < h; y += gridSize) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  
  // Draw vessel trail
  if (vesselTrail.length > 1) {
    ctx.strokeStyle = device.theme.accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < vesselTrail.length; i++) {
      const pos = vesselTrail[i];
      const x = (pos.x * chartZoom) + w / 2;
      const y = (pos.y * chartZoom) + h / 2;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    
    // Draw note markers
    for (let i = 0; i < vesselTrail.length; i++) {
      const pos = vesselTrail[i];
      const x = (pos.x * chartZoom) + w / 2;
      const y = (pos.y * chartZoom) + h / 2;
      
      // Note marker
      ctx.fillStyle = pos.friction ? '#f06080' : device.theme.accent;
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
      
      // Note label
      if (pos.pitch !== undefined) {
        ctx.fillStyle = '#c0c0d0';
        ctx.font = '8px monospace';
        ctx.fillText(`♪${pos.pitch}`, x + 5, y - 3);
      }
    }
    
    // Draw current position (vessel icon)
    const last = vesselTrail[vesselTrail.length - 1];
    const lx = (last.x * chartZoom) + w / 2;
    const ly = (last.y * chartZoom) + h / 2;
    
    ctx.strokeStyle = device.theme.accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(lx, ly - 8);
    ctx.lineTo(lx + 6, ly + 4);
    ctx.lineTo(lx - 6, ly + 4);
    ctx.closePath();
    ctx.fillStyle = device.theme.accent;
    ctx.fill();
    ctx.stroke();
  } else {
    // No data — show placeholder
    ctx.fillStyle = '#707088';
    ctx.font = '11px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('Chart plotter ready', w / 2, h / 2 - 10);
    ctx.fillText('Awaiting position data...', w / 2, h / 2 + 10);
    ctx.textAlign = 'left';
  }
  
  // Draw compass rose
  const cx = w - 40;
  const cy = 40;
  ctx.strokeStyle = 'rgba(96, 128, 240, 0.3)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, 20, 0, Math.PI * 2);
  ctx.stroke();
  
  ctx.fillStyle = device.theme.accent;
  ctx.font = 'bold 10px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('N', cx, cy - 24);
  ctx.fillText('S', cx, cy + 32);
  ctx.fillText('W', cx - 30, cy + 4);
  ctx.fillText('E', cx + 30, cy + 4);
  ctx.textAlign = 'left';
}

// ── Update Mixer Display ───────────────────────────────────
function updateMixer() {
  const state = capture.getMixerState();
  
  // Update transport
  const { bar, pulse, subTick } = tickToPosition(playbackTick);
  document.getElementById('bar-display').textContent = bar + 1;
  document.getElementById('beat-display').textContent = Math.floor(pulse / 3) + 1;
  document.getElementById('pulse-display').textContent = String(pulse + 1).padStart(2, '0');
  document.getElementById('bpm-display').textContent = Math.round(state.bpm);
  
  // Update channel count
  document.getElementById('channel-count').textContent = `${state.participants.length} channels`;
  
  // Update channel strips
  const container = document.getElementById('channels-container');
  const existing = new Set();
  
  for (const { name, channel } of state.participants) {
    existing.add(channel);
    let strip = document.getElementById(`channel-${channel}`);
    if (!strip) {
      strip = document.createElement('div');
      strip.className = 'channel-strip';
      strip.id = `channel-${channel}`;
      strip.innerHTML = `
        <div class="channel-led" id="led-${channel}"></div>
        <div class="channel-header">
          <span class="channel-number">CH${String(channel + 1).padStart(2, '0')}</span>
        </div>
        <div class="channel-name" title="${name}">${name}</div>
        <div class="channel-fader">
          <div class="channel-meter">
            <div class="channel-meter-fill" id="meter-${channel}" style="height: 0%"></div>
          </div>
          <div class="fader-track">
            <div class="fader-handle" id="fader-${channel}" style="top: 20%"></div>
          </div>
        </div>
        <div class="channel-controls">
          <button class="ch-btn mute" id="mute-${channel}">M</button>
          <button class="ch-btn solo" id="solo-${channel}">S</button>
        </div>
      `;
      container.appendChild(strip);
    }
    
    // Flash LED for recent activity
    const recentEvents = capture.stream.inTickRange(
      playbackTick - TICKS_PER_PULSE * 2,
      playbackTick
    ).filter(e => e.channel === channel);
    
    const led = document.getElementById(`led-${channel}`);
    if (led && recentEvents.length > 0) {
      led.classList.add('active');
      setTimeout(() => led.classList.remove('active'), 200);
    }
    
    // Update meter
    const meter = document.getElementById(`meter-${channel}`);
    if (meter && recentEvents.length > 0) {
      const maxVel = Math.max(...recentEvents.map(e => e.velocity));
      meter.style.height = `${(maxVel / 127) * 100}%`;
    }
  }
  
  // Update pulse grid
  updatePulseGrid(bar);
  
  // Update event log
  updateEventLog();
  
  // Update jazz analysis
  updateJazzBar(state, bar);
}

function updatePulseGrid(currentBar) {
  // Reset all cells
  for (let i = 0; i < 12; i++) {
    const cell = document.getElementById(`pulse-${i}`);
    if (!cell) continue;
    cell.classList.remove('active', 'friction', 'current');
    const count = document.getElementById(`pulse-count-${i}`);
    if (count) count.textContent = '';
  }
  
  // Get events for current bar
  const barEvents = capture.stream.inTickRange(
    currentBar * TICKS_PER_BAR,
    (currentBar + 1) * TICKS_PER_BAR - 1
  );
  
  for (const event of barEvents) {
    const { pulse } = tickToPosition(event.tick);
    const cell = document.getElementById(`pulse-${pulse}`);
    if (!cell) continue;
    
    cell.classList.add('active');
    if (event.errorMask) cell.classList.add('friction');
    
    const count = document.getElementById(`pulse-count-${pulse}`);
    if (count) {
      const current = parseInt(count.textContent) || 0;
      count.textContent = current + 1;
    }
  }
  
  // Mark current pulse
  const { pulse: currentPulse } = tickToPosition(playbackTick);
  const currentCell = document.getElementById(`pulse-${currentPulse}`);
  if (currentCell) currentCell.classList.add('current');
}

function updateEventLog() {
  const events = capture.stream.events.slice(-50).reverse();
  const list = document.getElementById('event-list');
  
  list.innerHTML = events.slice(0, 20).map(e => {
    const { bar, pulse } = tickToPosition(e.tick);
    return `
      <div class="event-entry">
        <span class="event-tick">${bar + 1}.${pulse + 1}.${e.tick % TICKS_PER_PULSE}</span>
        <span class="event-type">${EVENT_NAMES[e.eventType] || '?'}</span>
        <span class="event-channel">CH${e.channel + 1}</span>
        <span class="event-pitch">♪${e.pitch}</span>
        <span class="event-pitch">v${e.velocity}</span>
        ${e.errorMask ? `<span class="event-friction">⚡</span>` : ''}
      </div>
    `;
  }).join('');
  
  document.getElementById('event-count').textContent = `${capture.stream.length} events`;
}

function updateJazzBar(state, bar) {
  // Analyze current bar
  const barEvents = capture.stream.inTickRange(
    bar * TICKS_PER_BAR,
    (bar + 1) * TICKS_PER_BAR - 1
  );
  
  const analysis = analyzer.analyzeBar(barEvents, capture.grid, bar);
  
  document.getElementById('jazz-mode').textContent = `🎵 ${analysis.mode.toUpperCase()}`;
  document.getElementById('jazz-chord').textContent = analysis.chord;
  document.getElementById('jazz-description').textContent = analyzer.description;
  
  document.getElementById('tension-fill').style.width = `${analysis.tension}%`;
  document.getElementById('energy-fill').style.width = `${analysis.energy}%`;
  document.getElementById('complexity-fill').style.width = `${analysis.complexity}%`;
}

// ── Playback Loop ──────────────────────────────────────────
function playbackLoop(timestamp) {
  if (!isPlaying) return;
  
  if (!lastFrameTime) lastFrameTime = timestamp;
  const deltaMs = timestamp - lastFrameTime;
  lastFrameTime = timestamp;
  
  // Advance tick based on BPM
  const usPerTick = (60_000_000 / capture.clock.bpm) / 96;
  const ticksPerMs = 1_000_000 / usPerTick;
  playbackTick += Math.max(1, Math.round(deltaMs * ticksPerMs / 1000));
  
  updateMixer();
  
  animationId = requestAnimationFrame(playbackLoop);
}

// ── Transport Controls ─────────────────────────────────────
document.getElementById('play-btn').addEventListener('click', () => {
  isPlaying = !isPlaying;
  const btn = document.getElementById('play-btn');
  btn.textContent = isPlaying ? '⏸' : '▶';
  btn.classList.toggle('active', isPlaying);
  
  if (isPlaying) {
    lastFrameTime = 0;
    animationId = requestAnimationFrame(playbackLoop);
  } else {
    if (animationId) cancelAnimationFrame(animationId);
  }
});

document.getElementById('stop-btn').addEventListener('click', () => {
  isPlaying = false;
  playbackTick = 0;
  const btn = document.getElementById('play-btn');
  btn.textContent = '▶';
  btn.classList.remove('active');
  if (animationId) cancelAnimationFrame(animationId);
  updateMixer();
});

document.getElementById('rec-btn').addEventListener('click', () => {
  isRecording = !isRecording;
  const btn = document.getElementById('rec-btn');
  btn.classList.toggle('active', isRecording);
  
  if (isRecording) {
    // Start a new session
    persistence.createSession(`Session ${new Date().toLocaleString()}`);
    document.getElementById('session-name').textContent = persistence.currentSession.title;
    document.getElementById('capture-status').textContent = 'Recording';
    
    // Start playback too
    if (!isPlaying) {
      document.getElementById('play-btn').click();
    }
  } else {
    document.getElementById('capture-status').textContent = 'Stopped';
  }
});

// ── Export/Clear ───────────────────────────────────────────
document.getElementById('export-btn').addEventListener('click', () => {
  const data = capture.exportJSON();
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `tensor-midi-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById('clear-btn').addEventListener('click', () => {
  capture.clear();
  vesselTrail = [];
  updateMixer();
  drawChart();
});

// ── Chart Controls ─────────────────────────────────────────
document.getElementById('chart-zoom-in').addEventListener('click', () => {
  chartZoom = Math.min(5, chartZoom + 0.5);
  drawChart();
});

document.getElementById('chart-zoom-out').addEventListener('click', () => {
  chartZoom = Math.max(0.5, chartZoom - 0.5);
  drawChart();
});

document.getElementById('chart-center').addEventListener('click', () => {
  chartZoom = 1;
  drawChart();
});

// ── Demo: Simulate a conversation ──────────────────────────
const demoMessages = [
  { text: "Hey, let's build something together", sender: 'human', direction: 'sent' },
  { text: "I love that idea! What are you thinking?", sender: 'assistant', direction: 'received' },
  { text: "Imagine a mixer board for conversations, rendered as jazz", sender: 'human', direction: 'sent' },
  { text: "That's brilliant. Each participant gets a channel. Each message is a note.", sender: 'assistant', direction: 'received' },
  { text: "And the timing? The rhythm of the conversation?", sender: 'human', direction: 'sent' },
  { text: "Mapped to a 12-pulse grid. 12/8 time. Jazz time.", sender: 'assistant', direction: 'received' },
  { text: "Can we see the harmony? The tension and release?", sender: 'human', direction: 'sent' },
  { text: "Yes. The analyzer reads the ensemble. Major 7ths when we're flowing. Dominant 7ths when there's friction.", sender: 'assistant', direction: 'received' },
  { text: "This error is annoying me. The build failed again.", sender: 'human', direction: 'sent' },
  { text: "I see the tension. Let me fix that. Deploying a patch now.", sender: 'assistant', direction: 'received' },
  { text: "Beautiful. It works now. The groove is back.", sender: 'human', direction: 'sent' },
  { text: "We're in the pocket. Major 7ths. Pure flow.", sender: 'assistant', direction: 'received' },
];

let demoIndex = 0;
let demoBaseTime = 0;

function runDemo() {
  if (demoIndex >= demoMessages.length) {
    // Reset and loop
    setTimeout(() => {
      capture.clear();
      vesselTrail = [];
      demoIndex = 0;
      demoBaseTime = Date.now();
      runDemo();
    }, 5000);
    return;
  }
  
  const msg = demoMessages[demoIndex];
  msg.timestamp = Date.now();
  
  const result = capture.captureMessage(msg);
  
  // Add chart position (simulated vessel movement)
  const angle = (demoIndex / demoMessages.length) * Math.PI * 2;
  const radius = 80 + Math.sin(demoIndex * 0.5) * 30;
  vesselTrail.push({
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius,
    pitch: result.sentiment.pitch,
    friction: result.event.errorMask > 0,
  });
  
  // Persist
  if (persistence.currentSession) {
    persistence.addMessage(msg);
    persistence.addEvents([result.event]);
    
    // Simulate vessel position
    persistence.addChartData({
      x: vesselTrail[vesselTrail.length - 1].x,
      y: vesselTrail[vesselTrail.length - 1].y,
    });
  }
  
  drawChart();
  demoIndex++;
  
  // Next message at varying intervals (creating rhythm)
  const interval = 800 + Math.random() * 1200;
  setTimeout(runDemo, interval);
}

// ── Keyboard Shortcuts ─────────────────────────────────────
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  
  switch (e.key) {
    case ' ':
      e.preventDefault();
      document.getElementById('play-btn').click();
      break;
    case 'r':
    case 'R':
      document.getElementById('rec-btn').click();
      break;
    case 's':
    case 'S':
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        persistence.saveAll();
      }
      break;
  }
});

// ── Initialize ─────────────────────────────────────────────
applyDeviceProfile();
initPulseGrid();
initChart();
updateMixer();

// Auto-start demo after a moment
setTimeout(() => {
  document.getElementById('rec-btn').click();
  demoBaseTime = Date.now();
  runDemo();
}, 1000);

// Periodically refresh device context (every 5 minutes)
setInterval(() => {
  device.refresh();
  applyDeviceProfile();
}, 300000);

console.log('🎹 Tensor-MIDI Mixer initialized');
console.log(`📱 Device: ${device.description}`);
console.log(`🎵 Tempo: ${device.defaultBpm} BPM · 12/8 time · 96 PPQ`);
console.log('Press Space to play/pause, R to record');
