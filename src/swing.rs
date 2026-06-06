//! Swing timing — on-beat agents speak at exact beat boundaries,
//! off-beat agents speak with a configurable swing delay.

use serde::{Deserialize, Serialize};

/// Swing timing configuration.
///
/// A swing ratio of 0.5 means equal timing (straight feel).
/// Higher ratios (0.6–0.8) create the characteristic "laid-back" feel
/// where off-beat events are delayed relative to the grid.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SwingTiming {
    /// Swing ratio in [0.5, 0.8]. 0.5 = straight, 0.67 = triplet, 0.75 = heavy.
    ratio: f64,
    /// Whether this agent is on-beat (true) or off-beat (false).
    on_beat: bool,
}

impl SwingTiming {
    /// Create a new swing timing.
    pub fn new(ratio: f64, on_beat: bool) -> Self {
        Self {
            ratio: ratio.clamp(0.5, 0.8),
            on_beat,
        }
    }

    /// Straight (no swing) timing.
    pub fn straight() -> Self {
        Self::new(0.5, true)
    }

    /// Triplet swing feel.
    pub fn triplet() -> Self {
        Self::new(0.67, false)
    }

    /// Heavy swing feel.
    pub fn heavy() -> Self {
        Self::new(0.75, false)
    }

    /// The swing ratio.
    pub fn ratio(&self) -> f64 {
        self.ratio
    }

    /// Whether this is an on-beat agent.
    pub fn is_on_beat(&self) -> bool {
        self.on_beat
    }

    /// Given a beat interval (seconds), compute the actual timing offset
    /// for this agent's next turn within that beat.
    ///
    /// On-beat agents get 0.0 offset (speak at beat boundary).
    /// Off-beat agents get a delayed offset based on the swing ratio.
    pub fn timing_offset(&self, beat_interval: f64) -> f64 {
        if self.on_beat {
            0.0
        } else {
            beat_interval * self.ratio
        }
    }

    /// Compute the effective subdivision: how long the "short" and "long"
    /// portions of a swung beat are.
    ///
    /// Returns `(short, long)` in seconds.
    pub fn subdivisions(&self, beat_interval: f64) -> (f64, f64) {
        let short = beat_interval * (1.0 - self.ratio);
        let long = beat_interval * self.ratio;
        (short, long)
    }

    /// Given a sequence of beat start times, apply swing to produce
    /// the actual hit times for this agent.
    pub fn apply_swing(&self, beat_times: &[f64]) -> Vec<f64> {
        beat_times
            .iter()
            .enumerate()
            .map(|(i, &t)| {
                if self.on_beat {
                    t
                } else {
                    // Off-beat: place between this beat and next
                    let interval = if i + 1 < beat_times.len() {
                        beat_times[i + 1] - t
                    } else {
                        // Assume same interval as previous beat gap
                        if i > 0 {
                            t - beat_times[i - 1]
                        } else {
                            0.5 // fallback: 120 BPM
                        }
                    };
                    t + interval * self.ratio
                }
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn on_beat_zero_offset() {
        let s = SwingTiming::new(0.7, true);
        assert!((s.timing_offset(0.5) - 0.0).abs() < 1e-9);
    }

    #[test]
    fn off_beat_swing_offset() {
        let s = SwingTiming::new(0.67, false);
        let offset = s.timing_offset(0.5);
        assert!((offset - 0.335).abs() < 1e-9);
    }

    #[test]
    fn ratio_clamped() {
        let s = SwingTiming::new(0.99, false);
        assert!((s.ratio() - 0.8).abs() < 1e-9);
        let s2 = SwingTiming::new(0.1, false);
        assert!((s2.ratio() - 0.5).abs() < 1e-9);
    }

    #[test]
    fn subdivisions_correct() {
        let s = SwingTiming::new(0.67, false);
        let (short, long) = s.subdivisions(0.5);
        assert!((short - 0.165).abs() < 1e-9);
        assert!((long - 0.335).abs() < 1e-9);
    }

    #[test]
    fn apply_swing_produces_offsets() {
        let s = SwingTiming::new(0.67, false);
        let beats = vec![0.0, 0.5, 1.0, 1.5];
        let swung = s.apply_swing(&beats);
        assert!(swung[0] > beats[0]); // off-beat is delayed
        assert!(swung[1] > beats[1]);
    }

    #[test]
    fn straight_no_swing() {
        let s = SwingTiming::straight();
        let offset = s.timing_offset(0.5);
        assert!((offset - 0.0).abs() < 1e-9);
    }
}
