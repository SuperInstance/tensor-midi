//! # tensor-midi
//!
//! Tensor-based MIDI timing for musical agent dialogue cadence.
//!
//! The core idea: agent speech timing follows musical rules (tempo, swing,
//! syncopation) instead of fixed intervals. A "tensor" maps each agent to a
//! rhythmic profile, and the tensor product of all profiles determines the
//! global conversation rhythm.

pub mod agent_cadence;
pub mod clock;
pub mod nudge;
pub mod swing;
pub mod syncopation;
pub mod tempo;
pub mod tensor_map;

pub use agent_cadence::{AgentCadence, CadenceProfile};
pub use clock::{Fermata, TensorClock};
pub use nudge::{Nudge, NudgeKind, NudgeStrength};
pub use swing::SwingTiming;
pub use syncopation::Syncopation;
pub use tempo::Tempo;
pub use tensor_map::{TensorMap, TimeSlot};
