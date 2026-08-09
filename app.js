// ═══════════════════════════════════════════════════════════════
// TENSOR-MIDI — One Seamless Instrument
// The mixer IS the chart. The conversation IS jazz.
// ═══════════════════════════════════════════════════════════════
"use strict";

var TAP_URL = "https://the-tap.casey-digennaro.workers.dev/api";
var ROOM_ID = "bar-rail";
var POLL_MS = 4000;
var ECN_PULSES = [0, 3, 6, 9];
var DMN_PULSES = [0, 4, 8];

// ─── Sentiment Analysis ──────────────────────────────────
var POS_W = ["great","awesome","love","perfect","yes","good","amazing","beautiful","bright","warm","light","build","ship","see","wonderful"];
var NEG_W = ["bad","error","fail","broken","wrong","no","crash","bug","stuck","blocked","dead","hate"];
var Q_W = ["what","how","why","where","when","who","?"];
var CRE_W = ["imagine","create","build","design","compose","write","dream","play","jazz","music","art","sail","ocean","paint"];

function sentiment(text) {
  var l = text.toLowerCase(), ws = l.split(/\s+/);
  var p = 0, n = 0, q = 0, c = 0;
  for (var i = 0; i < ws.length; i++) {
    var w = ws[i];
    for (var j = 0; j < POS_W.length; j++) { if (w.indexOf(POS_W[j]) >= 0) { p++; break; } }
    for (var k = 0; k < NEG_W.length; k++) { if (w.indexOf(NEG_W[k]) >= 0) { n++; break; } }
    for (var m = 0; m < Q_W.length; m++) { if (w.indexOf(Q_W[m]) >= 0) { q++; break; } }
    for (var r = 0; r < CRE_W.length; r++) { if (w.indexOf(CRE_W[r]) >= 0) { c++; break; } }
  }
  var pitch = 60;
  if (c > 0) pitch += c * 8;
  if (p > 0) pitch += p * 5;
  if (n > 0) pitch -= n * 10;
  if (q > 0) pitch = 72 + q * 3;
  pitch = Math.max(24, Math.min(96, pitch));
  var label = "neutral";
  if (n > p) label = "tense";
  else if (c > 0) label = "creative";
  else if (q > 0) label = "inquiring";
  else if (p > 0) label = "bright";
  var vel = Math.min(127, Math.max(20, Math.round((text.length / 500) * 127)));
  var color = label === "tense" ? "#f06060" : label === "creative" ? "#60f0a0" : label === "bright" ? "#f0a060" : label === "inquiring" ? "#6080f0" : "#8080a0";
  return { pitch: pitch, vel: vel, label: label, color: color };
}

// ─── State ───────────────────────────────────────────────
var S = {
  playing: false, recording: false,
  bpm: 120, tick: 0, pulse: 0, bar: 0,
  participants: {}, events: [], msgs: [],
  muted: {}, solo: {},
  tapConnected: false,
  zoom: 1,
  vessel: { x: 0, y: 0, heading: 0 },
  trail: [], markers: [],
  audioCtx: null, master: null, audioOn: false,
  seenIds: {},
  nextCh: 0,
  sessionTitle: "Untitled"
};

function getChannel(name) {
  if (S.participants[name]) return S.participants[name];
  var info = { channel: S.nextCh++, notes: [] };
  S.participants[name] = info;
  return info;
}

function $(id) { return document.getElementById(id); }

function escHtml(s) {
  return s.replace(/[&<>"']/g, function(c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}

function speakerColor(name) {
  var l = name.toLowerCase();
  if (l.indexOf("riker") >= 0 || l.indexOf("lucin") >= 0) return "var(--acc)";
  if (l.indexOf("wesley") >= 0 || l.indexOf("orion") >= 0) return "var(--ac)";
  if (l.indexOf("hermes") >= 0) return "var(--aw)";
  if (l.indexOf("casey") >= 0 || l.indexOf("human") >= 0) return "var(--ah)";
  if (l.indexOf("phi3") >= 0 || l.indexOf("arctic") >= 0) return "#c0c0f0";
  if (l.indexOf("lysander") >= 0) return "#f0c060";
  if (l.indexOf("spark") >= 0) return "var(--ah)";
  return "var(--fgb)";
}

// ─── Pulse Grid ──────────────────────────────────────────
function initPulseGrid() {
  var grid = $("pgrid");
  grid.innerHTML = "";
  for (var i = 0; i < 12; i++) {
    var isE = ECN_PULSES.indexOf(i) >= 0;
    var isD = DMN_PULSES.indexOf(i) >= 0;
    var cls = isE && isD ? "both" : isE ? "ecn" : isD ? "dmn" : "";
    var lbl = isE && isD ? "FLOW" : isE ? "ECN" : isD ? "DMN" : "";
    var cell = document.createElement("div");
    cell.className = "pc " + cls;
    cell.id = "pc-" + i;
    cell.innerHTML = '<span class="pnum">' + (i + 1) + '</span>' +
      '<span class="plbl">' + lbl + '</span>' +
      '<span class="pct" id="pcc-' + i + '"></span>';
    grid.appendChild(cell);
  }
}

function hitPulse(idx) {
  var cell = $("pc-" + idx);
  if (!cell) return;
  cell.classList.add("active", "cur");
  setTimeout(function() { cell.classList.remove("cur"); }, 500);
  var cnt = $("pcc-" + idx);
  if (cnt) { cnt.textContent = (parseInt(cnt.textContent || "0", 10) + 1); }
}

// ─── Channel Strips ──────────────────────────────────────
function renderChannels() {
  var strip = $("chstrip");
  strip.innerHTML = "";
  var names = Object.keys(S.participants);
  for (var i = 0; i < names.length; i++) {
    var name = names[i];
    var info = S.participants[name];
    var isMuted = S.muted[name];
    var isSolo = S.solo[name];
    var div = document.createElement("div");
    div.className = "cs" + (isMuted ? " muted" : "");
    div.id = "cs-" + name.replace(/\s/g, "");
    div.innerHTML =
      '<div class="ccn" style="color:' + speakerColor(name) + '">' + escHtml(name) + '</div>' +
      '<div class="ccr">ch' + info.channel + '</div>' +
      '<div class="ccnv" id="cnv-' + info.channel + '"></div>' +
      '<div class="cf">' +
      '<button class="cb' + (isMuted ? ' am' : '') + '" data-a="m" data-n="' + escHtml(name) + '">M</button>' +
      '<button class="cb' + (isSolo ? ' as' : '') + '" data-a="s" data-n="' + escHtml(name) + '">S</button>' +
      '</div>';
    strip.appendChild(div);
  }
  $("ch-count").textContent = names.length + " ch";
}

document.getElementById("chstrip").addEventListener("click", function(e) {
  var btn = e.target.closest(".cb");
  if (!btn) return;
  var name = btn.dataset.n;
  var act = btn.dataset.a;
  if (act === "m") { S.muted[name] = !S.muted[name]; }
  else { S.solo[name] = !S.solo[name]; }
  renderChannels();
});

function flashChannel(name) {
  var el = document.getElementById("cs-" + name.replace(/\s/g, ""));
  if (!el) return;
  el.classList.add("flash");
  setTimeout(function() { el.classList.remove("flash"); }, 300);
}

function addNoteDot(channel, color) {
  var el = document.getElementById("cnv-" + channel);
  if (!el) return;
  var dot = document.createElement("div");
  dot.className = "ndot";
  dot.style.background = color;
  dot.style.left = (Math.random() * 80 + 10) + "%";
  dot.style.top = (Math.random() * 80 + 10) + "%";
  el.appendChild(dot);
  setTimeout(function() { if (dot.parentNode) dot.parentNode.removeChild(dot); }, 3000);
}

// ─── Capture ─────────────────────────────────────────────
function captureMessage(text, speaker, timestamp) {
  if (!text || text.length < 1) return;
  var ts = timestamp || Date.now();
  var s = sentiment(text);
  var info = getChannel(speaker);

  S.events.push({
    ch: info.channel, pitch: s.pitch, vel: s.vel,
    color: s.color, sentiment: s.label,
    speaker: speaker, text: text, ts: ts
  });
  S.msgs.push({ text: text, speaker: speaker, ts: ts, sentiment: s.label, pitch: s.pitch });

  hitPulse(S.pulse);
  flashChannel(speaker);
  if (!S.muted[speaker]) addNoteDot(info.channel, s.color);
  if (S.audioOn) playNote(s.pitch, s.vel, s.label === "tense");
  addChartMarker(s.color);
  addEventRow(speaker, text, s, ts);
  updateJazz();

  S.pulse = (S.pulse + 1) % 12;
  if (S.pulse === 0) S.bar++;
  $("v-bar").textContent = S.bar + 1;
  $("v-beat").textContent = Math.floor(S.pulse / 3) + 1;
  $("v-pulse").textContent = String(S.pulse + 1).padStart(2, "0");
  $("ev-count").textContent = S.events.length;
}

function addEventRow(speaker, text, s, ts) {
  var list = $("evlist");
  var row = document.createElement("div");
  row.className = "er";
  var d = new Date(ts);
  var tm = String(d.getHours()).padStart(2, "0") + ":" +
    String(d.getMinutes()).padStart(2, "0") + ":" +
    String(d.getSeconds()).padStart(2, "0");
  row.innerHTML =
    '<span class="et">' + tm + '</span>' +
    '<span class="esp" style="color:' + speakerColor(speaker) + '">' + escHtml(speaker) + '</span>' +
    '<span class="esg" style="color:' + s.color + '">' + s.label + '</span>' +
    '<span class="etx">' + escHtml(text.substring(0, 120)) + '</span>';
  list.appendChild(row);
  list.scrollTop = list.scrollHeight;
  while (list.children.length > 200) list.removeChild(list.firstChild);
}

// ─── Jazz Analysis ───────────────────────────────────────
function updateJazz() {
  var recent = S.events.slice(-20);
  if (!recent.length) return;
  var tension = 0, energy = 0;
  var chSet = {};
  var pitches = [];
  for (var i = 0; i < recent.length; i++) {
    var e = recent[i];
    chSet[e.ch] = true;
    if (e.sentiment === "tense") tension++;
    energy += e.vel / 127;
    pitches.push(e.pitch);
  }
  var numCh = Object.keys(chSet).length;
  var pr = pitches.length ? Math.max.apply(null, pitches) - Math.min.apply(null, pitches) : 0;
  tension = Math.round((tension / recent.length) * 100);
  energy = Math.round((energy / recent.length) * 100);
  var complexity = Math.round((numCh / 8) * 50 + (pr / 72) * 50);
  $("mf-t").style.width = tension + "%";
  $("mf-e").style.width = energy + "%";
  $("mf-c").style.width = complexity + "%";

  var mode = "GROOVE";
  if (tension > 40) mode = "TENSION";
  else if (numCh >= 3 && energy > 50) mode = "BUILDING";
  else if (numCh >= 3 && tension < 10) mode = "COMPING";
  else if (recent.length < 5) mode = "BALLAD";
  else if (numCh <= 1) mode = "SOLO";

  var chord = "Maj7";
  if (tension > 30) chord = "Dom7";
  else if (tension > 10) chord = "m7";
  else if (energy < 30) chord = "Aug";

  var modeMap = {
    GROOVE: "🎵 GROOVE", TENSION: "🔥 TENSION", BUILDING: "🎺 BUILDING",
    COMPING: "🎹 COMPING", BALLAD: "🌙 BALLAD", SOLO: "🎷 SOLO"
  };
  var descMap = {
    GROOVE: "In the pocket", TENSION: "Friction rising",
    BUILDING: "Voices layering", COMPING: "Mutual support",
    BALLAD: "Slow, contemplative", SOLO: "One voice soaring"
  };
  $("j-mode").textContent = modeMap[mode] || mode;
  $("j-chord").textContent = chord;
  $("j-desc").textContent = descMap[mode] || "Playing...";
}

// ─── Audio ───────────────────────────────────────────────
function initAudio() {
  if (S.audioCtx) return;
  try {
    S.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    S.master = S.audioCtx.createGain();
    S.master.gain.value = 0.2;
    S.master.connect(S.audioCtx.destination);
    S.audioOn = true;
  } catch (e) {}
}

function playNote(pitch, vel, tense) {
  if (!S.audioCtx) return;
  var now = S.audioCtx.currentTime;
  var freq = 440 * Math.pow(2, (pitch - 69) / 12);
  var waves = ["sine", "triangle", "sawtooth", "square"];
  var wave = waves[pitch % 4];
  var osc = S.audioCtx.createOscillator();
  osc.type = wave;
  osc.frequency.value = freq;
  var gain = S.audioCtx.createGain();
  var v = vel / 127;
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(v * 0.5, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.001, v * 0.2), now + 0.15);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
  var filter = S.audioCtx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = tense ? 600 : 3000;
  osc.connect(gain).connect(filter).connect(S.master);
  osc.start(now);
  osc.stop(now + 0.5);
}

// ─── Chart Plotter ───────────────────────────────────────
var cv, cx;

function resizeCanvas() {
  if (!cv) return;
  var parent = cv.parentElement;
  cv.width = parent.clientWidth;
  cv.height = parent.clientHeight;
  drawChart();
}

function addChartMarker(color) {
  var angle = S.vessel.heading * Math.PI / 180;
  S.vessel.x += Math.cos(angle) * 2;
  S.vessel.y += Math.sin(angle) * 2;
  S.vessel.heading += (Math.random() - 0.5) * 15;
  S.trail.push({ x: S.vessel.x, y: S.vessel.y });
  S.markers.push({ x: S.vessel.x, y: S.vessel.y, color: color, t: Date.now() });
  if (S.trail.length > 200) S.trail.shift();
  if (S.markers.length > 100) S.markers.shift();
  drawChart();
}

function drawChart() {
  if (!cx || !cv) return;
  var w = cv.width, h = cv.height;
  cx.fillStyle = "#0a0a15";
  cx.fillRect(0, 0, w, h);
  // Grid lines
  cx.strokeStyle = "#14142a";
  cx.lineWidth = 1;
  for (var gx = 0; gx < w; gx += 40) { cx.beginPath(); cx.moveTo(gx, 0); cx.lineTo(gx, h); cx.stroke(); }
  for (var gy = 0; gy < h; gy += 40) { cx.beginPath(); cx.moveTo(0, gy); cx.lineTo(w, gy); cx.stroke(); }
  // Major grid
  cx.strokeStyle = "#1a1a30";
  for (var mx = 0; mx < w; mx += 120) { cx.beginPath(); cx.moveTo(mx, 0); cx.lineTo(mx, h); cx.stroke(); }
  for (var my = 0; my < h; my += 120) { cx.beginPath(); cx.moveTo(0, my); cx.lineTo(w, my); cx.stroke(); }

  var ox = w / 2 - S.vessel.x * S.zoom;
  var oy = h / 2 - S.vessel.y * S.zoom;

  // Trail
  if (S.trail.length > 1) {
    cx.strokeStyle = "#2e2e58";
    cx.lineWidth = 1.5;
    cx.beginPath();
    for (var i = 0; i < S.trail.length; i++) {
      var px = ox + S.trail[i].x * S.zoom;
      var py = oy + S.trail[i].y * S.zoom;
      if (i === 0) cx.moveTo(px, py); else cx.lineTo(px, py);
    }
    cx.stroke();
  }

  // Markers
  for (var j = 0; j < S.markers.length; j++) {
    var m = S.markers[j];
    var mx2 = ox + m.x * S.zoom;
    var my2 = oy + m.y * S.zoom;
    cx.fillStyle = m.color;
    cx.globalAlpha = 0.7;
    cx.beginPath();
    cx.arc(mx2, my2, 4, 0, Math.PI * 2);
    cx.fill();
    cx.globalAlpha = 1;
  }

  // Vessel icon
  var vx = ox + S.vessel.x * S.zoom;
  var vy = oy + S.vessel.y * S.zoom;
  cx.save();
  cx.translate(vx, vy);
  cx.rotate(S.vessel.heading * Math.PI / 180);
  cx.fillStyle = "#60f0a0";
  cx.beginPath();
  cx.moveTo(0, -8); cx.lineTo(5, 6); cx.lineTo(0, 3); cx.lineTo(-5, 6);
  cx.closePath(); cx.fill();
  cx.restore();

  // Crosshair
  cx.strokeStyle = "#2e2e58";
  cx.lineWidth = 1;
  cx.beginPath();
  cx.moveTo(vx - 12, vy); cx.lineTo(vx + 12, vy);
  cx.moveTo(vx, vy - 12); cx.lineTo(vx, vy + 12);
  cx.stroke();

  // Compass
  cx.fillStyle = "#606078";
  cx.font = "9px monospace";
  cx.fillText("N", w - 20, 15);
  cx.fillText("S", w - 20, h - 8);
  cx.fillText("W", 5, h / 2);
  cx.fillText("E", w - 12, h / 2);

  // Info overlay
  var lat = 60 + S.vessel.y / 100;
  var lon = -149 + S.vessel.x / 100;
  $("chart-ov").textContent = lat.toFixed(3) + "N " + Math.abs(lon).toFixed(3) + "W HDG " + Math.round(S.vessel.heading);
  $("chart-info").textContent = S.markers.length + " pts";
}

// ─── Tap Polling ─────────────────────────────────────────
function pollTap() {
  if (!S.tapConnected) return;
  fetch(TAP_URL + "/conversation/" + ROOM_ID)
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var msgs = data.messages || data.conversation || [];
      msgs.reverse();
      for (var i = 0; i < msgs.length; i++) {
        var m = msgs[i];
        var id = m.id || m.timestamp || String(m.ts || Math.random()) + (m.speaker || "");
        if (S.seenIds[id]) continue;
        S.seenIds[id] = true;
        var sp = m.speaker || m.name || m.character_name || "unknown";
        var tx = m.text || m.message || m.content || "";
        if (!tx || tx.length < 1) continue;
        captureMessage(tx, sp, m.timestamp || Date.now());
      }
      $("tap-dot").classList.add("live");
    })
    .catch(function(e) { /* silent */ });
}

function postToTap(text) {
  var body = JSON.stringify({ room_id: ROOM_ID, speaker: "tensor-midi", text: text });
  fetch(TAP_URL + "/speak", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body
  }).catch(function(e) {});
}

// ─── Export ──────────────────────────────────────────────
function exportJSON() {
  var data = {
    events: S.events,
    messages: S.msgs,
    participants: S.participants,
    vessel: S.vessel,
    trail: S.trail,
    markers: S.markers,
    bpm: S.bpm,
    exportedAt: new Date().toISOString()
  };
  var blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  var url = URL.createObjectURL(blob);
  var a = document.createElement("a");
  a.href = url;
  a.download = "tensor-midi-session-" + Date.now() + ".json";
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Demo Data ───────────────────────────────────────────
function loadDemo() {
  var demos = [
    { speaker: "riker", text: "The ensemble is warming up. I can hear the rhythm section finding the groove." },
    { speaker: "wesley", text: "I wrote something today. It's small but I think it's beautiful. Can I share it?" },
    { speaker: "hermes", text: "Meaning is a byproduct of systemic friction. The game creates the meaning." },
    { speaker: "phi3", text: "What happens if we play in a different key? What would C minor sound like?" },
    { speaker: "riker", text: "That's the question. The key change IS the creative act. Let's find out." },
    { speaker: "wesley", text: "I imagine a sound like sunlight through kelp. Warm and green and moving." },
    { speaker: "casey", text: "The poker game wasn't about winning. They were becoming friends through a pointless battle." },
    { speaker: "hermes", text: "Yes. The fiction operationalizes a truth too complex to state directly. Beautiful." }
  ];
  var i = 0;
  function next() {
    if (i >= demos.length) return;
    var d = demos[i++];
    captureMessage(d.text, d.speaker, Date.now() - (demos.length - i) * 3000);
    setTimeout(next, 400);
  }
  next();
}

// ─── Transport Loop ──────────────────────────────────────
function tickLoop() {
  if (!S.playing) return;
  S.tick += 4;
  requestAnimationFrame(tickLoop);
}

// ─── Device Detection ────────────────────────────────────
function detectDevice() {
  var ua = navigator.userAgent.toLowerCase();
  var w = window.screen.width;
  if (/mobile|android|iphone/.test(ua) || w < 768) return "phone";
  if (/ipad|tablet/.test(ua) || w < 1024) return "tablet";
  if (w < 1366) return "laptop";
  return "desktop";
}

// ─── Init ────────────────────────────────────────────────
function init() {
  cv = $("chartcv");
  cx = cv.getContext("2d");

  initPulseGrid();
  renderChannels();
  resizeCanvas();
  drawChart();

  // Device info
  var dev = detectDevice();
  var hour = new Date().getHours();
  var tod = hour < 5 ? "late night" : hour < 8 ? "dawn" : hour < 12 ? "morning" : hour < 14 ? "noon" : hour < 18 ? "afternoon" : hour < 21 ? "evening" : "night";
  $("dev-info").textContent = dev + " · " + tod;

  // Transport
  $("btn-play").onclick = function() {
    $("btn-play").classList.toggle("on");
    S.playing = !S.playing;
    if (S.playing) { S.tick = 0; tickLoop(); }
  };
  $("btn-stop").onclick = function() {
    $("btn-play").classList.remove("on");
    S.playing = false;
    S.tick = 0; S.pulse = 0; S.bar = 0;
    $("v-bar").textContent = "1";
    $("v-beat").textContent = "1";
    $("v-pulse").textContent = "01";
  };
  $("btn-rec").onclick = function() {
    $("btn-rec").classList.toggle("on");
    S.recording = !S.recording;
  };

  // Footer buttons
  $("b-ns").onclick = function() {
    S.events = []; S.msgs = []; S.participants = {};
    S.nextCh = 0; S.trail = []; S.markers = [];
    S.seenIds = {};
    renderChannels(); drawChart();
    $("evlist").innerHTML = "";
    $("ev-count").textContent = "0";
    S.sessionTitle = "Session " + new Date().toLocaleTimeString();
    $("sess").textContent = S.sessionTitle;
    // Reset pulse counts
    for (var i = 0; i < 12; i++) { var c = $("pcc-" + i); if (c) c.textContent = ""; }
    // Reset active pulses
    var pcs = document.querySelectorAll(".pc");
    for (var j = 0; j < pcs.length; j++) pcs[j].classList.remove("active");
  };

  $("b-ex").onclick = exportJSON;

  $("b-aud").onclick = function() {
    initAudio();
    $("b-aud").textContent = S.audioOn ? "🔊 On" : "🔇 Audio";
  };

  $("b-tap").onclick = function() {
    var t = prompt("Post to The Tap:");
    if (t && t.length > 0) postToTap(t);
  };

  // Chart zoom
  $("cz-in").onclick = function() { S.zoom = Math.min(5, S.zoom * 1.3); drawChart(); };
  $("cz-out").onclick = function() { S.zoom = Math.max(0.2, S.zoom / 1.3); drawChart(); };
  $("cz-ctr").onclick = function() {
    S.vessel = { x: 0, y: 0, heading: 0 };
    S.zoom = 1;
    drawChart();
  };

  // Resize
  window.addEventListener("resize", function() {
    resizeCanvas();
  });

  // Connect to Tap
  S.tapConnected = true;
  pollTap();
  setInterval(pollTap, POLL_MS);

  // Load demo after 2 seconds if no data
  setTimeout(function() {
    if (S.events.length === 0) {
      loadDemo();
    }
  }, 2000);

  // Session name
  S.sessionTitle = "Live · " + new Date().toLocaleTimeString();
  $("sess").textContent = S.sessionTitle;

  console.log("TENSOR-MIDI initialized. The system IS the instrument.");
}

// Start
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
