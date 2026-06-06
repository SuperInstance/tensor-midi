//! Real-time nudges — agents hear others and adjust timing in response.

use serde::{Deserialize, Serialize};

/// Kind of conversational nudge.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum NudgeKind {
    /// Excitement: speed up, more energy → shorter intervals.
    Excitement,
    /// Pushback: slow down, disagreement → longer intervals.
    Pushback,
    /// Question: pause for response → insert a gap.
    Question,
}

/// Nudge strength level.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct NudgeStrength(pub f64);

impl NudgeStrength {
    pub fn new(s: f64) -> Self {
        Self(s.clamp(0.0, 1.0))
    }
    pub fn value(&self) -> f64 {
        self.0
    }
}

/// A timing nudge: adjusts an agent's next turn timing.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Nudge {
    /// Kind of nudge.
    pub kind: NudgeKind,
    /// Strength 0.0–1.0.
    pub strength: NudgeStrength,
    /// Source agent (who emitted the nudge).
    pub source: String,
    /// Target agent (who receives the nudge), or None for broadcast.
    pub target: Option<String>,
}

impl Nudge {
    /// Create a new nudge.
    pub fn new(kind: NudgeKind, strength: f64, source: &str, target: Option<&str>) -> Self {
        Self {
            kind,
            strength: NudgeStrength::new(strength),
            source: source.to_string(),
            target: target.map(|s| s.to_string()),
        }
    }

    /// Compute the timing adjustment (in seconds) this nudge applies
    /// to a given beat interval.
    ///
    /// - Excitement: reduces interval (negative offset)
    /// - Pushback: increases interval (positive offset)
    /// - Question: inserts a full beat pause
    pub fn timing_adjustment(&self, beat_interval: f64) -> f64 {
        let s = self.strength.value();
        match self.kind {
            NudgeKind::Excitement => -beat_interval * s * 0.3,
            NudgeKind::Pushback => beat_interval * s * 0.3,
            NudgeKind::Question => beat_interval * s,
        }
    }

    /// Whether this nudge targets a specific agent.
    pub fn targets(&self, agent_name: &str) -> bool {
        self.target
            .as_ref()
            .map_or(true, |t| t == agent_name)
    }
}

/// Accumulates multiple nudges and produces a net timing adjustment.
#[derive(Debug, Clone, Default)]
pub struct NudgeAccumulator {
    nudges: Vec<Nudge>,
}

impl NudgeAccumulator {
    pub fn new() -> Self {
        Self::default()
    }

    /// Add a nudge.
    pub fn push(&mut self, nudge: Nudge) {
        self.nudges.push(nudge);
    }

    /// Compute the net timing adjustment for a given agent and beat interval.
    pub fn net_adjustment(&self, agent_name: &str, beat_interval: f64) -> f64 {
        self.nudges
            .iter()
            .filter(|n| n.targets(agent_name))
            .map(|n| n.timing_adjustment(beat_interval))
            .sum()
    }

    /// Clear all nudges (typically called after applying).
    pub fn clear(&mut self) {
        self.nudges.clear();
    }

    /// Number of pending nudges.
    pub fn len(&self) -> usize {
        self.nudges.len()
    }

    pub fn is_empty(&self) -> bool {
        self.nudges.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn excitement_speeds_up() {
        let n = Nudge::new(NudgeKind::Excitement, 0.5, "alice", None);
        let adj = n.timing_adjustment(1.0);
        assert!(adj < 0.0); // negative = faster
    }

    #[test]
    fn pushback_slows_down() {
        let n = Nudge::new(NudgeKind::Pushback, 0.5, "alice", None);
        let adj = n.timing_adjustment(1.0);
        assert!(adj > 0.0); // positive = slower
    }

    #[test]
    fn question_adds_pause() {
        let n = Nudge::new(NudgeKind::Question, 1.0, "alice", None);
        let adj = n.timing_adjustment(1.0);
        assert!((adj - 1.0).abs() < 1e-9);
    }

    #[test]
    fn strength_scales_adjustment() {
        let weak = Nudge::new(NudgeKind::Excitement, 0.2, "a", None);
        let strong = Nudge::new(NudgeKind::Excitement, 0.8, "a", None);
        let w_adj = weak.timing_adjustment(1.0);
        let s_adj = strong.timing_adjustment(1.0);
        assert!(w_adj.abs() < s_adj.abs());
    }

    #[test]
    fn broadcast_targets_everyone() {
        let n = Nudge::new(NudgeKind::Excitement, 0.5, "alice", None);
        assert!(n.targets("bob"));
        assert!(n.targets("carol"));
    }

    #[test]
    fn targeted_nudge_only_targets_specific() {
        let n = Nudge::new(NudgeKind::Excitement, 0.5, "alice", Some("bob"));
        assert!(n.targets("bob"));
        assert!(!n.targets("carol"));
    }

    #[test]
    fn accumulator_sums_nudges() {
        let mut acc = NudgeAccumulator::new();
        acc.push(Nudge::new(NudgeKind::Excitement, 0.5, "a", Some("x")));
        acc.push(Nudge::new(NudgeKind::Pushback, 0.5, "b", Some("x")));
        let net = acc.net_adjustment("x", 1.0);
        // Excitement: -0.15, Pushback: +0.15 → net ~0
        assert!(net.abs() < 0.01);
    }
}
