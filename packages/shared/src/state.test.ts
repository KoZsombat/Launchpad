import { describe, expect, it } from "vitest";
import { assertTransition, canTransition, isTerminalStatus } from "./state";

describe("deployment state machine", () => {
  it("allows the happy path", () => {
    expect(canTransition("queued", "building")).toBe(true);
    expect(canTransition("building", "starting")).toBe(true);
    expect(canTransition("starting", "healthy")).toBe(true);
  });

  it("allows failure from every in-flight state", () => {
    expect(canTransition("queued", "failed")).toBe(true);
    expect(canTransition("building", "failed")).toBe(true);
    expect(canTransition("starting", "failed")).toBe(true);
  });

  it("rejects skipped and reversed transitions", () => {
    expect(canTransition("queued", "healthy")).toBe(false);
    expect(canTransition("building", "queued")).toBe(false);
    expect(canTransition("healthy", "failed")).toBe(false);
    expect(canTransition("failed", "building")).toBe(false);
  });

  it("throws on an invalid transition", () => {
    expect(() => assertTransition("queued", "starting")).toThrow(
      "Invalid deployment transition: queued -> starting",
    );
  });

  it("marks healthy and failed as terminal", () => {
    expect(isTerminalStatus("healthy")).toBe(true);
    expect(isTerminalStatus("failed")).toBe(true);
    expect(isTerminalStatus("queued")).toBe(false);
    expect(isTerminalStatus("building")).toBe(false);
    expect(isTerminalStatus("starting")).toBe(false);
  });
});
