//! Tensor MIDI clock — global clock distributing beats to all agents.
//! Handles tempo changes, pauses, and fermatas.

use serde::{Deserialize, Serialize};
use crate::Tempo;

/// A fermata: a held pause for dramatic effect.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Fermata {
    /// Beat index at which the fermata occurs.
    pub beat: u32,
    /// Duration of the hold in seconds (added to the beat).
    pub hold_seconds: f64,
}

/// The global tensor MIDI clock.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TensorClock {
    /// The tempo engine.
    pub tempo: Tempo,
    /// Current beat index (monotonically increasing).
    current_beat: u32,
    /// Elapsed time in seconds since clock start.
    elapsed: f64,
    /// Whether the clock is paused.
    paused: bool,
    /// Scheduled fermatas.
    fermatas: Vec<Fermata>,
    /// Number of beats per bar (default 4).
    beats_per_bar: u32,
}

impl TensorClock {
    /// Create a new clock with the given tempo.
    pub fn new(tempo: Tempo) -> Self {
        Self {
            tempo,
            current_beat: 0,
            elapsed: 0.0,
            paused: false,
            fermatas: Vec::new(),
            beats_per_bar: 4,
        }
    }

    /// Current beat index.
    pub fn current_beat(&self) -> u32 {
        self.current_beat
    }

    /// Current elapsed time.
    pub fn elapsed(&self) -> f64 {
        self.elapsed
    }

    /// Whether the clock is paused.
    pub fn is_paused(&self) -> bool {
        self.paused
    }

    /// Current bar number (1-indexed).
    pub fn current_bar(&self) -> u32 {
        self.current_beat / self.beats_per_bar + 1
    }

    /// Position within the current bar (0-indexed).
    pub fn beat_in_bar(&self) -> u32 {
        self.current_beat % self.beats_per_bar
    }

    /// Pause the clock.
    pub fn pause(&mut self) {
        self.paused = true;
    }

    /// Resume from pause.
    pub fn resume(&mut self) {
        self.paused = false;
    }

    /// Advance by one beat, returning the absolute time of that beat.
    ///
    /// Incorporates any fermata that may be scheduled on this beat.
    pub fn tick(&mut self) -> f64 {
        if self.paused {
            return self.elapsed;
        }

        let interval = self.tempo.beat_interval();

        // Check for fermata on current beat
        let fermata_hold: f64 = self
           .fermatas
            .iter()
            .filter(|f| f.beat == self.current_beat)
            .map(|f| f.hold_seconds)
            .sum();

        self.elapsed += interval + fermata_hold;
        let beat_time = self.elapsed;
        self.current_beat += 1;
        beat_time
    }

    /// Generate a schedule of `n` future beat times from the current state.
    ///
    /// Does not mutate the clock — purely predictive.
    pub fn preview_schedule(&self, n: usize) -> Vec<(u32, f64)> {
        let mut schedule = Vec::with_capacity(n);
        let mut time = self.elapsed;
        let interval = self.tempo.beat_interval();

        for i in 0..n {
            let beat_idx = self.current_beat + i as u32;
            let fermata_hold: f64 = self
                .fermatas
                .iter()
                .filter(|f| f.beat == beat_idx)
                .map(|f| f.hold_seconds)
                .sum();
            time += interval + fermata_hold;
            schedule.push((beat_idx, time));
        }

        schedule
    }

    /// Add a fermata at a specific beat.
    pub fn add_fermata(&mut self, fermata: Fermata) {
        self.fermatas.push(fermata);
    }

    /// Schedule a dramatic pause at the next bar line.
    pub fn add_dramatic_pause(&mut self, hold_seconds: f64) {
        let next_bar_beat = ((self.current_beat / self.beats_per_bar) + 1) * self.beats_per_bar;
        self.fermatas.push(Fermata {
            beat: next_bar_beat,
            hold_seconds,
        });
    }

    /// Reset the clock to beat 0.
    pub fn reset(&mut self) {
        self.current_beat = 0;
        self.elapsed = 0.0;
        self.paused = false;
        self.fermatas.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn clock_120() -> TensorClock {
        TensorClock::new(Tempo::new(120.0, 60.0, 200.0))
    }

    #[test]
    fn tick_advances_beat() {
        let mut c = clock_120();
        assert_eq!(c.current_beat(), 0);
        c.tick();
        assert_eq!(c.current_beat(), 1);
    }

    #[test]
    fn tick_advances_time() {
        let mut c = clock_120();
        let t0 = c.tick(); // beat 0 → 0.5s
        assert!((t0 - 0.5).abs() < 1e-9);
    }

    #[test]
    fn multiple_ticks_accumulate() {
        let mut c = clock_120();
        c.tick();
        c.tick();
        c.tick();
        c.tick();
        assert_eq!(c.current_beat(), 4);
        assert!((c.elapsed() - 2.0).abs() < 1e-9);
    }

    #[test]
    fn fermata_adds_time() {
        let mut c = clock_120();
        c.add_fermata(Fermata { beat: 0, hold_seconds: 2.0 });
        let t = c.tick(); // 0.5 (beat) + 2.0 (fermata) = 2.5
        assert!((t - 2.5).abs() < 1e-9);
    }

    #[test]
    fn pause_prevents_advance() {
        let mut c = clock_120();
        c.pause();
        let t = c.tick();
        assert!((t - 0.0).abs() < 1e-9);
        assert_eq!(c.current_beat(), 0);
    }

    #[test]
    fn preview_does_not_mutate() {
        let c = clock_120();
        let schedule = c.preview_schedule(4);
        assert_eq!(schedule.len(), 4);
        assert_eq!(c.current_beat(), 0); // unchanged
    }

    #[test]
    fn bar_position_correct() {
        let mut c = clock_120();
        assert_eq!(c.beat_in_bar(), 0);
        c.tick(); // beat 0 consumed, now at beat 1
        assert_eq!(c.beat_in_bar(), 1);
        c.tick(); c.tick(); c.tick(); // beats 2,3,4
        assert_eq!(c.beat_in_bar(), 0); // new bar
        assert_eq!(c.current_bar(), 2);
    }

    #[test]
    fn reset_clears_state() {
        let mut c = clock_120();
        c.tick(); c.tick();
        c.reset();
        assert_eq!(c.current_beat(), 0);
        assert!((c.elapsed() - 0.0).abs() < 1e-9);
    }
}
