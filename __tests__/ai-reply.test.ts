import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AiReplyError,
  DEFAULT_AI_MODEL,
  generateAiReply,
  verifyAnthropicApiKey,
} from "@/lib/ai/reply";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
});

describe("generateAiReply", () => {
  const input = {
    apiKey: "sk-ant-test",
    model: null,
    instructions: "You sell sourdough bread e-books.",
    history: [],
    messageText: "how much?",
  };

  it("posts to the Messages API and returns the text content", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ content: [{ type: "text", text: "It's $10!" }] }),
        { status: 200 }
      )
    );
    const reply = await generateAiReply(input);
    expect(reply).toBe("It's $10!");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(init.headers["x-api-key"]).toBe("sk-ant-test");
    const body = JSON.parse(init.body);
    expect(body.model).toBe(DEFAULT_AI_MODEL);
    expect(body.messages).toEqual([{ role: "user", content: "how much?" }]);
    expect(typeof body.system).toBe("string");
    expect(body.system).toContain(input.instructions);
  });

  it("uses the workspace's chosen model when set", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ content: [{ type: "text", text: "ok" }] }))
    );
    await generateAiReply({ ...input, model: "claude-sonnet-5" });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.model).toBe("claude-sonnet-5");
  });

  it("turns prior turns into alternating user/assistant messages", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ content: [{ type: "text", text: "ok" }] }))
    );
    await generateAiReply({
      ...input,
      history: [{ inboundText: "hi", replyText: "hello!" }],
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.messages).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello!" },
      { role: "user", content: "how much?" },
    ]);
  });

  it("joins multiple text blocks and trims the result", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          content: [
            { type: "text", text: " It's " },
            { type: "text", text: "$10. " },
          ],
        })
      )
    );
    expect(await generateAiReply(input)).toBe("It's $10.");
  });

  it("throws non-retryable on 401 (bad key)", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "invalid x-api-key" } }), {
        status: 401,
      })
    );
    await expect(generateAiReply(input)).rejects.toMatchObject({
      name: "AiReplyError",
      retryable: false,
    });
  });

  it("throws retryable on 429 and 5xx", async () => {
    for (const status of [429, 500, 503]) {
      fetchMock.mockResolvedValueOnce(new Response("{}", { status }));
      await expect(generateAiReply(input)).rejects.toMatchObject({ retryable: true });
    }
  });

  it("throws retryable on a network error", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNRESET"));
    await expect(generateAiReply(input)).rejects.toMatchObject({
      name: "AiReplyError",
      retryable: true,
    });
  });

  it("throws retryable when the response has no text content", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ content: [] })));
    await expect(generateAiReply(input)).rejects.toMatchObject({ retryable: true });
  });

  it("is a real AiReplyError instance", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 400 }));
    try {
      await generateAiReply(input);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AiReplyError);
    }
  });
});

describe("verifyAnthropicApiKey", () => {
  it("resolves when the key is accepted", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    await expect(verifyAnthropicApiKey("sk-ant-good")).resolves.toBeUndefined();
  });

  it("throws with Anthropic's message when the key is rejected", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "invalid x-api-key" } }), {
        status: 401,
      })
    );
    await expect(verifyAnthropicApiKey("sk-ant-bad")).rejects.toThrow(
      /invalid x-api-key/
    );
  });

  it("throws when the network call itself fails", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    await expect(verifyAnthropicApiKey("sk-ant-good")).rejects.toThrow(
      /Could not reach/
    );
  });
});
