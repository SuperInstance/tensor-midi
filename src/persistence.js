// ═══════════════════════════════════════════════════════════════════
// Data Persistence Layer — Musical Memory
// ═══════════════════════════════════════════════════════════════════
//
// Every captured conversation needs storage. This layer persists:
//   - MIDI files (the actual performance)
//   - Sentiment analysis (the emotional arc)
//   - 12-pulse timing data (the rhythmic grid)
//   - Chart positions (the spatial dimension)
//
// Design: organic growth — new conversations are new tracks,
// new agents are new channels. The schema grows like a jazz repertoire.

import { SwmidiStream, encodeStream, decodeStream } from './swmidi.js';

/// Session record — one conversation = one session = one "gig"
export class Session {
  constructor(id, title = 'Untitled Session') {
    this.id = id;
    this.title = title;
    this.createdAt = Date.now();
    this.updatedAt = this.createdAt;
    this.bpm = 120;
    this.channels = []; // [{ name, channel, role }]
    this.events = [];   // SWMIDI events
    this.messages = []; // Original messages with metadata
    this.analysis = {}; // Jazz analysis snapshots
    this.chartData = []; // GPS/chart positions
    this.metadata = {
      location: null,    // GPS coords if available
      device: null,      // Device context
      timeOfDay: null,   // morning, afternoon, evening, night
      weather: null,     // ambient context
    };
  }
  
  toJSON() {
    return {
      id: this.id,
      title: this.title,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      bpm: this.bpm,
      channels: this.channels,
      events: this.events,
      messages: this.messages,
      analysis: this.analysis,
      chartData: this.chartData,
      metadata: this.metadata,
    };
  }
  
  static fromJSON(data) {
    const session = new Session(data.id, data.title);
    session.createdAt = data.createdAt;
    session.updatedAt = data.updatedAt;
    session.bpm = data.bpm;
    session.channels = data.channels || [];
    session.events = data.events || [];
    session.messages = data.messages || [];
    session.analysis = data.analysis || {};
    session.chartData = data.chartData || [];
    session.metadata = data.metadata || {};
    return session;
  }
}

/// The Persistence Manager — stores and retrieves sessions
export class Persistence {
  constructor(storageKey = 'tensor-midi-sessions') {
    this.storageKey = storageKey;
    this.sessions = new Map();
    this.currentSession = null;
    this.loadAll();
  }
  
  /// Load all sessions from localStorage
  loadAll() {
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (!raw) return;
      
      const data = JSON.parse(raw);
      for (const sessionData of data.sessions || []) {
        const session = Session.fromJSON(sessionData);
        this.sessions.set(session.id, session);
      }
    } catch (e) {
      console.warn('Failed to load sessions:', e);
    }
  }
  
  /// Save all sessions to localStorage
  saveAll() {
    try {
      const data = {
        sessions: [...this.sessions.values()].map(s => s.toJSON()),
        version: 1,
        savedAt: Date.now(),
      };
      localStorage.setItem(this.storageKey, JSON.stringify(data));
    } catch (e) {
      console.warn('Failed to save sessions:', e);
    }
  }
  
  /// Create a new session
  createSession(title) {
    const id = `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const session = new Session(id, title);
    this.sessions.set(id, session);
    this.currentSession = session;
    this.saveAll();
    return session;
  }
  
  /// Get a session by ID
  getSession(id) {
    return this.sessions.get(id);
  }
  
  /// Update the current session
  updateSession(updates) {
    if (!this.currentSession) return;
    Object.assign(this.currentSession, updates);
    this.currentSession.updatedAt = Date.now();
    this.saveAll();
  }
  
  /// Add events to the current session
  addEvents(events) {
    if (!this.currentSession) return;
    this.currentSession.events.push(...events);
    this.currentSession.updatedAt = Date.now();
    this.saveAll();
  }
  
  /// Add a message to the current session
  addMessage(message) {
    if (!this.currentSession) return;
    this.currentSession.messages.push(message);
    this.currentSession.updatedAt = Date.now();
    this.saveAll();
  }
  
  /// Add chart position data
  addChartData(position) {
    if (!this.currentSession) return;
    this.currentSession.chartData.push({
      ...position,
      timestamp: Date.now(),
    });
    this.currentSession.updatedAt = Date.now();
    this.saveAll();
  }
  
  /// Register a channel/participant
  registerChannel(name, channel, role = 'agent') {
    if (!this.currentSession) return;
    const exists = this.currentSession.channels.find(c => c.channel === channel);
    if (!exists) {
      this.currentSession.channels.push({ name, channel, role });
      this.saveAll();
    }
  }
  
  /// Export session as SWMIDI binary
  exportBinary(sessionId) {
    const session = this.sessions.get(sessionId || this.currentSession?.id);
    if (!session) return null;
    
    const stream = new SwmidiStream();
    stream.events = session.events;
    return stream.encode();
  }
  
  /// Export session as JSON
  exportJSON(sessionId) {
    const session = this.sessions.get(sessionId || this.currentSession?.id);
    if (!session) return null;
    return JSON.stringify(session.toJSON(), null, 2);
  }
  
  /// Get all sessions (summary)
  getAllSessions() {
    return [...this.sessions.values()].map(s => ({
      id: s.id,
      title: s.title,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      bpm: s.bpm,
      eventCount: s.events.length,
      messageCount: s.messages.length,
      channelCount: s.channels.length,
    }));
  }
  
  /// Delete a session
  deleteSession(id) {
    this.sessions.delete(id);
    if (this.currentSession?.id === id) {
      this.currentSession = null;
    }
    this.saveAll();
  }
  
  /// Get storage statistics
  getStats() {
    let totalEvents = 0;
    let totalMessages = 0;
    let totalChannels = 0;
    
    for (const session of this.sessions.values()) {
      totalEvents += session.events.length;
      totalMessages += session.messages.length;
      totalChannels += session.channels.length;
    }
    
    return {
      sessionCount: this.sessions.size,
      totalEvents,
      totalMessages,
      totalChannels,
      storageUsed: JSON.stringify([...this.sessions.values()].map(s => s.toJSON())).length,
    };
  }
}

/// IndexedDB wrapper for larger datasets (optional, falls back to localStorage)
export class IndexedDBPersistence {
  constructor(dbName = 'tensor-midi', storeName = 'sessions') {
    this.dbName = dbName;
    this.storeName = storeName;
    this.db = null;
  }
  
  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve(this.db);
      };
      
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName, { keyPath: 'id' });
        }
      };
    });
  }
  
  async save(session) {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(this.storeName, 'readwrite');
      const store = tx.objectStore(this.storeName);
      const request = store.put(session.toJSON());
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
  
  async load(id) {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(this.storeName, 'readonly');
      const store = tx.objectStore(this.storeName);
      const request = store.get(id);
      request.onsuccess = () => resolve(request.result ? Session.fromJSON(request.result) : null);
      request.onerror = () => reject(request.error);
    });
  }
  
  async loadAll() {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(this.storeName, 'readonly');
      const store = tx.objectStore(this.storeName);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result.map(d => Session.fromJSON(d)));
      request.onerror = () => reject(request.error);
    });
  }
}
