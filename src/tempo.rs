//! Adaptive BPM tempo — starts at a base BPM and adjusts based on
//! conversation energy derived from text sentiment analysis.

use serde::{Deserialize, Serialize};

/// The tempo engine. Converts BPM ↔ beat interval and adapts to energy.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tempo {
    /// Current BPM (beats per minute).
    bpm: f64,
    /// Minimum allowed BPM.
    min_bpm: f64,
    /// Maximum allowed BPM.
    max_bpm: f64,
    /// How strongly energy changes affect BPM (0.0–1.0).
    sensitivity: f64,
    /// Exponential moving average of energy for smoothing.
    energy_ema: f64,
}

impl Tempo {
    /// Create a new tempo at `base_bpm` with the given range.
    ///
    /// # Panics
    /// Panics if `base_bpm` is outside `[min_bpm, max_bpm]`.
    pub fn new(base_bpm: f64, min_bpm: f64, max_bpm: f64) -> Self {
        assert!(
            base_bpm >= min_bpm && base_bpm <= max_bpm,
            "base_bpm must be within [min_bpm, max_bpm]"
        );
        Self {
            bpm: base_bpm,
            min_bpm,
            max_bpm,
            sensitivity: 0.5,
            energy_ema: 0.5,
        }
    }

    /// Convenience: create with defaults (base 90, range 60–120).
    pub fn default_tempo() -> Self {
        Self::new(90.0, 60.0, 120.0)
    }

    /// Current BPM.
    pub fn bpm(&self) -> f64 {
        self.bpm
    }

    /// Set sensitivity (0.0 = no response, 1.0 = full response).
    pub fn set_sensitivity(&mut self, s: f64) {
        self.sensitivity = s.clamp(0.0, 1.0);
    }

    /// Duration of one beat in seconds.
    pub fn beat_interval(&self) -> f64 {
        60.0 / self.bpm
    }

    /// Duration of one bar (4/4 time) in seconds.
    pub fn bar_interval(&self) -> f64 {
        self.beat_interval() * 4.0
    }

    /// Update tempo based on a new energy reading (0.0 low → 1.0 high).
    ///
    /// Uses an exponential moving average to smooth out jitter, then maps
    /// the smoothed energy to a BPM within `[min_bpm, max_bpm]`.
    pub fn update_energy(&mut self, energy: f64) {
        let alpha = 0.3; // EMA smoothing factor
        self.energy_ema = alpha * energy + (1.0 - alpha) * self.energy_ema;

        // Map energy [0,1] → BPM [min, max] weighted by sensitivity
        let target_bpm = self.min_bpm + self.energy_ema * (self.max_bpm - self.min_bpm);
        self.bpm = self.bpm + self.sensitivity * (target_bpm - self.bpm);
        self.bpm = self.bpm.clamp(self.min_bpm, self.max_bpm);
    }

    /// Simple sentiment-based energy detector.
    ///
    /// Counts exclamation marks, question marks, ALL-CAPS words, and
    /// "intensifier" keywords to produce a rough energy estimate.
    pub fn detect_energy(text: &str) -> f64 {
        let mut score: f64 = 0.0;
        let chars = text.chars().count().max(1) as f64;

        // Punctuation intensity
        let excl = text.matches('!').count() as f64;
        let quest = text.matches('?').count() as f64;
        score += excl * 0.08 + quest * 0.04;

        // ALL-CAPS words
        let caps_words = text
            .split_whitespace()
            .filter(|w| w.len() > 1 && w.chars().all(|c| c.is_uppercase()))
            .count() as f64;
        score += caps_words * 0.06;

        // Intensifier keywords
        let intensifiers = [
            "amazing", "incredible", "urgent", "critical", "wow",
            "absolutely", "definitely", "immediately", "crucial",
            "terrible", "horrible", "disaster", "emergency",
        ];
        let lower = text.to_lowercase();
        for kw in &intensifiers {
            if lower.contains(kw) {
                score += 0.05;
            }
        }

        // Normalize by text length to avoid long texts always being "high energy"
        (score / (chars / 50.0).max(1.0)).clamp(0.0, 1.0)
    }

    /// Force-set the BPM directly (e.g., for manual override).
    pub fn set_bpm(&mut self, bpm: f64) {
        self.bpm = bpm.clamp(self.min_bpm, self.max_bpm);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_tempo_is_90() {
        let t = Tempo::default_tempo();
        assert!((t.bpm() - 90.0).abs() < 1e-9);
    }

    #[test]
    fn beat_interval_inverse() {
        let t = Tempo::new(120.0, 60.0, 200.0);
        assert!((t.beat_interval() - 0.5).abs() < 1e-9);
    }

    #[test]
    fn bar_interval_four_beats() {
        let t = Tempo::new(60.0, 60.0, 120.0);
        assert!((t.bar_interval() - 4.0).abs() < 1e-9);
    }

    #[test]
    fn energy_high_raises_bpm() {
        let mut t = Tempo::new(90.0, 60.0, 120.0);
        t.set_sensitivity(1.0);
        t.update_energy(1.0);
        assert!(t.bpm() > 90.0);
    }

    #[test]
    fn energy_low_lowers_bpm() {
        let mut t = Tempo::new(90.0, 60.0, 120.0);
        t.set_sensitivity(1.0);
        t.update_energy(0.0);
        assert!(t.bpm() < 90.0);
    }

    #[test]
    fn bpm_clamps_to_range() {
        let mut t = Tempo::new(90.0, 60.0, 120.0);
        t.set_bpm(999.0);
        assert!((t.bpm() - 120.0).abs() < 1e-9);
        t.set_bpm(0.0);
        assert!((t.bpm() - 60.0).abs() < 1e-9);
    }

    #[test]
    fn detect_energy_exclamation() {
        let e = Tempo::detect_energy("This is AMAZING!!!");
        assert!(e > 0.2);
    }

    #[test]
    fn detect_energy_calm() {
        let e = Tempo::detect_energy("hello there, how are you doing today");
        assert!(e < 0.2);
    }
}
