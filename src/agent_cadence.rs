//! Per-agent cadence profiles — each agent role has characteristic timing.

use serde::{Deserialize, Serialize};
use crate::{SwingTiming, Syncopation};

/// Named cadence profiles for agent archetypes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum CadenceProfile {
    /// Architect: technical, steady 4/4, no swing.
    Architect,
    /// Implementer: casual, swung timing, occasional syncopation.
    Implementer,
    /// Critic: analytical, holds beats longer, deliberate.
    Critic,
    /// Historian: poetic, rubato (flexible tempo), expressive timing.
    Historian,
    /// Custom profile with manual settings.
    Custom,
}

/// Per-agent cadence: combines swing, syncopation, and timing multipliers.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentCadence {
    /// Agent name/identifier.
    pub name: String,
    /// Cadence profile type.
    pub profile: CadenceProfile,
    /// Swing timing for this agent.
    pub swing: SwingTiming,
    /// Syncopation settings.
    pub syncopation: Syncopation,
    /// Tempo multiplier (1.0 = normal, >1.0 = faster, <1.0 = slower).
    pub tempo_multiplier: f64,
    /// Hold factor: how long to hold a beat (1.0 = normal, 2.0 = double).
    pub hold_factor: f64,
    /// Rubato flexibility: how much this agent deviates from strict time.
    /// 0.0 = metronomic, 1.0 = fully flexible.
    pub rubato: f64,
}

impl AgentCadence {
    /// Create a cadence from a named profile.
    pub fn from_profile(name: &str, profile: CadenceProfile) -> Self {
        match profile {
            CadenceProfile::Architect => Self {
                name: name.to_string(),
                profile,
                swing: SwingTiming::straight(),
                syncopation: Syncopation::none(),
                tempo_multiplier: 1.0,
                hold_factor: 1.0,
                rubato: 0.0,
            },
            CadenceProfile::Implementer => Self {
                name: name.to_string(),
                profile,
                swing: SwingTiming::triplet(),
                syncopation: Syncopation::light(),
                tempo_multiplier: 1.1,
                hold_factor: 0.9,
                rubato: 0.1,
            },
            CadenceProfile::Critic => Self {
                name: name.to_string(),
                profile,
                swing: SwingTiming::new(0.55, true),
                syncopation: Syncopation::none(),
                tempo_multiplier: 0.85,
                hold_factor: 1.5,
                rubato: 0.15,
            },
            CadenceProfile::Historian => Self {
                name: name.to_string(),
                profile,
                swing: SwingTiming::new(0.6, false),
                syncopation: Syncopation::new(0.2, 0.3),
                tempo_multiplier: 0.9,
                hold_factor: 1.3,
                rubato: 0.4,
            },
            CadenceProfile::Custom => Self {
                name: name.to_string(),
                profile,
                swing: SwingTiming::straight(),
                syncopation: Syncopation::none(),
                tempo_multiplier: 1.0,
                hold_factor: 1.0,
                rubato: 0.0,
            },
        }
    }

    /// Compute the effective beat interval for this agent given the base
    /// interval from the clock.
    pub fn effective_beat_interval(&self, base_interval: f64) -> f64 {
        base_interval * self.tempo_multiplier * self.hold_factor
    }

    /// Compute the full timing offset for a specific beat, incorporating
    /// swing + syncopation + rubato deviation.
    pub fn timing_for_beat(&self, beat_index: u32, base_interval: f64) -> f64 {
        let eff_interval = self.effective_beat_interval(base_interval);
        let swing_offset = self.swing.timing_offset(eff_interval);
        let sync_offset = self.syncopation.offset_for_beat(beat_index, eff_interval);

        // Rubato: sinusoidal deviation that varies per beat
        let rubato_offset = self.rubato
            * eff_interval
            * 0.1
            * ((beat_index as f64 * 0.7).sin());

        swing_offset + sync_offset + rubato_offset
    }

    /// All four default profiles.
    pub fn default_agents() -> Vec<Self> {
        vec![
            Self::from_profile("architect", CadenceProfile::Architect),
            Self::from_profile("implementer", CadenceProfile::Implementer),
            Self::from_profile("critic", CadenceProfile::Critic),
            Self::from_profile("historian", CadenceProfile::Historian),
        ]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn architect_no_swing() {
        let a = AgentCadence::from_profile("arch", CadenceProfile::Architect);
        assert!(a.swing.is_on_beat());
        assert!((a.tempo_multiplier - 1.0).abs() < 1e-9);
        assert!((a.rubato - 0.0).abs() < 1e-9);
    }

    #[test]
    fn implementer_swinging() {
        let a = AgentCadence::from_profile("impl", CadenceProfile::Implementer);
        assert!(!a.swing.is_on_beat());
        assert!(a.tempo_multiplier > 1.0);
    }

    #[test]
    fn critic_holds_beats() {
        let a = AgentCadence::from_profile("crit", CadenceProfile::Critic);
        assert!(a.hold_factor > 1.0);
        assert!(a.tempo_multiplier < 1.0);
    }

    #[test]
    fn historian_rubato() {
        let a = AgentCadence::from_profile("hist", CadenceProfile::Historian);
        assert!(a.rubato > 0.2);
    }

    #[test]
    fn effective_interval_varies_by_profile() {
        let base = 0.5;
        let arch = AgentCadence::from_profile("a", CadenceProfile::Architect);
        let crit = AgentCadence::from_profile("c", CadenceProfile::Critic);
        let impl_ = AgentCadence::from_profile("i", CadenceProfile::Implementer);
        let hist = AgentCadence::from_profile("h", CadenceProfile::Historian);

        let arch_iv = arch.effective_beat_interval(base);
        let crit_iv = crit.effective_beat_interval(base);
        let impl_iv = impl_.effective_beat_interval(base);
        let hist_iv = hist.effective_beat_interval(base);

        // Critic should have the longest interval (slow + hold)
        assert!(crit_iv > arch_iv);
        // Implementer should have shortest (fast + less hold)
        assert!(impl_iv < hist_iv);
    }

    #[test]
    fn four_default_agents() {
        let agents = AgentCadence::default_agents();
        assert_eq!(agents.len(), 4);
        assert_eq!(agents[0].profile, CadenceProfile::Architect);
        assert_eq!(agents[1].profile, CadenceProfile::Implementer);
        assert_eq!(agents[2].profile, CadenceProfile::Critic);
        assert_eq!(agents[3].profile, CadenceProfile::Historian);
    }
}
