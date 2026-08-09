// ═══════════════════════════════════════════════════════════════════
// Device Context — Organic Adaptation Engine
// ═══════════════════════════════════════════════════════════════════
//
// Casey's vision: the system grows organically to the time, place, user, device.
// This module reads the context and adapts the UI behavior:
//
// On a phone → simplified mixer (fewer channels, touch controls)
// On a laptop → full DAW interface
// On the vessel → chart overlay with real GPS
// At night → darker theme, slower tempo
// During high activity → faster tempo, more channels visible

export const DeviceType = {
  Phone: 'phone',
  Tablet: 'tablet',
  Laptop: 'laptop',
  Desktop: 'desktop',
  Vessel: 'vessel',
  Unknown: 'unknown',
};

export const TimeOfDay = {
  Dawn: 'dawn',       // 5:00-8:00
  Morning: 'morning', // 8:00-12:00
  Noon: 'noon',       // 12:00-14:00
  Afternoon: 'after', // 14:00-18:00
  Evening: 'evening', // 18:00-21:00
  Night: 'night',     // 21:00-24:00
  LateNight: 'late',  // 0:00-5:00
};

export function getTimeOfDay(date = new Date()) {
  const h = date.getHours();
  if (h >= 5 && h < 8) return TimeOfDay.Dawn;
  if (h >= 8 && h < 12) return TimeOfDay.Morning;
  if (h >= 12 && h < 14) return TimeOfDay.Noon;
  if (h >= 14 && h < 18) return TimeOfDay.Afternoon;
  if (h >= 18 && h < 21) return TimeOfDay.Evening;
  if (h >= 21) return TimeOfDay.Night;
  return TimeOfDay.LateNight;
}

/// Detect device type from user agent and screen
export function detectDevice() {
  const ua = navigator.userAgent.toLowerCase();
  const width = window.screen.width;
  const height = window.screen.height;
  const isTouch = 'ontouchstart' in window;
  
  // Check for GPS/vessel context
  const onVessel = localStorage.getItem('tensor-midi-vessel-mode') === 'true';
  if (onVessel) return DeviceType.Vessel;
  
  if (/mobile|android|iphone/.test(ua) || (isTouch && width < 768)) {
    return DeviceType.Phone;
  }
  if (/ipad|tablet/.test(ua) || (isTouch && width < 1024)) {
    return DeviceType.Tablet;
  }
  if (width < 1366) {
    return DeviceType.Laptop;
  }
  return DeviceType.Desktop;
}

/// Get location info
export async function getLocation() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve({ lat: null, lon: null, source: 'unavailable' });
      return;
    }
    
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
        source: 'gps',
      }),
      () => resolve({ lat: null, lon: null, source: 'denied' }),
      { timeout: 5000, enableHighAccuracy: true }
    );
  });
}

/// Device profile — adapts the UI based on context
export class DeviceProfile {
  constructor() {
    this.device = detectDevice();
    this.time = getTimeOfDay();
    this.location = null;
    this.theme = this._getTheme();
    this.maxChannels = this._getMaxChannels();
    this.defaultBpm = this._getDefaultBpm();
    this.layout = this._getLayout();
    this.features = this._getFeatures();
  }
  
  _getTheme() {
    switch (this.time) {
      case TimeOfDay.Dawn: return { bg: '#1a1a2e', fg: '#e0d0c0', accent: '#f0a060', name: 'dawn' };
      case TimeOfDay.Morning: return { bg: '#2a2a3e', fg: '#c0d0e0', accent: '#60a0f0', name: 'morning' };
      case TimeOfDay.Noon: return { bg: '#2e2e3a', fg: '#e0e0e0', accent: '#f0f060', name: 'noon' };
      case TimeOfDay.Afternoon: return { bg: '#2a2a3a', fg: '#d0e0d0', accent: '#60f0a0', name: 'afternoon' };
      case TimeOfDay.Evening: return { bg: '#1e1e2e', fg: '#c0b0d0', accent: '#a060f0', name: 'evening' };
      case TimeOfDay.Night: return { bg: '#0e0e1e', fg: '#a0a0c0', accent: '#6060f0', name: 'night' };
      case TimeOfDay.LateNight: return { bg: '#08081e', fg: '#8080a0', accent: '#4040c0', name: 'late' };
      default: return { bg: '#1a1a2e', fg: '#c0c0d0', accent: '#6080f0', name: 'default' };
    }
  }
  
  _getMaxChannels() {
    switch (this.device) {
      case DeviceType.Phone: return 4;    // Simplified
      case DeviceType.Tablet: return 8;
      case DeviceType.Laptop: return 12;
      case DeviceType.Desktop: return 16;  // Full DAW
      case DeviceType.Vessel: return 6;    // Focused on navigation
      default: return 8;
    }
  }
  
  _getDefaultBpm() {
    // Slower at night, faster during day
    switch (this.time) {
      case TimeOfDay.Dawn: return 90;
      case TimeOfDay.Morning: return 120;
      case TimeOfDay.Noon: return 140;
      case TimeOfDay.Afternoon: return 130;
      case TimeOfDay.Evening: return 110;
      case TimeOfDay.Night: return 80;
      case TimeOfDay.LateNight: return 60;
      default: return 120;
    }
  }
  
  _getLayout() {
    switch (this.device) {
      case DeviceType.Phone: return 'compact';    // Vertical strips
      case DeviceType.Tablet: return 'hybrid';    // Mix of strips and grid
      case DeviceType.Laptop: return 'full';      // Full grid
      case DeviceType.Desktop: return 'full';     // Full grid + extras
      case DeviceType.Vessel: return 'chart';     // Chart-dominant
      default: return 'full';
    }
  }
  
  _getFeatures() {
    const base = ['mixer', 'transport', 'pulse-grid'];
    
    switch (this.device) {
      case DeviceType.Phone:
        return [...base, 'minimal']; // Just the essentials
      case DeviceType.Tablet:
        return [...base, 'chart', 'analyzer'];
      case DeviceType.Laptop:
        return [...base, 'chart', 'analyzer', 'piano-roll', 'effects'];
      case DeviceType.Desktop:
        return [...base, 'chart', 'analyzer', 'piano-roll', 'effects', 'automation', 'snapshot'];
      case DeviceType.Vessel:
        return ['chart', 'mixer', 'pulse-grid', 'gps']; // Chart-focused
      default:
        return base;
    }
  }
  
  /// Get CSS variables for the theme
  getCSSVariables() {
    return {
      '--bg': this.theme.bg,
      '--fg': this.theme.fg,
      '--accent': this.theme.accent,
      '--channel-width': this.device === DeviceType.Phone ? '60px' : '120px',
      '--grid-cols': this.maxChannels,
      '--font-scale': this.device === DeviceType.Phone ? '0.8' : '1',
    };
  }
  
  /// Update location context
  async updateLocation() {
    this.location = await getLocation();
    // If we have GPS coords and are on water, switch to vessel mode
    if (this.location.lat !== null) {
      // Could check if on water via API
    }
    return this.location;
  }
  
  /// Refresh time-based settings
  refresh() {
    this.time = getTimeOfDay();
    this.theme = this._getTheme();
    this.defaultBpm = this._getDefaultBpm();
  }
  
  /// Get a description of the current context
  get description() {
    const deviceDesc = {
      [DeviceType.Phone]: 'phone',
      [DeviceType.Tablet]: 'tablet',
      [DeviceType.Laptop]: 'laptop',
      [DeviceType.Desktop]: 'desktop',
      [DeviceType.Vessel]: 'vessel chart plotter',
      [DeviceType.Unknown]: 'device',
    };
    
    return `${deviceDesc[this.device]} · ${this.time} · ${this.theme.name} theme · ${this.defaultBpm} BPM`;
  }
}
