const std = @import("std");

pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});

    // ── Module ──
    const tensor_midi_module = b.addModule("tensor_midi", .{
        .root_source_file = b.path("tensor_midi.zig"),
        .target = target,
        .optimize = optimize,
    });

    // ── Tests ──
    const tests = b.addTest(.{
        .root_module = tensor_midi_module,
    });

    const run_tests = b.addRunArtifact(tests);

    const test_step = b.step("test", "Run tensor_midi tests");
    test_step.dependOn(&run_tests.step);

    // ── build exe for testing ──
    const test_exe = b.addExecutable(.{
        .name = "tensor_midi_test",
        .root_module = tensor_midi_module,
    });

    b.installArtifact(test_exe);
}
