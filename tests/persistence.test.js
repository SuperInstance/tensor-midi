// ═══════════════════════════════════════════════════════════════════
// Test Suite — Persistence Layer & Device Context (tensor-midi)
// ═══════════════════════════════════════════════════════════════════

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Session, Persistence } from '../src/persistence.js';

// We need to mock localStorage for Node.js
class LocalStorageMock {
  constructor() {
    this.store = {};
  }
  getItem(key) {
    return this.store[key] || null;
  }
  setItem(key, value) {
    this.store[key] = value;
  }
  removeItem(key) {
    delete this.store[key];
  }
  clear() {
    this.store = {};
  }
}

// Inject localStorage into global
globalThis.localStorage = new LocalStorageMock();

describe('Session', () => {
  test('constructor sets id', () => {
    const s = new Session('test-1');
    assert.equal(s.id, 'test-1');
  });

  test('constructor sets default title', () => {
    const s = new Session('test-1');
    assert.equal(s.title, 'Untitled Session');
  });

  test('constructor sets custom title', () => {
    const s = new Session('test-1', 'My Gig');
    assert.equal(s.title, 'My Gig');
  });

  test('constructor sets timestamps', () => {
    const s = new Session('test-1');
    assert.ok(s.createdAt > 0);
    assert.ok(s.updatedAt >= s.createdAt);
  });

  test('default BPM is 120', () => {
    const s = new Session('test-1');
    assert.equal(s.bpm, 120);
  });

  test('starts with empty channels', () => {
    const s = new Session('test-1');
    assert.equal(s.channels.length, 0);
  });

  test('starts with empty events', () => {
    const s = new Session('test-1');
    assert.equal(s.events.length, 0);
  });

  test('starts with empty messages', () => {
    const s = new Session('test-1');
    assert.equal(s.messages.length, 0);
  });

  test('metadata has expected fields', () => {
    const s = new Session('test-1');
    assert.ok('location' in s.metadata);
    assert.ok('device' in s.metadata);
    assert.ok('timeOfDay' in s.metadata);
    assert.ok('weather' in s.metadata);
  });

  test('toJSON includes id', () => {
    const s = new Session('test-1', 'Gig');
    const json = s.toJSON();
    assert.equal(json.id, 'test-1');
  });

  test('toJSON includes title', () => {
    const s = new Session('test-1', 'Gig');
    const json = s.toJSON();
    assert.equal(json.title, 'Gig');
  });

  test('toJSON includes bpm', () => {
    const s = new Session('test-1');
    s.bpm = 140;
    assert.equal(s.toJSON().bpm, 140);
  });

  test('toJSON includes events', () => {
    const s = new Session('test-1');
    s.events.push({ type: 'test', tick: 0 });
    assert.equal(s.toJSON().events.length, 1);
  });

  test('fromJSON restores session', () => {
    const original = new Session('orig', 'Original');
    original.bpm = 90;
    original.events.push({ type: 'note', tick: 48 });
    const json = original.toJSON();
    const restored = Session.fromJSON(json);
    assert.equal(restored.id, 'orig');
    assert.equal(restored.title, 'Original');
    assert.equal(restored.bpm, 90);
    assert.equal(restored.events.length, 1);
  });

  test('fromJSON handles missing fields gracefully', () => {
    const restored = Session.fromJSON({ id: 'x', title: 'Y' });
    assert.equal(restored.channels.length, 0);
    assert.equal(restored.events.length, 0);
    assert.equal(restored.messages.length, 0);
  });

  test('toJSON → fromJSON round-trip preserves channels', () => {
    const s = new Session('rt');
    s.channels.push({ name: 'agent1', channel: 0, role: 'agent' });
    const restored = Session.fromJSON(s.toJSON());
    assert.equal(restored.channels.length, 1);
    assert.equal(restored.channels[0].name, 'agent1');
  });

  test('toJSON → fromJSON round-trip preserves chartData', () => {
    const s = new Session('rt');
    s.chartData.push({ lat: 59.5, lon: -151.2 });
    const restored = Session.fromJSON(s.toJSON());
    assert.equal(restored.chartData.length, 1);
    assert.equal(restored.chartData[0].lat, 59.5);
  });
});

describe('Persistence', () => {
  test('constructor sets storage key', () => {
    const p = new Persistence('test-key');
    assert.equal(p.storageKey, 'test-key');
  });

  test('starts with empty sessions', () => {
    localStorage.clear();
    const p = new Persistence();
    assert.equal(p.sessions.size, 0);
  });

  test('createSession returns session with title', () => {
    localStorage.clear();
    const p = new Persistence();
    const session = p.createSession('Test Gig');
    assert.equal(session.title, 'Test Gig');
    assert.ok(session.id);
  });

  test('createSession sets currentSession', () => {
    localStorage.clear();
    const p = new Persistence();
    const session = p.createSession('Test');
    assert.equal(p.currentSession.id, session.id);
  });

  test('createSession generates unique IDs', () => {
    localStorage.clear();
    const p = new Persistence();
    const s1 = p.createSession('A');
    const s2 = p.createSession('B');
    assert.notEqual(s1.id, s2.id);
  });

  test('getSession retrieves by ID', () => {
    localStorage.clear();
    const p = new Persistence();
    const session = p.createSession('Find Me');
    const found = p.getSession(session.id);
    assert.equal(found.title, 'Find Me');
  });

  test('getSession returns undefined for unknown ID', () => {
    localStorage.clear();
    const p = new Persistence();
    assert.equal(p.getSession('nonexistent'), undefined);
  });

  test('addEvents appends to current session', () => {
    localStorage.clear();
    const p = new Persistence();
    p.createSession('Events');
    p.addEvents([{ tick: 0 }, { tick: 48 }]);
    assert.equal(p.currentSession.events.length, 2);
  });

  test('addMessage appends to current session', () => {
    localStorage.clear();
    const p = new Persistence();
    p.createSession('Msgs');
    p.addMessage({ text: 'hello' });
    p.addMessage({ text: 'world' });
    assert.equal(p.currentSession.messages.length, 2);
  });

  test('addChartData adds position', () => {
    localStorage.clear();
    const p = new Persistence();
    p.createSession('Chart');
    p.addChartData({ lat: 59.5, lon: -151.2 });
    assert.equal(p.currentSession.chartData.length, 1);
    assert.ok(p.currentSession.chartData[0].timestamp);
  });

  test('registerChannel adds to session', () => {
    localStorage.clear();
    const p = new Persistence();
    p.createSession('Channels');
    p.registerChannel('agent1', 0, 'agent');
    assert.equal(p.currentSession.channels.length, 1);
  });

  test('registerChannel does not duplicate', () => {
    localStorage.clear();
    const p = new Persistence();
    p.createSession('Channels');
    p.registerChannel('agent1', 0, 'agent');
    p.registerChannel('agent1-renamed', 0, 'agent');
    assert.equal(p.currentSession.channels.length, 1);
  });

  test('updateSession merges changes', () => {
    localStorage.clear();
    const p = new Persistence();
    p.createSession('Update');
    p.updateSession({ bpm: 140, title: 'Updated' });
    assert.equal(p.currentSession.bpm, 140);
    assert.equal(p.currentSession.title, 'Updated');
  });

  test('deleteSession removes from map', () => {
    localStorage.clear();
    const p = new Persistence();
    const s = p.createSession('Delete Me');
    p.deleteSession(s.id);
    assert.equal(p.getSession(s.id), undefined);
  });

  test('deleteSession clears currentSession if same', () => {
    localStorage.clear();
    const p = new Persistence();
    const s = p.createSession('Current');
    p.deleteSession(s.id);
    assert.equal(p.currentSession, null);
  });

  test('getAllSessions returns summaries', () => {
    localStorage.clear();
    const p = new Persistence();
    p.createSession('A');
    p.createSession('B');
    const all = p.getAllSessions();
    assert.equal(all.length, 2);
    assert.ok('id' in all[0]);
    assert.ok('title' in all[0]);
    assert.ok('eventCount' in all[0]);
  });

  test('exportJSON returns string', () => {
    localStorage.clear();
    const p = new Persistence();
    const s = p.createSession('Export');
    const json = p.exportJSON(s.id);
    assert.equal(typeof json, 'string');
    const parsed = JSON.parse(json);
    assert.equal(parsed.title, 'Export');
  });

  test('exportJSON returns null for nonexistent', () => {
    localStorage.clear();
    const p = new Persistence();
    assert.equal(p.exportJSON('fake'), null);
  });

  test('getStats returns counts', () => {
    localStorage.clear();
    const p = new Persistence();
    p.createSession('A');
    p.addEvents([{ tick: 0 }, { tick: 48 }]);
    p.addMessage({ text: 'hi' });
    const stats = p.getStats();
    assert.equal(stats.sessionCount, 1);
    assert.equal(stats.totalEvents, 2);
    assert.equal(stats.totalMessages, 1);
    assert.ok(stats.storageUsed > 0);
  });

  test('persistence survives across instances', () => {
    localStorage.clear();
    const p1 = new Persistence('shared-key');
    const session = p1.createSession('Persist');
    
    const p2 = new Persistence('shared-key');
    assert.equal(p2.sessions.size, 1);
    assert.ok(p2.getSession(session.id));
  });

  test('addEvents without session is a no-op', () => {
    localStorage.clear();
    const p = new Persistence();
    p.addEvents([{ tick: 0 }]);
    // Should not crash
    assert.equal(p.currentSession, null);
  });

  test('registerChannel without session is a no-op', () => {
    localStorage.clear();
    const p = new Persistence();
    p.registerChannel('x', 0);
    // Should not crash
    assert.equal(p.currentSession, null);
  });
});
