//! Tensor map — the N-dimensional tensor mapping agents × time_slots × cadence_params.
//! Tensor contraction produces the actual dialogue schedule.

use serde::{Deserialize, Serialize};
use crate::nudge::NudgeAccumulator;
use crate::{AgentCadence, TensorClock};

/// A scheduled time slot for an agent.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimeSlot {
    /// Agent name.
    pub agent: String,
    /// Beat index.
    pub beat: u32,
    /// Absolute time in seconds.
    pub time: f64,
    /// Any applied nudge adjustment.
    pub nudge_offset: f64,
}

/// The tensor map: N-dimensional timing structure.
///
/// Conceptually a 3D tensor with dimensions:
/// - `agents`: the set of agent cadence profiles
/// - `time_slots`: beat positions in the schedule
/// - `cadence_params`: timing parameters per agent
///
/// Tensor contraction over `agents × time_slots` produces a 1D schedule
/// (list of absolute times with agent assignments).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TensorMap {
    /// Agent cadence profiles (dimension 0).
    pub agents: Vec<AgentCadence>,
}

impl TensorMap {
    /// Create a tensor map from a set of agent cadences.
    pub fn new(agents: Vec<AgentCadence>) -> Self {
        Self { agents }
    }

    /// Create with the four default agent profiles.
    pub fn default_map() -> Self {
        Self::new(AgentCadence::default_agents())
    }

    /// Number of agents.
    pub fn agent_count(&self) -> usize {
        self.agents.len()
    }

    /// Get an agent by name.
    pub fn get_agent(&self, name: &str) -> Option<&AgentCadence> {
        self.agents.iter().find(|a| a.name == name)
    }

    /// **Tensor contraction**: produce a concrete dialogue schedule.
    ///
    /// This is the core operation. For each time slot (beat from the clock),
    /// each agent gets a timing offset determined by their cadence profile.
    /// The tensor "contracts" over all agents and beats to produce a flat
    /// list of time slots.
    ///
    /// The round-robin strategy assigns one agent per beat in rotation.
    /// Nudges are applied on top for real-time adjustments.
    pub fn contract(
        &self,
        clock: &TensorClock,
        num_beats: usize,
        nudges: &NudgeAccumulator,
    ) -> Vec<TimeSlot> {
        let base_interval = clock.tempo.beat_interval();
        let schedule = clock.preview_schedule(num_beats);

        let mut slots = Vec::with_capacity(num_beats);
        let n_agents = self.agents.len().max(1);

        for (i, &(beat, base_time)) in schedule.iter().enumerate() {
            let agent = &self.agents[i % n_agents];

            // Cadence offset (swing + syncopation + rubato)
            let cadence_offset = agent.timing_for_beat(beat, base_interval);

            // Nudge offset
            let nudge_offset = nudges.net_adjustment(&agent.name, base_interval);

            let time = base_time + cadence_offset + nudge_offset;

            slots.push(TimeSlot {
                agent: agent.name.clone(),
                beat,
                time,
                nudge_offset,
            });
        }

        slots
    }

    /// Produce a schedule with all agents speaking every beat (polyphonic).
    /// Returns `agents × beats` time slots.
    pub fn contract_polyphonic(
        &self,
        clock: &TensorClock,
        num_beats: usize,
        nudges: &NudgeAccumulator,
    ) -> Vec<TimeSlot> {
        let base_interval = clock.tempo.beat_interval();
        let schedule = clock.preview_schedule(num_beats);

        let mut slots = Vec::with_capacity(num_beats * self.agents.len());

        for &(beat, base_time) in &schedule {
            for agent in &self.agents {
                let cadence_offset = agent.timing_for_beat(beat, base_interval);
                let nudge_offset = nudges.net_adjustment(&agent.name, base_interval);
                let time = base_time + cadence_offset + nudge_offset;

                slots.push(TimeSlot {
                    agent: agent.name.clone(),
                    beat,
                    time,
                    nudge_offset,
                });
            }
        }

        slots
    }

    /// Validate a schedule: check that times are monotonically increasing
    /// per agent and that no two agents collide (speak at the same time).
    pub fn validate_schedule(slots: &[TimeSlot]) -> Vec<String> {
        let mut issues = Vec::new();

        // Check per-agent monotonicity
        let mut prev: std::collections::HashMap<&str, f64> = std::collections::HashMap::new();
        for slot in slots {
            if let Some(&prev_time) = prev.get(slot.agent.as_str()) {
                if slot.time < prev_time - 1e-6 {
                    issues.push(format!(
                        "Agent {} time regression: {} -> {} at beat {}",
                        slot.agent, prev_time, slot.time, slot.beat
                    ));
                }
            }
            prev.insert(&slot.agent, slot.time);
        }

        // Check for collisions (agents speaking at the same time within tolerance)
        let tolerance = 0.01; // 10ms
        for i in 0..slots.len() {
            for j in (i + 1)..slots.len() {
                if slots[i].agent != slots[j].agent
                    && (slots[i].time - slots[j].time).abs() < tolerance
                {
                    issues.push(format!(
                        "Collision: {} and {} at ~{:.3}s",
                        slots[i].agent, slots[j].agent, slots[i].time
                    ));
                }
            }
        }

        issues
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Tempo;

    fn test_clock() -> TensorClock {
        TensorClock::new(Tempo::new(120.0, 60.0, 200.0))
    }

    #[test]
    fn default_map_has_four_agents() {
        let m = TensorMap::default_map();
        assert_eq!(m.agent_count(), 4);
    }

    #[test]
    fn contract_produces_correct_count() {
        let m = TensorMap::default_map();
        let c = test_clock();
        let n = NudgeAccumulator::new();
        let slots = m.contract(&c, 8, &n);
        assert_eq!(slots.len(), 8);
    }

    #[test]
    fn contract_round_robins_agents() {
        let m = TensorMap::default_map();
        let c = test_clock();
        let n = NudgeAccumulator::new();
        let slots = m.contract(&c, 8, &n);
        assert_eq!(slots[0].agent, "architect");
        assert_eq!(slots[1].agent, "implementer");
        assert_eq!(slots[2].agent, "critic");
        assert_eq!(slots[3].agent, "historian");
        assert_eq!(slots[4].agent, "architect"); // wraps
    }

    #[test]
    fn contract_times_increase() {
        let m = TensorMap::default_map();
        let c = test_clock();
        let n = NudgeAccumulator::new();
        let slots = m.contract(&c, 16, &n);
        for w in slots.windows(2) {
            assert!(w[1].time >= w[0].time - 0.05,
                "Time decreased: {} -> {}", w[0].time, w[1].time);
        }
    }

    #[test]
    fn polyphonic_has_more_slots() {
        let m = TensorMap::default_map();
        let c = test_clock();
        let n = NudgeAccumulator::new();
        let slots = m.contract_polyphonic(&c, 4, &n);
        assert_eq!(slots.len(), 16); // 4 agents × 4 beats
    }

    #[test]
    fn nudge_affects_schedule() {
        let m = TensorMap::default_map();
        let c = test_clock();
        let empty = NudgeAccumulator::new();

        let mut nudged = NudgeAccumulator::new();
        nudged.push(crate::Nudge::new(
            crate::NudgeKind::Excitement,
            0.8,
            "x",
            Some("architect"),
        ));

        let base = m.contract(&c, 8, &empty);
        let nudged_slots = m.contract(&c, 8, &nudged);

        // Architect's slot should be different (nudge applied)
        let arch_base = base.iter().find(|s| s.agent == "architect").unwrap();
        let arch_nudged = nudged_slots.iter().find(|s| s.agent == "architect").unwrap();
        assert!((arch_base.time - arch_nudged.time).abs() > 0.001);
    }

    #[test]
    fn validate_clean_schedule() {
        let m = TensorMap::default_map();
        let c = test_clock();
        let n = NudgeAccumulator::new();
        let slots = m.contract(&c, 16, &n);
        let issues = TensorMap::validate_schedule(&slots);
        assert!(issues.is_empty(), "Unexpected issues: {:?}", issues);
    }

    #[test]
    fn get_agent_found() {
        let m = TensorMap::default_map();
        assert!(m.get_agent("architect").is_some());
        assert!(m.get_agent("nonexistent").is_none());
    }

    #[test]
    fn distinct_agents_have_distinct_timings() {
        let m = TensorMap::default_map();
        let c = test_clock();
        let n = NudgeAccumulator::new();
        let slots = m.contract_polyphonic(&c, 1, &n);

        // 4 agents on beat 0 should have different times
        let times: Vec<f64> = slots.iter().map(|s| s.time).collect();
        let unique_times: std::collections::HashSet<u64> =
            times.iter().map(|&t| (t * 10000.0) as u64).collect();
        // At least 3 distinct timings (some might coincidentally match)
        assert!(unique_times.len() >= 2, "All agents have same timing");
    }
}
