// ═══════════════════════════════════════════════════════════════════
// Tensor-MIDI Audio Engine — Procedural Sound Effects
// ═══════════════════════════════════════════════════════════════════
//
// Instead of pre-rendered audio files, the Producer generates sounds
// procedurally using the Web Audio API. This is more fitting for a
// jazz instrument — the sounds are generated in the moment, just like
// a live performance.
//
// All sounds are synthesized from oscillators and envelopes.
// The 12/8 time signature means 12 eighth-note pulses per bar.

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.enabled = false;
    this.bpm = 120;
  }
  
  init() {
    if (this.ctx) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.3;
    this.masterGain.connect(this.ctx.destination);
    this.enabled = true;
  }
  
  setBpm(bpm) {
    this.bpm = bpm;
  }
  
  setVolume(vol) {
    if (this.masterGain) {
      this.masterGain.gain.value = Math.max(0, Math.min(1, vol));
    }
  }
  
  /// Note ON — played when a message is captured
  noteOn(pitch, velocity = 100, channel = 0, friction = false) {
    if (!this.enabled || !this.ctx) return;
    
    const now = this.ctx.currentTime;
    const freq = this.midiToFreq(pitch);
    
    // Different waveforms per channel for timbral variety
    const waveforms = ['sine', 'triangle', 'sawtooth', 'square', 'sine', 'triangle'];
    const waveform = waveforms[channel % waveforms.length];
    
    // Main oscillator
    const osc = this.ctx.createOscillator();
    osc.type = waveform;
    osc.frequency.value = freq;
    
    // Harmonic (octave up, quieter)
    const osc2 = this.ctx.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.value = freq * 2;
    
    // Gain envelope (ADSR)
    const gain = this.ctx.createGain();
    const gain2 = this.ctx.createGain();
    const vel = velocity / 127;
    
    const attackTime = 0.01;
    const decayTime = friction ? 0.05 : 0.15;
    const sustainLevel = vel * 0.3;
    const releaseTime = friction ? 0.1 : 0.4;
    
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(vel * 0.6, now + attackTime);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.001, sustainLevel), now + attackTime + decayTime);
    gain.gain.exponentialRampToValueAtTime(0.001, now + attackTime + decayTime + releaseTime);
    
    gain2.gain.setValueAtTime(0, now);
    gain2.gain.linearRampToValueAtTime(vel * 0.2, now + attackTime);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + attackTime + decayTime + releaseTime);
    
    // Filter for warmth
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = friction ? 800 : 4000;
    filter.Q.value = 1;
    
    // Connect
    osc.connect(gain).connect(filter).connect(this.masterGain);
    osc2.connect(gain2).connect(filter);
    
    // Start and stop
    osc.start(now);
    osc2.start(now);
    const stopTime = now + attackTime + decayTime + releaseTime + 0.1;
    osc.stop(stopTime);
    osc2.stop(stopTime);
    
    // Add friction buzz
    if (friction) {
      this.playFrictionBuzz(now, freq);
    }
  }
  
  /// Note OFF — played when a message is acknowledged
  noteOff(pitch, channel = 0) {
    if (!this.enabled || !this.ctx) return;
    
    const now = this.ctx.currentTime;
    const freq = this.midiToFreq(pitch);
    
    // Soft release sound
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.5, now + 0.1);
    
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.1, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    
    osc.connect(gain).connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.2);
  }
  
  /// Channel mute — click sound
  channelMute() {
    this.playClick(200);
  }
  
  /// Channel unmute — double click
  channelUnmute() {
    this.playClick(400);
    setTimeout(() => this.playClick(500), 50);
  }
  
  /// Transport — play button
  transportPlay() {
    this.playClick(600);
  }
  
  /// Transport — stop button
  transportStop() {
    this.playClick(300);
    setTimeout(() => this.playClick(200), 60);
  }
  
  /// Transport — record button (urgent red sound)
  transportRecord() {
    if (!this.enabled || !this.ctx) return;
    const now = this.ctx.currentTime;
    
    const osc = this.ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = 880;
    
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.15, now + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    
    osc.connect(gain).connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.15);
  }
  
  /// Play a click sound
  playClick(freq = 500) {
    if (!this.enabled || !this.ctx) return;
    const now = this.ctx.currentTime;
    
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.1, now + 0.001);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.03);
    
    osc.connect(gain).connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.05);
  }
  
  /// Friction buzz — dissonant sound for errors
  playFrictionBuzz(time, baseFreq) {
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = baseFreq * 1.05; // Slightly detuned = dissonant
    
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(0.08, time + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.08);
    
    osc.connect(gain).connect(this.masterGain);
    osc.start(time);
    osc.stop(time + 0.1);
  }
  
  /// Ambient pad — continuous background texture
  playAmbientPad(rootFreq = 110) {
    if (!this.enabled || !this.ctx) return;
    
    const now = this.ctx.currentTime;
    
    // Stack of oscillators for rich pad
    const freqs = [rootFreq, rootFreq * 1.5, rootFreq * 2, rootFreq * 3];
    const gains = [0.04, 0.02, 0.03, 0.01];
    
    for (let i = 0; i < freqs.length; i++) {
      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freqs[i];
      
      // Slow LFO for subtle movement
      const lfo = this.ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = 0.1 + i * 0.07;
      const lfoGain = this.ctx.createGain();
      lfoGain.gain.value = 2 + i;
      lfo.connect(lfoGain).connect(osc.frequency);
      
      const gain = this.ctx.createGain();
      gain.gain.value = gains[i];
      
      // Filter
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 800 + i * 200;
      
      osc.connect(gain).connect(filter).connect(this.masterGain);
      
      osc.start(now);
      lfo.start(now);
    }
  }
  
  /// MIDI note number to frequency
  midiToFreq(note) {
    return 440 * Math.pow(2, (note - 69) / 12);
  }
  
  /// Suspend audio context
  suspend() {
    if (this.ctx) this.ctx.suspend();
  }
  
  /// Resume audio context
  resume() {
    if (this.ctx) this.ctx.resume();
  }
}

// Singleton instance
export const audio = new AudioEngine();
