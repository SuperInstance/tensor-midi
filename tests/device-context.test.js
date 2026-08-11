// ═══════════════════════════════════════════════════════════════════
// Test Suite — Device Context (tensor-midi)
// Tests getTimeOfDay, DeviceType, TimeOfDay constants, and DeviceProfile
// Browser APIs are mocked for device detection tests.
// ═══════════════════════════════════════════════════════════════════

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// We need to stub browser globals before importing
// Set up minimal browser environment
const originalGlobal = { ...globalThis };

// Mock browser globals
function setupBrowserMock(options = {}) {
  const {
    userAgent = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
    screenWidth = 1920,
    screenHeight = 1080,
    isTouch = false,
    vesselMode = false,
    geolocation = null,
  } = options;

  const navMock = {
    userAgent,
    geolocation: geolocation ? {
      getCurrentPosition: geolocation,
    } : undefined,
  };
  // Node 22+ has a read-only navigator getter, so use defineProperty
  try {
    Object.defineProperty(globalThis, 'navigator', { value: navMock, writable: true, configurable: true });
  } catch {
    globalThis.navigator = navMock;
  }
  const windowMock = {
    screen: { width: screenWidth, height: screenHeight },
    AudioContext: class {},
    webkitAudioContext: undefined,
  };
  if (isTouch) {
    windowMock.ontouchstart = true;
  }
  try {
    Object.defineProperty(globalThis, 'window', { value: windowMock, writable: true, configurable: true });
  } catch {
    globalThis.window = windowMock;
  }
  const storageMock = {
    _data: {},
    getItem(key) { return this._data[key] || null; },
    setItem(key, val) { this._data[key] = val; },
    removeItem(key) { delete this._data[key]; },
  };
  try {
    Object.defineProperty(globalThis, 'localStorage', { value: storageMock, writable: true, configurable: true });
  } catch {
    globalThis.localStorage = storageMock;
  }
  if (vesselMode) {
    globalThis.localStorage.setItem('tensor-midi-vessel-mode', 'true');
  }
  if (isTouch) {
    globalThis.ontouchstart = true;
  }
  // performance.now stub
  if (!globalThis.performance) {
    globalThis.performance = { now: () => Date.now() };
  }
}

function teardownBrowserMock() {
  // Restore — use defineProperty since Node 22 navigator has a getter
  try {
    if (originalGlobal.navigator !== undefined) {
      Object.defineProperty(globalThis, 'navigator', { value: originalGlobal.navigator, writable: true, configurable: true });
    } else {
      delete globalThis.navigator;
    }
  } catch { /* best effort */ }
  try {
    if (originalGlobal.window !== undefined) {
      Object.defineProperty(globalThis, 'window', { value: originalGlobal.window, writable: true, configurable: true });
    } else {
      delete globalThis.window;
    }
  } catch { /* best effort */ }
  try {
    if (originalGlobal.localStorage !== undefined) {
      Object.defineProperty(globalThis, 'localStorage', { value: originalGlobal.localStorage, writable: true, configurable: true });
    } else {
      delete globalThis.localStorage;
    }
  } catch { /* best effort */ }
  delete globalThis.ontouchstart;
}

// ─── getTimeOfDay ──────────────────────────────────────────────────────────

describe('getTimeOfDay', () => {
  // We can test this by importing dynamically after setting up mocks
  let getTimeOfDay, TimeOfDay;

  beforeEach(async () => {
    setupBrowserMock();
    const mod = await import('../src/device-context.js');
    getTimeOfDay = mod.getTimeOfDay;
    TimeOfDay = mod.TimeOfDay;
  });

  afterEach(() => teardownBrowserMock());

  test('5:00 AM is Dawn', () => {
    assert.equal(getTimeOfDay(new Date('2026-01-01T05:30:00')), TimeOfDay.Dawn);
  });

  test('7:59 AM is Dawn', () => {
    assert.equal(getTimeOfDay(new Date('2026-01-01T07:59:00')), TimeOfDay.Dawn);
  });

  test('8:00 AM is Morning', () => {
    assert.equal(getTimeOfDay(new Date('2026-01-01T08:00:00')), TimeOfDay.Morning);
  });

  test('11:59 AM is Morning', () => {
    assert.equal(getTimeOfDay(new Date('2026-01-01T11:59:00')), TimeOfDay.Morning);
  });

  test('12:00 PM is Noon', () => {
    assert.equal(getTimeOfDay(new Date('2026-01-01T12:00:00')), TimeOfDay.Noon);
  });

  test('1:59 PM is Noon', () => {
    assert.equal(getTimeOfDay(new Date('2026-01-01T13:59:00')), TimeOfDay.Noon);
  });

  test('2:00 PM is Afternoon', () => {
    assert.equal(getTimeOfDay(new Date('2026-01-01T14:00:00')), TimeOfDay.Afternoon);
  });

  test('5:59 PM is Afternoon', () => {
    assert.equal(getTimeOfDay(new Date('2026-01-01T17:59:00')), TimeOfDay.Afternoon);
  });

  test('6:00 PM is Evening', () => {
    assert.equal(getTimeOfDay(new Date('2026-01-01T18:00:00')), TimeOfDay.Evening);
  });

  test('8:59 PM is Evening', () => {
    assert.equal(getTimeOfDay(new Date('2026-01-01T20:59:00')), TimeOfDay.Evening);
  });

  test('9:00 PM is Night', () => {
    assert.equal(getTimeOfDay(new Date('2026-01-01T21:00:00')), TimeOfDay.Night);
  });

  test('11:59 PM is Night', () => {
    assert.equal(getTimeOfDay(new Date('2026-01-01T23:59:00')), TimeOfDay.Night);
  });

  test('12:00 AM (midnight) is LateNight', () => {
    assert.equal(getTimeOfDay(new Date('2026-01-01T00:00:00')), TimeOfDay.LateNight);
  });

  test('4:59 AM is LateNight', () => {
    assert.equal(getTimeOfDay(new Date('2026-01-01T04:59:00')), TimeOfDay.LateNight);
  });

  test('defaults to now when no argument', () => {
    const result = getTimeOfDay();
    const expected = getTimeOfDay(new Date());
    assert.equal(result, expected);
  });
});

// ─── DeviceType constants ──────────────────────────────────────────────────

describe('DeviceType constants', () => {
  test('all device types are defined', async () => {
    setupBrowserMock();
    const { DeviceType } = await import('../src/device-context.js');
    assert.ok(DeviceType.Phone);
    assert.ok(DeviceType.Tablet);
    assert.ok(DeviceType.Laptop);
    assert.ok(DeviceType.Desktop);
    assert.ok(DeviceType.Vessel);
    assert.ok(DeviceType.Unknown);
    teardownBrowserMock();
  });

  test('device types are string values', async () => {
    setupBrowserMock();
    const { DeviceType } = await import('../src/device-context.js');
    assert.equal(typeof DeviceType.Phone, 'string');
    assert.equal(typeof DeviceType.Laptop, 'string');
    teardownBrowserMock();
  });
});

// ─── TimeOfDay constants ───────────────────────────────────────────────────

describe('TimeOfDay constants', () => {
  test('all time periods are defined', async () => {
    setupBrowserMock();
    const { TimeOfDay } = await import('../src/device-context.js');
    assert.ok(TimeOfDay.Dawn);
    assert.ok(TimeOfDay.Morning);
    assert.ok(TimeOfDay.Noon);
    assert.ok(TimeOfDay.Afternoon);
    assert.ok(TimeOfDay.Evening);
    assert.ok(TimeOfDay.Night);
    assert.ok(TimeOfDay.LateNight);
    teardownBrowserMock();
  });

  test('seven time periods exist', async () => {
    setupBrowserMock();
    const { TimeOfDay } = await import('../src/device-context.js');
    const values = Object.values(TimeOfDay);
    assert.equal(values.length, 7);
    teardownBrowserMock();
  });

  test('all values are unique', async () => {
    setupBrowserMock();
    const { TimeOfDay } = await import('../src/device-context.js');
    const values = Object.values(TimeOfDay);
    const unique = new Set(values);
    assert.equal(values.length, unique.size);
    teardownBrowserMock();
  });
});

// ─── detectDevice ──────────────────────────────────────────────────────────

describe('detectDevice', () => {
  let detectDevice, DeviceType;

  afterEach(() => teardownBrowserMock());

  test('detects desktop on large screen', async () => {
    setupBrowserMock({ screenWidth: 1920, screenHeight: 1080 });
    const mod = await import('../src/device-context.js');
    detectDevice = mod.detectDevice;
    DeviceType = mod.DeviceType;
    assert.equal(detectDevice(), DeviceType.Desktop);
  });

  test('detects laptop on medium screen', async () => {
    setupBrowserMock({ screenWidth: 1366, screenHeight: 768 });
    const mod = await import('../src/device-context.js');
    detectDevice = mod.detectDevice;
    DeviceType = mod.DeviceType;
    // width 1366 is NOT < 1366, so it's Desktop
    assert.equal(detectDevice(), DeviceType.Desktop);
  });

  test('detects laptop on screen just below threshold', async () => {
    setupBrowserMock({ screenWidth: 1365, screenHeight: 768 });
    const mod = await import('../src/device-context.js');
    detectDevice = mod.detectDevice;
    DeviceType = mod.DeviceType;
    assert.equal(detectDevice(), DeviceType.Laptop);
  });

  test('detects phone from mobile user agent', async () => {
    setupBrowserMock({
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X)',
      screenWidth: 375, screenHeight: 812,
    });
    const mod = await import('../src/device-context.js');
    detectDevice = mod.detectDevice;
    DeviceType = mod.DeviceType;
    assert.equal(detectDevice(), DeviceType.Phone);
  });

  test('detects phone from android user agent', async () => {
    setupBrowserMock({
      userAgent: 'Mozilla/5.0 (Linux; Android 12; Pixel 6)',
      screenWidth: 412, screenHeight: 915,
    });
    const mod = await import('../src/device-context.js');
    detectDevice = mod.detectDevice;
    DeviceType = mod.DeviceType;
    assert.equal(detectDevice(), DeviceType.Phone);
  });

  test('detects tablet from iPad user agent', async () => {
    setupBrowserMock({
      userAgent: 'Mozilla/5.0 (iPad; CPU OS 15_0 like Mac OS X)',
      screenWidth: 820, screenHeight: 1180,
    });
    const mod = await import('../src/device-context.js');
    detectDevice = mod.detectDevice;
    DeviceType = mod.DeviceType;
    assert.equal(detectDevice(), DeviceType.Tablet);
  });

  test('detects vessel mode from localStorage', async () => {
    setupBrowserMock({ vesselMode: true });
    const mod = await import('../src/device-context.js');
    detectDevice = mod.detectDevice;
    DeviceType = mod.DeviceType;
    assert.equal(detectDevice(), DeviceType.Vessel);
  });

  test('vessel mode takes priority over mobile UA', async () => {
    setupBrowserMock({
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0)',
      screenWidth: 375,
      vesselMode: true,
    });
    const mod = await import('../src/device-context.js');
    detectDevice = mod.detectDevice;
    DeviceType = mod.DeviceType;
    assert.equal(detectDevice(), DeviceType.Vessel);
  });

  test('touch device with small screen is phone', async () => {
    setupBrowserMock({
      isTouch: true,
      screenWidth: 600,
      screenHeight: 800,
    });
    const mod = await import('../src/device-context.js');
    detectDevice = mod.detectDevice;
    DeviceType = mod.DeviceType;
    assert.equal(detectDevice(), DeviceType.Phone);
  });

  test('touch device with medium screen is tablet', async () => {
    setupBrowserMock({
      isTouch: true,
      screenWidth: 900,
      screenHeight: 1200,
    });
    const mod = await import('../src/device-context.js');
    detectDevice = mod.detectDevice;
    DeviceType = mod.DeviceType;
    assert.equal(detectDevice(), DeviceType.Tablet);
  });
});

// ─── DeviceProfile ─────────────────────────────────────────────────────────

describe('DeviceProfile', () => {
  let DeviceProfile, DeviceType, TimeOfDay;

  afterEach(() => teardownBrowserMock());

  test('creates profile with all properties', async () => {
    setupBrowserMock({ screenWidth: 1920 });
    const mod = await import('../src/device-context.js');
    DeviceProfile = mod.DeviceProfile;
    const profile = new DeviceProfile();
    assert.ok(profile.device);
    assert.ok(profile.time);
    assert.ok(profile.theme);
    assert.ok(profile.maxChannels !== undefined);
    assert.ok(profile.defaultBpm !== undefined);
    assert.ok(profile.layout);
    assert.ok(profile.features);
    assert.ok(Array.isArray(profile.features));
  });

  test('phone gets 4 max channels', async () => {
    setupBrowserMock({
      userAgent: 'Mozilla/5.0 (iPhone)',
      screenWidth: 375,
    });
    const mod = await import('../src/device-context.js');
    DeviceProfile = mod.DeviceProfile;
    const profile = new DeviceProfile();
    assert.equal(profile.maxChannels, 4);
  });

  test('desktop gets 16 max channels', async () => {
    setupBrowserMock({ screenWidth: 1920 });
    const mod = await import('../src/device-context.js');
    DeviceProfile = mod.DeviceProfile;
    const profile = new DeviceProfile();
    assert.equal(profile.maxChannels, 16);
  });

  test('tablet gets 8 max channels', async () => {
    setupBrowserMock({
      userAgent: 'Mozilla/5.0 (iPad)',
      screenWidth: 820,
    });
    const mod = await import('../src/device-context.js');
    DeviceProfile = mod.DeviceProfile;
    const profile = new DeviceProfile();
    assert.equal(profile.maxChannels, 8);
  });

  test('vessel gets 6 max channels', async () => {
    setupBrowserMock({ vesselMode: true });
    const mod = await import('../src/device-context.js');
    DeviceProfile = mod.DeviceProfile;
    const profile = new DeviceProfile();
    assert.equal(profile.maxChannels, 6);
  });

  test('phone layout is compact', async () => {
    setupBrowserMock({
      userAgent: 'Mozilla/5.0 (iPhone)',
      screenWidth: 375,
    });
    const mod = await import('../src/device-context.js');
    DeviceProfile = mod.DeviceProfile;
    const profile = new DeviceProfile();
    assert.equal(profile.layout, 'compact');
  });

  test('desktop layout is full', async () => {
    setupBrowserMock({ screenWidth: 1920 });
    const mod = await import('../src/device-context.js');
    DeviceProfile = mod.DeviceProfile;
    const profile = new DeviceProfile();
    assert.equal(profile.layout, 'full');
  });

  test('vessel layout is chart', async () => {
    setupBrowserMock({ vesselMode: true });
    const mod = await import('../src/device-context.js');
    DeviceProfile = mod.DeviceProfile;
    const profile = new DeviceProfile();
    assert.equal(profile.layout, 'chart');
  });

  test('phone has minimal features', async () => {
    setupBrowserMock({
      userAgent: 'Mozilla/5.0 (iPhone)',
      screenWidth: 375,
    });
    const mod = await import('../src/device-context.js');
    DeviceProfile = mod.DeviceProfile;
    const profile = new DeviceProfile();
    assert.ok(profile.features.includes('minimal'));
    assert.ok(profile.features.includes('mixer'));
    assert.ok(profile.features.includes('transport'));
    assert.ok(profile.features.includes('pulse-grid'));
  });

  test('desktop has all features', async () => {
    setupBrowserMock({ screenWidth: 1920 });
    const mod = await import('../src/device-context.js');
    DeviceProfile = mod.DeviceProfile;
    const profile = new DeviceProfile();
    assert.ok(profile.features.includes('chart'));
    assert.ok(profile.features.includes('analyzer'));
    assert.ok(profile.features.includes('piano-roll'));
    assert.ok(profile.features.includes('effects'));
    assert.ok(profile.features.includes('automation'));
    assert.ok(profile.features.includes('snapshot'));
  });

  test('vessel has gps feature', async () => {
    setupBrowserMock({ vesselMode: true });
    const mod = await import('../src/device-context.js');
    DeviceProfile = mod.DeviceProfile;
    const profile = new DeviceProfile();
    assert.ok(profile.features.includes('gps'));
    assert.ok(profile.features.includes('chart'));
  });

  test('night time has slower BPM', async () => {
    setupBrowserMock({ screenWidth: 1920 });
    const mod = await import('../src/device-context.js');
    DeviceProfile = mod.DeviceProfile;
    // Mock the time to be night
    const origGetTimeOfDay = mod.getTimeOfDay;
    const nightDate = new Date('2026-01-01T22:00:00');
    const profile = new DeviceProfile();
    // Manually set time
    profile.time = mod.TimeOfDay.Night;
    profile.defaultBpm = profile._getDefaultBpm();
    assert.equal(profile.defaultBpm, 80);
  });

  test('noon has fastest BPM', async () => {
    setupBrowserMock({ screenWidth: 1920 });
    const mod = await import('../src/device-context.js');
    DeviceProfile = mod.DeviceProfile;
    const profile = new DeviceProfile();
    profile.time = mod.TimeOfDay.Noon;
    profile.defaultBpm = profile._getDefaultBpm();
    assert.equal(profile.defaultBpm, 140);
  });

  test('late night has slowest BPM', async () => {
    setupBrowserMock({ screenWidth: 1920 });
    const mod = await import('../src/device-context.js');
    DeviceProfile = mod.DeviceProfile;
    const profile = new DeviceProfile();
    profile.time = mod.TimeOfDay.LateNight;
    profile.defaultBpm = profile._getDefaultBpm();
    assert.equal(profile.defaultBpm, 60);
  });

  test('getCSSVariables returns expected keys', async () => {
    setupBrowserMock({ screenWidth: 1920 });
    const mod = await import('../src/device-context.js');
    DeviceProfile = mod.DeviceProfile;
    const profile = new DeviceProfile();
    const css = profile.getCSSVariables();
    assert.ok('--bg' in css);
    assert.ok('--fg' in css);
    assert.ok('--accent' in css);
    assert.ok('--channel-width' in css);
    assert.ok('--grid-cols' in css);
    assert.ok('--font-scale' in css);
  });

  test('phone CSS has smaller channel width', async () => {
    setupBrowserMock({
      userAgent: 'Mozilla/5.0 (iPhone)',
      screenWidth: 375,
    });
    const mod = await import('../src/device-context.js');
    DeviceProfile = mod.DeviceProfile;
    const profile = new DeviceProfile();
    const css = profile.getCSSVariables();
    assert.equal(css['--channel-width'], '60px');
    assert.equal(css['--font-scale'], '0.8');
  });

  test('desktop CSS has standard channel width', async () => {
    setupBrowserMock({ screenWidth: 1920 });
    const mod = await import('../src/device-context.js');
    DeviceProfile = mod.DeviceProfile;
    const profile = new DeviceProfile();
    const css = profile.getCSSVariables();
    assert.equal(css['--channel-width'], '120px');
    assert.equal(css['--font-scale'], '1');
  });

  test('description contains device and time info', async () => {
    setupBrowserMock({ screenWidth: 1920 });
    const mod = await import('../src/device-context.js');
    DeviceProfile = mod.DeviceProfile;
    const profile = new DeviceProfile();
    const desc = profile.description;
    assert.ok(typeof desc === 'string');
    assert.ok(desc.includes('desktop'));
    assert.ok(desc.includes('BPM'));
  });

  test('refresh updates time and theme', async () => {
    setupBrowserMock({ screenWidth: 1920 });
    const mod = await import('../src/device-context.js');
    DeviceProfile = mod.DeviceProfile;
    const profile = new DeviceProfile();
    const originalTime = profile.time;
    const originalTheme = profile.theme;

    profile.refresh();

    // Time and theme should be re-evaluated
    assert.ok(profile.time);
    assert.ok(profile.theme);
  });

  test('theme names are unique across time periods', async () => {
    setupBrowserMock({ screenWidth: 1920 });
    const mod = await import('../src/device-context.js');
    DeviceProfile = mod.DeviceProfile;
    const profile = new DeviceProfile();

    const themeNames = new Set();
    for (const timeKey of Object.keys(mod.TimeOfDay)) {
      profile.time = mod.TimeOfDay[timeKey];
      const theme = profile._getTheme();
      themeNames.add(theme.name);
    }
    // All 7 time periods should have unique theme names
    assert.equal(themeNames.size, 7);
  });

  test('all themes have bg, fg, accent, name', async () => {
    setupBrowserMock({ screenWidth: 1920 });
    const mod = await import('../src/device-context.js');
    DeviceProfile = mod.DeviceProfile;
    const profile = new DeviceProfile();

    for (const timeKey of Object.keys(mod.TimeOfDay)) {
      profile.time = mod.TimeOfDay[timeKey];
      const theme = profile._getTheme();
      assert.ok(theme.bg, `${timeKey} theme missing bg`);
      assert.ok(theme.fg, `${timeKey} theme missing fg`);
      assert.ok(theme.accent, `${timeKey} theme missing accent`);
      assert.ok(theme.name, `${timeKey} theme missing name`);
    }
  });
});

// ─── getLocation ───────────────────────────────────────────────────────────

describe('getLocation', () => {
  let getLocation;

  afterEach(() => teardownBrowserMock());

  test('returns unavailable when geolocation not supported', async () => {
    setupBrowserMock(); // no geolocation
    const mod = await import('../src/device-context.js');
    getLocation = mod.getLocation;
    const result = await getLocation();
    assert.equal(result.lat, null);
    assert.equal(result.lon, null);
    assert.equal(result.source, 'unavailable');
  });

  test('returns GPS coordinates on success', async () => {
    const mockGetPos = (success, error) => {
      success({
        coords: {
          latitude: 61.2181,
          longitude: -149.9003,
          accuracy: 10,
        }
      });
    };
    setupBrowserMock({ geolocation: mockGetPos });
    const mod = await import('../src/device-context.js');
    getLocation = mod.getLocation;
    const result = await getLocation();
    assert.equal(result.lat, 61.2181);
    assert.equal(result.lon, -149.9003);
    assert.equal(result.accuracy, 10);
    assert.equal(result.source, 'gps');
  });

  test('returns denied on geolocation error', async () => {
    const mockGetPos = (success, error) => {
      error(new Error('Permission denied'));
    };
    setupBrowserMock({ geolocation: mockGetPos });
    const mod = await import('../src/device-context.js');
    getLocation = mod.getLocation;
    const result = await getLocation();
    assert.equal(result.lat, null);
    assert.equal(result.lon, null);
    assert.equal(result.source, 'denied');
  });
});
