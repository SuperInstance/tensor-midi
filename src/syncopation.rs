//! Syncopation detection and injection — agents "interrupt" slightly before
//! their beat for emphasis.

use serde::{Deserialize, Serialize};

/// Syncopation configuration for an agent.
///
/// Syncopation means an agent speaks *slightly before* their assigned beat,
/// creating tension and emphasis. Strength controls how early (0 = on-beat,
/// 1 = maximally early).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Syncopation {
    /// Syncopation strength in [0.0, 1.0].
    /// 0.0 = always on-beat, 1.0 = very early.
    strength: f64,
    /// Probability of syncopation occurring on any given beat (0.0–1.0).
    probability: f64,
    /// Internal state for deterministic syncopation pattern.
    /// Used as a simple seed for reproducibility.
    pattern_period: u32,
}

impl Syncopation {
    /// Create new syncopation with given strength and probability.
    pub fn new(strength: f64, probability: f64) -> Self {
        Self {
            strength: strength.clamp(0.0, 1.0),
            probability: probability.clamp(0.0, 1.0),
            pattern_period: 4, // default: every 4th beat
        }
    }

    /// No syncopation (always on-beat).
    pub fn none() -> Self {
        Self::new(0.0, 0.0)
    }

    /// Light syncopation — occasional pre-beat emphasis.
    pub fn light() -> Self {
        Self::new(0.3, 0.25)
    }

    /// Heavy syncopation — frequent early attacks.
    pub fn heavy() -> Self {
        Self::new(0.6, 0.5)
    }

    pub fn strength(&self) -> f64 {
        self.strength
    }

    pub fn probability(&self) -> f64 {
        self.probability
    }

    /// Set the pattern period — syncopation triggers every N beats.
    pub fn set_pattern_period(&mut self, period: u32) {
        self.pattern_period = period.max(1);
    }

    /// Compute syncopation offset for a given beat index.
    ///
    /// Returns a *negative* offset (in seconds) that should be subtracted
    /// from the beat time, or 0.0 if syncopation doesn't trigger.
    ///
    /// Uses deterministic pattern: syncopation triggers when
    /// `beat_index % pattern_period == 0` and passes probability check.
    pub fn offset_for_beat(&self, beat_index: u32, beat_interval: f64) -> f64 {
        // Deterministic trigger based on pattern period
        let triggers = beat_index % self.pattern_period == 0;
        if !triggers {
            return 0.0;
        }

        // Simple probability check using beat_index as seed
        let hash = ((beat_index.wrapping_mul(2654435761)) % 1000) as f64 / 1000.0;
        if hash > self.probability {
            return 0.0;
        }

        // Offset: fraction of beat interval, negative (early)
        -(beat_interval * self.strength * 0.25)
    }

    /// Apply syncopation to a full schedule of beat times.
    pub fn apply_to_schedule(&self, beat_times: &[(u32, f64)]) -> Vec<(u32, f64)> {
        if self.strength == 0.0 {
            return beat_times.to_vec();
        }

        let interval = if beat_times.len() >= 2 {
            beat_times[1].1 - beat_times[0].1
        } else {
            0.5
        };

        beat_times
            .iter()
            .map(|&(idx, t)| {
                let offset = self.offset_for_beat(idx, interval);
                (idx, t + offset)
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn none_syncopation_no_offset() {
        let s = Syncopation::none();
        assert!((s.offset_for_beat(0, 0.5) - 0.0).abs() < 1e-9);
    }

    #[test]
    fn syncopation_offset_is_negative() {
        let mut s = Syncopation::new(0.5, 1.0);
        s.set_pattern_period(1);
        // With period=1 and probability=1.0, beat 0 should syncopate
        let offset = s.offset_for_beat(0, 0.5);
        assert!(offset <= 0.0);
    }

    #[test]
    fn syncopation_strength_scales() {
        let s1 = Syncopation::new(0.2, 1.0);
        let s2 = Syncopation::new(0.8, 1.0);
        let o1 = s1.offset_for_beat(0, 0.5);
        let o2 = s2.offset_for_beat(0, 0.5);
        // Higher strength → more negative (earlier)
        assert!(o1 >= o2);
    }

    #[test]
    fn pattern_period_respected() {
        let mut s = Syncopation::new(0.5, 1.0);
        s.set_pattern_period(4);
        let o0 = s.offset_for_beat(0, 0.5);
        let o1 = s.offset_for_beat(1, 0.5);
        let o2 = s.offset_for_beat(2, 0.5);
        let o3 = s.offset_for_beat(3, 0.5);
        let o4 = s.offset_for_beat(4, 0.5);
        // Only beats 0, 4, 8... can trigger (pattern_period=4)
        assert!(o0 <= 0.0); // beat 0: triggers (0 % 4 == 0)
        assert!((o1 - 0.0).abs() < 1e-9); // beat 1: doesn't trigger
        assert!((o2 - 0.0).abs() < 1e-9);
        assert!((o3 - 0.0).abs() < 1e-9);
        assert!(o4 <= 0.0); // beat 4: triggers
    }

    #[test]
    fn apply_to_schedule_preserves_count() {
        let s = Syncopation::heavy();
        let schedule: Vec<(u32, f64)> = vec![(0, 0.0), (1, 0.5), (2, 1.0), (3, 1.5)];
        let result = s.apply_to_schedule(&schedule);
        assert_eq!(result.len(), 4);
    }

    #[test]
    fn light_less_than_heavy() {
        let light = Syncopation::light();
        let heavy = Syncopation::heavy();
        assert!(light.strength() < heavy.strength());
    }
}
