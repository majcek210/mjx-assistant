import { sessionMemory } from "../src/lib/context/sessionMemory";

// Use unique channel IDs per describe block to avoid cross-test contamination
const CH = "test-sm-main";
const CH2 = "test-sm-secondary";

beforeEach(() => {
  sessionMemory.clear(CH);
  sessionMemory.clear(CH2);
  jest.useRealTimers();
});

afterEach(() => {
  sessionMemory.clear(CH);
  sessionMemory.clear(CH2);
  jest.useRealTimers();
});

describe("sessionMemory.format", () => {
  test("returns empty string for an unknown channel", () => {
    expect(sessionMemory.format("no-such-channel-xyz")).toBe("");
  });

  test("returns empty string after clear", () => {
    sessionMemory.add(CH, "user", "Hello");
    sessionMemory.clear(CH);
    expect(sessionMemory.format(CH)).toBe("");
  });

  test("includes Previous conversation header", () => {
    sessionMemory.add(CH, "user", "Hi");
    expect(sessionMemory.format(CH)).toContain("Previous conversation:");
  });

  test("formats user turns with [User] label", () => {
    sessionMemory.add(CH, "user", "Hello bot");
    expect(sessionMemory.format(CH)).toContain("[User]: Hello bot");
  });

  test("formats bot turns with [Assistant] label", () => {
    sessionMemory.add(CH, "bot", "Hello human");
    expect(sessionMemory.format(CH)).toContain("[Assistant]: Hello human");
  });

  test("formatted output ends with double newline", () => {
    sessionMemory.add(CH, "user", "Test");
    expect(sessionMemory.format(CH)).toMatch(/\n\n$/);
  });

  test("preserves message order", () => {
    sessionMemory.add(CH, "user", "First");
    sessionMemory.add(CH, "bot", "Second");
    sessionMemory.add(CH, "user", "Third");
    const result = sessionMemory.format(CH);
    const firstIdx = result.indexOf("First");
    const secondIdx = result.indexOf("Second");
    const thirdIdx = result.indexOf("Third");
    expect(firstIdx).toBeLessThan(secondIdx);
    expect(secondIdx).toBeLessThan(thirdIdx);
  });
});

describe("sessionMemory.add", () => {
  test("truncates content to 500 characters", () => {
    const long = "a".repeat(1000);
    sessionMemory.add(CH, "user", long);
    const result = sessionMemory.format(CH);
    expect(result).toContain("a".repeat(500));
    // 501 a's would require the untruncated string to be present
    expect(result).not.toContain("a".repeat(501));
  });

  test("keeps only the last 10 entries", () => {
    for (let i = 0; i < 15; i++) {
      sessionMemory.add(CH, "user", `Message ${i}`);
    }
    const result = sessionMemory.format(CH);
    // Messages 5–14 should be kept
    expect(result).toContain("Message 5");
    expect(result).toContain("Message 14");
    // Messages 0–4 should be evicted
    expect(result).not.toContain("Message 0");
    expect(result).not.toContain("Message 4");
  });

  test("channels are isolated from each other", () => {
    sessionMemory.add(CH, "user", "Channel-one message");
    sessionMemory.add(CH2, "user", "Channel-two message");

    expect(sessionMemory.format(CH)).toContain("Channel-one message");
    expect(sessionMemory.format(CH)).not.toContain("Channel-two message");

    expect(sessionMemory.format(CH2)).toContain("Channel-two message");
    expect(sessionMemory.format(CH2)).not.toContain("Channel-one message");
  });
});

describe("sessionMemory TTL", () => {
  test("expires session after 1 hour of inactivity", () => {
    jest.useFakeTimers();
    sessionMemory.add(CH, "user", "Will expire");
    expect(sessionMemory.format(CH)).not.toBe("");

    jest.advanceTimersByTime(61 * 60 * 1000); // 61 minutes
    expect(sessionMemory.format(CH)).toBe("");
  });

  test("does not expire session before TTL", () => {
    jest.useFakeTimers();
    sessionMemory.add(CH, "user", "Still fresh");

    jest.advanceTimersByTime(59 * 60 * 1000); // 59 minutes
    expect(sessionMemory.format(CH)).not.toBe("");
  });
});
