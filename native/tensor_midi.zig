// tensor_midi.zig — Tensor-MIDI Polyformalism Engine (Zig)
//
// What Zig teaches: comptime forces you to prove array bounds at
// compile time. Error handling is explicit (no exceptions, no hidden
// control flow). You discover which sizes are truly knowable at
// compile time versus which must be runtime.
//
// In Zig, the ring buffer capacity is a comptime parameter — the
// caller must prove the size at the call site. Array bounds are
// checked by the compiler. Error unions force you to handle every
// failure path explicitly.
//
// Build: zig build
// Test:  zig build test

const std = @import("std");

// ── Constants ────────────────────────────────────────────────────────

pub const PPQ: u32 = 96;
pub const PULSES_PER_BAR: u32 = 12;
pub const TICKS_PER_PULSE: u32 = PPQ / 2; // 48
pub const TICKS_PER_BAR: u32 = PULSES_PER_BAR * TICKS_PER_PULSE; // 576
pub const PACKED_SIZE: usize = 8;

// ── Event Types ──────────────────────────────────────────────────────

pub const EventType = enum(u8) {
    note_on = 0,
    note_off = 1,
    control_change = 2,
    program_change = 3,
    meta = 4,

    pub fn toNibble(self: EventType) u8 {
        return @intFromEnum(self) & 0x0F;
    }

    pub fn fromNibble(nibble: u8) ?EventType {
        return switch (nibble & 0x0F) {
            0 => .note_on,
            1 => .note_off,
            2 => .control_change,
            3 => .program_change,
            4 => .meta,
            else => null,
        };
    }
};

// ── Friction Bitfield ────────────────────────────────────────────────

pub const Friction = struct {
    pub const NONE: u8 = 0x00;
    pub const TIMEOUT: u8 = 0x01;
    pub const CONFLICT: u8 = 0x02;
    pub const RATE_LIMIT: u8 = 0x04;
    pub const AMBIGUITY: u8 = 0x08;
    pub const IMPORT_ERROR: u8 = 0x10;
    pub const SYNTAX_ERROR: u8 = 0x20;
    pub const TYPE_MISMATCH: u8 = 0x40;
    pub const NETWORK_ERROR: u8 = 0x80;
};

// ── SWMIDI Event ─────────────────────────────────────────────────────

pub const SwmidiEvent = struct {
    event_type: EventType,
    channel: u8,
    pitch: u8,
    velocity: u8,
    error_mask: u8,
    tick: u32,

    pub fn init(
        event_type: EventType,
        channel: u8,
        pitch: u8,
        velocity: u8,
        error_mask: u8,
        tick: u32,
    ) SwmidiEvent {
        return .{
            .event_type = event_type,
            .channel = channel & 0x0F,
            .pitch = pitch & 0x7F,
            .velocity = velocity & 0x7F,
            .error_mask = error_mask,
            .tick = tick,
        };
    }

    pub fn encode(self: SwmidiEvent) [PACKED_SIZE]u8 {
        var buf: [PACKED_SIZE]u8 = undefined;
        buf[0] = (self.event_type.toNibble() << 4) | (self.channel & 0x0F);
        buf[1] = self.pitch & 0x7F;
        buf[2] = self.velocity & 0x7F;
        buf[3] = self.error_mask;
        // Little-endian tick
        buf[4] = @truncate(self.tick);
        buf[5] = @truncate(self.tick >> 8);
        buf[6] = @truncate(self.tick >> 16);
        buf[7] = @truncate(self.tick >> 24);
        return buf;
    }

    pub fn decode(buf: *const [PACKED_SIZE]u8) ?SwmidiEvent {
        const event_type = EventType.fromNibble(buf[0] >> 4) orelse return null;
        return SwmidiEvent{
            .event_type = event_type,
            .channel = buf[0] & 0x0F,
            .pitch = buf[1] & 0x7F,
            .velocity = buf[2] & 0x7F,
            .error_mask = buf[3],
            .tick = @as(u32, buf[4]) |
                (@as(u32, buf[5]) << 8) |
                (@as(u32, buf[6]) << 16) |
                (@as(u32, buf[7]) << 24),
        };
    }

    pub fn isFlow(self: SwmidiEvent) bool {
        return self.error_mask == 0;
    }

    pub fn hasFriction(self: SwmidiEvent) bool {
        return self.error_mask != 0;
    }
};

// ── Pulse Position ───────────────────────────────────────────────────

pub const PulsePosition = struct {
    bar: u32,
    pulse: u8, // 0-11
    sub_tick: u8, // 0-47
};

pub fn tickToPulse(tick: u32) PulsePosition {
    const bar = tick / TICKS_PER_BAR;
    const within = tick % TICKS_PER_BAR;
    return .{
        .bar = bar,
        .pulse = @intCast(within / TICKS_PER_PULSE),
        .sub_tick = @intCast(within % TICKS_PER_PULSE),
    };
}

pub fn pulseToTick(pos: PulsePosition) u32 {
    return pos.bar * TICKS_PER_BAR +
        @as(u32, pos.pulse) * TICKS_PER_PULSE +
        @as(u32, pos.sub_tick);
}

// ── Ring Buffer ──────────────────────────────────────────────────────
//
// What Zig teaches: the capacity is a comptime parameter. The compiler
// proves at the call site that the buffer size is known. The array is
// stack-allocated (or statically allocated) — no malloc.

pub fn RingBuffer(comptime capacity: usize) type {
    return struct {
        buffer: [capacity]SwmidiEvent = undefined,
        head: usize = 0,
        len: usize = 0,

        const Self = @This();

        pub fn init() Self {
            return .{};
        }

        pub fn push(self: *Self, event: SwmidiEvent) void {
            self.buffer[self.head] = event;
            self.head = (self.head + 1) % capacity;
            if (self.len < capacity) self.len += 1;
        }

        pub fn last(self: *const Self) ?*const SwmidiEvent {
            if (self.len == 0) return null;
            const idx = if (self.head == 0) capacity - 1 else self.head - 1;
            return &self.buffer[idx];
        }

        pub fn get(self: *const Self, logical_index: usize) ?*const SwmidiEvent {
            if (logical_index >= self.len) return null;
            const start: usize = if (self.len < capacity) 0 else self.head;
            const physical = (start + logical_index) % capacity;
            return &self.buffer[physical];
        }

        pub fn isEmpty(self: *const Self) bool {
            return self.len == 0;
        }

        pub fn isFull(self: *const Self) bool {
            return self.len == capacity;
        }
    };
}

// ── Sentiment Analysis ───────────────────────────────────────────────

pub const SentimentLabel = enum(u8) {
    bright = 0,
    creative = 1,
    inquiring = 2,
    neutral = 3,
    tense = 4,
    resolved = 5,
};

pub const Sentiment = struct {
    pitch: u8,
    friction: u8,
    velocity: u8,
    label: SentimentLabel,
    positivity: u8,
    negativity: u8,
    question: u8,
    creativity: u8,
};

// Static word tables — comptime verified, const
const positive_words = [_][]const u8{
    "great", "awesome", "love", "perfect", "excellent", "wonderful",
    "yes",   "good",    "amazing", "fantastic", "beautiful", "brilliant",
    "nice",  "cool",    "happy",  "glad",    "thanks",  "thank",
    "sweet", "win",     "success", "proud",
};

const negative_words = [_][]const u8{
    "bad",     "error",   "fail",  "broken", "hate",   "wrong",
    "no",      "terrible", "awful", "crash",  "bug",    "issue",
    "stuck",   "frustrated", "annoying", "slow", "dead", "lost",
    "miss",    "angry",   "sad",
};

const question_words = [_][]const u8{
    "what", "how", "why", "where", "when", "who", "which", "?",
};

const creative_words = [_][]const u8{
    "imagine", "create", "build", "design", "compose", "paint",
    "draw",    "write",  "dream", "invent", "explore", "craft",
    "forge",   "shape",  "mold",  "weave",  "spark",
};

fn ciContains(haystack: []const u8, needle: []const u8) bool {
    if (needle.len == 0) return true;
    if (haystack.len < needle.len) return false;

    var i: usize = 0;
    while (i <= haystack.len - needle.len) : (i += 1) {
        var match = true;
        var j: usize = 0;
        while (j < needle.len) : (j += 1) {
            var hc = haystack[i + j];
            var nc = needle[j];
            // lowercase
            if (hc >= 'A' and hc <= 'Z') hc += 32;
            if (nc >= 'A' and nc <= 'Z') nc += 32;
            if (hc != nc) {
                match = false;
                break;
            }
        }
        if (match) return true;
    }
    return false;
}

fn countMatches(text: []const u8, words: []const []const u8) u8 {
    var count: u8 = 0;
    for (words) |word| {
        if (ciContains(text, word)) {
            count += 1;
        }
    }
    return count;
}

pub fn analyzeSentiment(text: []const u8) Sentiment {
    const positivity = countMatches(text, &positive_words);
    const negativity = countMatches(text, &negative_words);
    const question = countMatches(text, &question_words);
    const creativity = countMatches(text, &creative_words);

    // Pitch mapping
    var pitch: i32 = 60;
    pitch += @as(i32, creativity) * 8;
    pitch += @as(i32, positivity) * 5;
    pitch -= @as(i32, negativity) * 10;
    if (question > 0) {
        pitch = 72 + @as(i32, question) * 3;
    }
    const clamped_pitch: u8 = @intCast(@max(0, @min(127, pitch)));

    // Friction
    var fr: u8 = Friction.NONE;
    if (negativity > 0) fr |= Friction.AMBIGUITY;
    if (ciContains(text, "error") or ciContains(text, "fail") or ciContains(text, "crash")) {
        fr |= Friction.SYNTAX_ERROR;
    }

    // Velocity from text length
    const text_len = @min(text.len, 500);
    const velocity: u8 = @intCast(@max(1, @min(127, @divTrunc(text_len * 127, 500))));

    // Label
    const label: SentimentLabel = if (negativity > positivity)
        .tense
    else if (creativity > 0)
        .creative
    else if (question > 0)
        .inquiring
    else if (positivity > 0)
        .bright
    else
        .neutral;

    return .{
        .pitch = clamped_pitch,
        .friction = fr,
        .velocity = velocity,
        .label = label,
        .positivity = positivity,
        .negativity = negativity,
        .question = question,
        .creativity = creativity,
    };
}

// ── Jazz Analysis ────────────────────────────────────────────────────

pub const JazzMode = enum {
    groove,
    building,
    tension,
    release,
    solo,
    comping,
    free,
    ballad,
};

pub const JazzAnalysis = struct {
    mode: JazzMode,
    tension: f32,
    energy: f32,
    complexity: f32,
    avg_pitch: f32,
    flow_ratio: f32,
    friction_ratio: f32,
    event_count: usize,
};

pub fn analyzeJazz(sentiments: []const Sentiment) JazzAnalysis {
    if (sentiments.len == 0) {
        return .{
            .mode = .ballad,
            .tension = 0,
            .energy = 0,
            .complexity = 0,
            .avg_pitch = 60,
            .flow_ratio = 1,
            .friction_ratio = 0,
            .event_count = 0,
        };
    }

    const n = sentiments.len;
    var tense_count: u32 = 0;
    var creative_count: u32 = 0;
    var friction_count: u32 = 0;
    var flow_count: u32 = 0;
    var total_pitch: u32 = 0;
    var total_velocity: u32 = 0;

    // Bitmap for unique pitches — comptime sized!
    var pitch_seen: [128]bool = [_]bool{false} ** 128;
    var unique_pitches: u32 = 0;

    for (sentiments) |s| {
        total_pitch += s.pitch;
        total_velocity += s.velocity;
        if (s.label == .tense) tense_count += 1;
        if (s.label == .creative) creative_count += 1;
        if (s.friction != 0) friction_count += 1 else flow_count += 1;

        if (s.pitch < 128 and !pitch_seen[s.pitch]) {
            pitch_seen[s.pitch] = true;
            unique_pitches += 1;
        }
    }

    const tension = @as(f32, @floatFromInt(tense_count)) / @as(f32, @floatFromInt(n));
    const energy = @as(f32, @floatFromInt(total_velocity)) /
        (@as(f32, @floatFromInt(n)) * 127.0);
    const complexity = (@as(f32, @floatFromInt(unique_pitches)) / 12.0) *
        @min(@as(f32, @floatFromInt(n)) / 20.0, 1.0);
    const flow_ratio = @as(f32, @floatFromInt(flow_count)) / @as(f32, @floatFromInt(n));
    const friction_ratio = @as(f32, @floatFromInt(friction_count)) / @as(f32, @floatFromInt(n));
    const avg_pitch = @as(f32, @floatFromInt(total_pitch)) / @as(f32, @floatFromInt(n));

    // Mode detection
    const mode: JazzMode = if (tension > 0.5)
        .tension
    else if (creative_count > 0 and energy > 0.5)
        .building
    else if (friction_ratio > 0.3)
        .free
    else if (tension > 0.2)
        .release
    else if (flow_ratio > 0.7 and n >= 5)
        .groove
    else if (n < 10 and energy < 0.4)
        .comping
    else if (flow_ratio > 0.8)
        .ballad
    else
        .groove;

    return .{
        .mode = mode,
        .tension = tension,
        .energy = energy,
        .complexity = complexity,
        .avg_pitch = avg_pitch,
        .flow_ratio = flow_ratio,
        .friction_ratio = friction_ratio,
        .event_count = n,
    };
}

// ── Tests ────────────────────────────────────────────────────────────

test "encode decode round trip" {
    const event = SwmidiEvent.init(.note_on, 3, 60, 100, 0, 192);
    const encoded = event.encode();
    const decoded = SwmidiEvent.decode(&encoded).?;
    try std.testing.expectEqual(event.event_type, decoded.event_type);
    try std.testing.expectEqual(event.channel, decoded.channel);
    try std.testing.expectEqual(event.pitch, decoded.pitch);
    try std.testing.expectEqual(event.velocity, decoded.velocity);
    try std.testing.expectEqual(event.error_mask, decoded.error_mask);
    try std.testing.expectEqual(event.tick, decoded.tick);
}

test "decode invalid event type" {
    var buf = [_]u8{ 0x50, 0, 0, 0, 0, 0, 0, 0 };
    try std.testing.expect(SwmidiEvent.decode(&buf) == null);
}

test "tick little endian" {
    const event = SwmidiEvent.init(.meta, 0, 0, 0, 0, 0x01020304);
    const encoded = event.encode();
    try std.testing.expectEqual(@as(u8, 0x04), encoded[4]);
    try std.testing.expectEqual(@as(u8, 0x03), encoded[5]);
    try std.testing.expectEqual(@as(u8, 0x02), encoded[6]);
    try std.testing.expectEqual(@as(u8, 0x01), encoded[7]);
}

test "ring buffer basic" {
    var rb = RingBuffer(16).init();
    try std.testing.expect(rb.isEmpty());

    rb.push(SwmidiEvent.init(.note_on, 0, 60, 100, 0, 0));
    rb.push(SwmidiEvent.init(.note_on, 0, 64, 100, 0, 48));
    try std.testing.expectEqual(@as(usize, 2), rb.len);
    try std.testing.expect(!rb.isEmpty());
    try std.testing.expectEqual(@as(u8, 64), rb.last().?.pitch);
}

test "ring buffer overflow" {
    var rb = RingBuffer(4).init();
    for (0..10) |i| {
        rb.push(SwmidiEvent.init(.note_on, 0, @intCast(i % 127), 100, 0, @intCast(i)));
    }
    try std.testing.expectEqual(@as(usize, 4), rb.len);
    try std.testing.expect(rb.isFull());
}

test "ring buffer get" {
    var rb = RingBuffer(16).init();
    rb.push(SwmidiEvent.init(.note_on, 0, 60, 100, 0, 0));
    rb.push(SwmidiEvent.init(.note_on, 0, 64, 100, 0, 48));
    try std.testing.expectEqual(@as(u8, 60), rb.get(0).?.pitch);
    try std.testing.expectEqual(@as(u8, 64), rb.get(1).?.pitch);
    try std.testing.expect(rb.get(2) == null);
}

test "sentiment positive" {
    const s = analyzeSentiment("This is great and wonderful!");
    try std.testing.expect(s.positivity >= 2);
    try std.testing.expectEqual(SentimentLabel.bright, s.label);
    try std.testing.expect(s.pitch > 60);
}

test "sentiment negative" {
    const s = analyzeSentiment("This is terrible and broken");
    try std.testing.expect(s.negativity >= 2);
    try std.testing.expectEqual(SentimentLabel.tense, s.label);
    try std.testing.expect(s.pitch < 60);
    try std.testing.expect(s.friction & Friction.AMBIGUITY != 0);
}

test "sentiment creative" {
    const s = analyzeSentiment("Let's build and design something");
    try std.testing.expect(s.creativity >= 2);
    try std.testing.expectEqual(SentimentLabel.creative, s.label);
}

test "sentiment question" {
    const s = analyzeSentiment("What is this? How does it work?");
    try std.testing.expect(s.question >= 2);
    try std.testing.expectEqual(SentimentLabel.inquiring, s.label);
    try std.testing.expect(s.pitch >= 72);
}

test "pulse position round trip" {
    const tick: u32 = 1234;
    const pos = tickToPulse(tick);
    try std.testing.expectEqual(tick, pulseToTick(pos));
}

test "pulse position bar boundaries" {
    const pos0 = tickToPulse(0);
    try std.testing.expectEqual(@as(u32, 0), pos0.bar);
    try std.testing.expectEqual(@as(u8, 0), pos0.pulse);

    const pos1 = tickToPulse(TICKS_PER_BAR);
    try std.testing.expectEqual(@as(u32, 1), pos1.bar);

    const pos6 = tickToPulse(6 * TICKS_PER_PULSE);
    try std.testing.expectEqual(@as(u8, 6), pos6.pulse);
}

test "jazz empty" {
    const ja = analyzeJazz(&[_]Sentiment{});
    try std.testing.expectEqual(JazzMode.ballad, ja.mode);
    try std.testing.expectEqual(@as(usize, 0), ja.event_count);
}

test "jazz positive" {
    var sentiments: [5]Sentiment = undefined;
    for (&sentiments) |*s| {
        s.* = analyzeSentiment("Great job on the build!");
    }
    const ja = analyzeJazz(&sentiments);
    try std.testing.expect(ja.tension < 0.3);
    try std.testing.expect(ja.flow_ratio > 0.5);
    try std.testing.expectEqual(JazzMode.groove, ja.mode);
}

test "jazz tense" {
    var sentiments: [5]Sentiment = undefined;
    for (&sentiments) |*s| {
        s.* = analyzeSentiment("Error: build failed badly");
    }
    const ja = analyzeJazz(&sentiments);
    try std.testing.expect(ja.tension > 0.5);
    try std.testing.expect(ja.friction_ratio > 0.3);
}

test "constants" {
    try std.testing.expectEqual(@as(u32, 96), PPQ);
    try std.testing.expectEqual(@as(u32, 12), PULSES_PER_BAR);
    try std.testing.expectEqual(@as(u32, 48), TICKS_PER_PULSE);
    try std.testing.expectEqual(@as(u32, 576), TICKS_PER_BAR);
}
