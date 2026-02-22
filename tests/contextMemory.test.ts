import {
  buildContext,
  formatContext,
  formatReferencedMessage,
  ContextEntry,
} from "../src/lib/context/contextMemory";

const BOT_ID = "bot-id-123";

/** Minimal Discord message mock. */
function makeMsg(overrides: Record<string, any> = {}) {
  return {
    author: { id: "user-1" },
    content: "Hello",
    embeds: [],
    mentions: { has: (_id: string) => false },
    createdTimestamp: Date.now(),
    reference: null,
    ...overrides,
  };
}

/** Mock channel that resolves messages by ID from a lookup table. */
function makeChannel(messages: Record<string, any>) {
  return {
    messages: {
      fetch: jest.fn(async (id: string) => {
        const msg = messages[id];
        if (!msg) throw new Error(`Message ${id} not found`);
        return msg;
      }),
    },
  };
}

// ─── buildContext ────────────────────────────────────────────────────────────

describe("buildContext — no reference", () => {
  test("returns empty chain when message has no reference", async () => {
    const msg = makeMsg({ channel: makeChannel({}), reference: null });
    const { chain, hasContext } = await buildContext(msg, BOT_ID);
    expect(chain).toEqual([]);
    expect(hasContext).toBe(false);
  });
});

describe("buildContext — first-hop plain user message", () => {
  test("includes the referenced message as a user entry and stops", async () => {
    const refMsg = makeMsg({
      id: "ref-1",
      content: "A long text that should be summarized",
      reference: null,
    });
    const msg = makeMsg({
      channel: makeChannel({ "ref-1": refMsg }),
      reference: { messageId: "ref-1" },
    });

    const { chain, hasContext } = await buildContext(msg, BOT_ID);
    expect(hasContext).toBe(true);
    expect(chain).toHaveLength(1);
    expect(chain[0].role).toBe("user");
    expect(chain[0].content).toBe("A long text that should be summarized");
  });

  test("allows up to 2000 characters for first-hop content", async () => {
    const longText = "x".repeat(2000);
    const refMsg = makeMsg({ id: "ref-1", content: longText, reference: null });
    const msg = makeMsg({
      channel: makeChannel({ "ref-1": refMsg }),
      reference: { messageId: "ref-1" },
    });

    const { chain } = await buildContext(msg, BOT_ID);
    expect(chain[0].content).toHaveLength(2000);
  });

  test("truncates first-hop content beyond 2000 characters", async () => {
    const longText = "y".repeat(2500);
    const refMsg = makeMsg({ id: "ref-1", content: longText, reference: null });
    const msg = makeMsg({
      channel: makeChannel({ "ref-1": refMsg }),
      reference: { messageId: "ref-1" },
    });

    const { chain } = await buildContext(msg, BOT_ID);
    expect(chain[0].content).toHaveLength(2000);
  });
});

describe("buildContext — bot message extraction", () => {
  test("extracts content from bot embed Summary field", async () => {
    const refMsg = makeMsg({
      id: "ref-1",
      author: { id: BOT_ID },
      content: "",
      embeds: [
        {
          data: {
            fields: [
              { name: "Summary", value: "The AI response text" },
              { name: "AI Details", value: "some details" },
            ],
          },
        },
      ],
      reference: null,
    });
    const msg = makeMsg({
      channel: makeChannel({ "ref-1": refMsg }),
      reference: { messageId: "ref-1" },
    });

    const { chain } = await buildContext(msg, BOT_ID);
    expect(chain).toHaveLength(1);
    expect(chain[0].role).toBe("bot");
    expect(chain[0].content).toBe("The AI response text");
  });

  test("falls back to first embed field when no Summary field present", async () => {
    const refMsg = makeMsg({
      id: "ref-1",
      author: { id: BOT_ID },
      content: "",
      embeds: [
        {
          data: {
            fields: [{ name: "Response", value: "Fallback content" }],
          },
        },
      ],
      reference: null,
    });
    const msg = makeMsg({
      channel: makeChannel({ "ref-1": refMsg }),
      reference: { messageId: "ref-1" },
    });

    const { chain } = await buildContext(msg, BOT_ID);
    expect(chain[0].content).toBe("Fallback content");
  });

  test("prefers embed description when present over fields", async () => {
    const refMsg = makeMsg({
      id: "ref-1",
      author: { id: BOT_ID },
      content: "",
      embeds: [
        {
          data: {
            description: "Description text",
            fields: [{ name: "Summary", value: "Field text" }],
          },
        },
      ],
      reference: null,
    });
    const msg = makeMsg({
      channel: makeChannel({ "ref-1": refMsg }),
      reference: { messageId: "ref-1" },
    });

    const { chain } = await buildContext(msg, BOT_ID);
    expect(chain[0].content).toBe("Description text");
  });
});

describe("buildContext — age filtering", () => {
  test("ignores messages older than 30 minutes", async () => {
    const refMsg = makeMsg({
      id: "ref-1",
      content: "Old message content",
      createdTimestamp: Date.now() - 31 * 60 * 1000,
      reference: null,
    });
    const msg = makeMsg({
      channel: makeChannel({ "ref-1": refMsg }),
      reference: { messageId: "ref-1" },
    });

    const { chain, hasContext } = await buildContext(msg, BOT_ID);
    expect(chain).toEqual([]);
    expect(hasContext).toBe(false);
  });

  test("includes messages exactly within 30 minutes", async () => {
    const refMsg = makeMsg({
      id: "ref-1",
      content: "Recent enough message",
      createdTimestamp: Date.now() - 29 * 60 * 1000,
      reference: null,
    });
    const msg = makeMsg({
      channel: makeChannel({ "ref-1": refMsg }),
      reference: { messageId: "ref-1" },
    });

    const { chain } = await buildContext(msg, BOT_ID);
    expect(chain).toHaveLength(1);
  });
});

describe("buildContext — error handling", () => {
  test("returns empty chain when message fetch fails", async () => {
    const channel = {
      messages: {
        fetch: jest.fn().mockRejectedValue(new Error("Network error")),
      },
    };
    const msg = makeMsg({
      channel,
      reference: { messageId: "nonexistent" },
    });

    const { chain, hasContext } = await buildContext(msg, BOT_ID);
    expect(chain).toEqual([]);
    expect(hasContext).toBe(false);
  });
});

describe("buildContext — reply chain walking", () => {
  test("walks a bot message then a user @mention, builds ordered chain", async () => {
    const botMsg = makeMsg({
      id: "bot-msg-1",
      author: { id: BOT_ID },
      content: "",
      embeds: [{ data: { fields: [{ name: "Summary", value: "Bot answer" }] } }],
      reference: null,
    });
    const userReply = makeMsg({
      id: "user-msg-1",
      content: "Follow-up question",
      mentions: { has: (id: string) => id === BOT_ID },
      reference: { messageId: "bot-msg-1" },
    });
    const msg = makeMsg({
      channel: makeChannel({ "bot-msg-1": botMsg, "user-msg-1": userReply }),
      reference: { messageId: "user-msg-1" },
    });

    const { chain } = await buildContext(msg, BOT_ID);
    expect(chain).toHaveLength(2);
    expect(chain[0].role).toBe("bot");
    expect(chain[0].content).toBe("Bot answer");
    expect(chain[1].role).toBe("user");
    expect(chain[1].content).toBe("Follow-up question");
  });

  test("stops chain when a deeper hop has no bot involvement", async () => {
    const unrelatedMsg = makeMsg({
      id: "unreachable",
      content: "Unrelated message",
      reference: null,
    });
    const plainUserMsg = makeMsg({
      id: "plain-user",
      content: "Non-bot conversation",
      reference: { messageId: "unreachable" },
    });
    const botMsg = makeMsg({
      id: "bot-msg-1",
      author: { id: BOT_ID },
      content: "",
      embeds: [{ data: { fields: [{ name: "Summary", value: "Bot response" }] } }],
      reference: { messageId: "plain-user" },
    });
    const msg = makeMsg({
      channel: makeChannel({
        "bot-msg-1": botMsg,
        "plain-user": plainUserMsg,
        unreachable: unrelatedMsg,
      }),
      reference: { messageId: "bot-msg-1" },
    });

    const { chain } = await buildContext(msg, BOT_ID);
    // Should include bot-msg-1 but NOT plain-user (no bot involvement on deeper hop)
    expect(chain).toHaveLength(1);
    expect(chain[0].role).toBe("bot");
  });
});

// ─── formatContext ────────────────────────────────────────────────────────────

describe("formatContext", () => {
  test("returns empty string for empty chain", () => {
    expect(formatContext([])).toBe("");
  });

  test("formats user entry with [User] label", () => {
    const chain: ContextEntry[] = [{ role: "user", content: "Hello" }];
    expect(formatContext(chain)).toContain("[User]: Hello");
  });

  test("formats bot entry with [Assistant] label", () => {
    const chain: ContextEntry[] = [{ role: "bot", content: "Hi" }];
    expect(formatContext(chain)).toContain("[Assistant]: Hi");
  });

  test("includes Previous conversation header", () => {
    const chain: ContextEntry[] = [{ role: "user", content: "Test" }];
    expect(formatContext(chain)).toContain("Previous conversation:");
  });

  test("ends with double newline", () => {
    const chain: ContextEntry[] = [{ role: "user", content: "Test" }];
    expect(formatContext(chain)).toMatch(/\n\n$/);
  });

  test("formats multi-entry chain in order", () => {
    const chain: ContextEntry[] = [
      { role: "user", content: "First" },
      { role: "bot", content: "Second" },
    ];
    const result = formatContext(chain);
    expect(result.indexOf("[User]: First")).toBeLessThan(result.indexOf("[Assistant]: Second"));
  });
});

// ─── formatReferencedMessage ──────────────────────────────────────────────────

describe("formatReferencedMessage", () => {
  test("returns empty string for empty chain", () => {
    expect(formatReferencedMessage([])).toBe("");
  });

  test("uses 'Referenced message' label for a single user entry", () => {
    const chain: ContextEntry[] = [{ role: "user", content: "Text to process" }];
    const result = formatReferencedMessage(chain);
    expect(result).toContain("Referenced message: Text to process");
    expect(result).toMatch(/\n\n$/);
  });

  test("does NOT use 'Referenced message' label for a single bot entry", () => {
    const chain: ContextEntry[] = [{ role: "bot", content: "Bot response" }];
    const result = formatReferencedMessage(chain);
    expect(result).not.toContain("Referenced message:");
    expect(result).toContain("Previous conversation:");
  });

  test("falls back to formatContext for multi-entry chain", () => {
    const chain: ContextEntry[] = [
      { role: "user", content: "Hello" },
      { role: "bot", content: "Hi" },
    ];
    const result = formatReferencedMessage(chain);
    expect(result).toContain("Previous conversation:");
    expect(result).not.toContain("Referenced message:");
  });
});
