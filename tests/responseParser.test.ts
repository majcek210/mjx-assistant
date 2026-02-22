import parse from "../src/lib/responseParser";

describe("responseParser", () => {
  test("returns defaults when input is undefined", () => {
    const result = parse(undefined);
    expect(result.content).toBe("No response generated");
    expect(result.reasoning).toBe("No response generated");
    expect(result.tools).toEqual([]);
  });

  test("parses valid JSON with all fields", () => {
    const input = JSON.stringify({
      response: "Hello world",
      reasoning: "Some reasoning here",
      tools: [{ name: "calculator", arguments: { a: 1, b: 2 } }],
    });
    const result = parse(input);
    expect(result.content).toBe("Hello world");
    expect(result.reasoning).toBe("Some reasoning here");
    expect(result.tools).toHaveLength(1);
    expect(result.tools[0].name).toBe("calculator");
  });

  test("returns empty strings on invalid JSON", () => {
    const result = parse("not { valid } json {{");
    expect(result.content).toBe("");
    expect(result.reasoning).toBe("");
    expect(result.tools).toEqual([]);
  });

  test("handles missing response and reasoning fields gracefully", () => {
    const result = parse(JSON.stringify({ tools: [] }));
    expect(result.content).toBe("");
    expect(result.reasoning).toBe("");
    expect(result.tools).toEqual([]);
  });

  test("handles missing tools field", () => {
    const result = parse(JSON.stringify({ response: "Hello", reasoning: "Why" }));
    expect(result.content).toBe("Hello");
    expect(result.reasoning).toBe("Why");
    expect(result.tools).toEqual([]);
  });

  test("treats non-array tools as empty array", () => {
    const result = parse(JSON.stringify({ response: "test", tools: "not-an-array" }));
    expect(result.tools).toEqual([]);
  });

  test("treats null tools as empty array", () => {
    const result = parse(JSON.stringify({ response: "test", tools: null }));
    expect(result.tools).toEqual([]);
  });

  test("parses multiple tools", () => {
    const input = JSON.stringify({
      response: "Done",
      reasoning: "Used two tools",
      tools: [
        { name: "tool1", arguments: {} },
        { name: "tool2", arguments: { x: 42 } },
      ],
    });
    const result = parse(input);
    expect(result.tools).toHaveLength(2);
    expect(result.tools[0].name).toBe("tool1");
    expect(result.tools[1].name).toBe("tool2");
    expect(result.tools[1].arguments.x).toBe(42);
  });
});
