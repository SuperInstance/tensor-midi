//! Tutorial: tensor-midi — Tensor-based MIDI timing for agent dialogue
//!
//! Agent speech timing follows musical rules instead of fixed intervals.
//! Each agent gets a rhythmic profile; the tensor product of all profiles
//! determines the global conversation rhythm.

use tensor_midi::{
    AgentCadence, CadenceProfile, TensorClock, Fermata,
    Nudge, NudgeKind,
    SwingTiming,
};
use tensor_midi::nudge::NudgeAccumulator;

fn main() {
    println!("=== Tensor-MIDI Tutorial ===\n");

    // Part 1: Tempo and tensor clock
    println!("Part 1: Tensor clock");
    let mut clock = TensorClock::new(tensor_midi::Tempo::default_tempo());
    println!("  Base BPM: {}", clock.elapsed());
    
    // Tick through some beats
    for _ in 0..4 {
        let t = clock.tick();
        println!("  Beat {} at {:.3}s", clock.current_beat(), t);
    }
    println!();

    // Part 2: Agent cadence profiles
    println!("Part 2: Agent cadence profiles");
    let fast_agent = AgentCadence::from_profile("builder", CadenceProfile::Architect);
    let slow_agent = AgentCadence::from_profile("auditor", CadenceProfile::Critic);
    let normal_agent = AgentCadence::from_profile("coordinator", CadenceProfile::Implementer);
    
    let base_interval = 0.5; // 120 BPM
    println!("  {} effective interval: {:.3}s", "builder", fast_agent.effective_beat_interval(base_interval));
    println!("  {} effective interval: {:.3}s", "auditor", slow_agent.effective_beat_interval(base_interval));
    println!();

    // Part 3: Swing timing
    println!("Part 3: Swing timing");
    let straight = SwingTiming::straight();
    let triplet = SwingTiming::triplet();
    let heavy = SwingTiming::heavy();
    
    let beats = vec![0.0, 0.5, 1.0, 1.5, 2.0];
    println!("  Straight: {:?}", straight.apply_swing(&beats));
    println!("  Triplet:  {:?}", triplet.apply_swing(&beats));
    println!("  Heavy:    {:?}", heavy.apply_swing(&beats));
    println!();

    // Part 4: Nudges — agents influencing each other's timing
    println!("Part 4: Nudge timing adjustments");
    let nudge = Nudge::new(
        NudgeKind::Excitement,
        0.3,
        "builder",
        Some("auditor"),
    );
    println!("  Builder excites auditor by 0.3");
    println!("  Timing adjustment at 0.5s interval: {:.3}s", nudge.timing_adjustment(0.5));
    
    let mut acc = NudgeAccumulator::new();
    acc.push(Nudge::new(NudgeKind::Excitement, 0.2, "builder", Some("auditor")));
    acc.push(Nudge::new(NudgeKind::Pushback, 0.1, "coordinator", Some("auditor")));
    println!("  Net adjustment for auditor: {:.3}s", acc.net_adjustment("auditor", 0.5));
    println!();

    // Part 5: Fermata — dramatic pauses
    println!("Part 5: Fermata (dramatic pauses)");
    let mut clock2 = TensorClock::new(tensor_midi::Tempo::default_tempo());
    clock2.add_fermata(Fermata {
        beat: 4,
        hold_seconds: 2.0,
    });
    clock2.add_dramatic_pause(1.5);
    println!("  Added fermata at beat 4 (2s hold)");
    println!("  Added dramatic pause (1.5s)");
    
    let schedule = clock2.preview_schedule(8);
    println!("  Preview 8 beats: {} events", schedule.len());
    println!();

    // Part 6: Per-beat timing with cadence
    println!("Part 6: Per-beat agent timing");
    let agent = AgentCadence::from_profile("builder", CadenceProfile::Architect);
    for beat in 0..8u32 {
        let timing = agent.timing_for_beat(beat, base_interval);
        println!("    Beat {}: {:.3}s", beat, timing);
    }
}
