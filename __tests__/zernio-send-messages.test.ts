import { afterEach, describe, expect, it, vi } from "vitest";
import {
  sendDirectMessage,
  sendPrivateReplyWithButton,
} from "@/lib/instagram/send-messages";

const context = {
  provider: "ZERNIO" as const,
  apiKey: "test-key",
  accountId: "account-1",
  instagramId: "instagram-1",
  operationId: "operation-1",
};

afterEach(() => vi.unstubAllGlobals());

describe("Zernio message delivery", () => {
  it("uses quick replies for a private reply to a comment", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: { messageId: "message-1" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await sendPrivateReplyWithButton({
      context,
      instagramAccountId: context.instagramId,
      commentId: "comment-1",
      postId: "post-1",
      text: "Abra aqui",
      buttonTitle: "Abrir",
      payload: "reveal:campaign-1",
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://zernio.com/api/v1/inbox/comments/post-1/comment-1/private-reply"
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      accountId: "account-1",
      message: "Abra aqui",
      quickReplies: [{ title: "Abrir", payload: "reveal:campaign-1" }],
    });
  });

  it("resolves the conversation id before sending a later DM", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [{ id: "conversation-1", participantId: "person-1" }],
            pagination: { hasMore: false },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { messageId: "message-2" } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    await sendDirectMessage({
      context,
      instagramAccountId: context.instagramId,
      userId: "person-1",
      message: "Aqui esta o conteudo",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe(
      "https://zernio.com/api/v1/inbox/conversations/conversation-1/messages"
    );
  });
});
