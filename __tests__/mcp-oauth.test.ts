import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createAuthorizationIntent,
  getMcpResourceUrl,
  verifyAuthorizationIntent,
  verifyPkce,
  validateAuthorizationParams,
} from "@/lib/mcp/oauth";

describe("ChatGPT MCP OAuth helpers", () => {
  beforeEach(() => {
    process.env.NEXTAUTH_URL = "https://openreply.example";
    process.env.NEXTAUTH_SECRET = "test-secret-that-is-long-enough";
  });

  it("accepts the stable ChatGPT CIMD client and required scopes", () => {
    const verifier = "a".repeat(43);
    const challenge = createHash("sha256")
      .update(verifier)
      .digest("base64url");
    const params = new URLSearchParams({
      response_type: "code",
      client_id: "https://chatgpt.com/oauth/client.json",
      redirect_uri: "https://chatgpt.com/connector_platform_oauth_redirect",
      code_challenge: challenge,
      code_challenge_method: "S256",
      resource: getMcpResourceUrl(),
      scope: "flows:read flows:write offline_access",
      state: "opaque-state",
    });

    const result = validateAuthorizationParams(params);
    expect(result.success).toBe(true);
    expect(verifyPkce(verifier, challenge)).toBe(true);
  });

  it("rejects an untrusted redirect URI", () => {
    const params = new URLSearchParams({
      response_type: "code",
      client_id: "https://chatgpt.com/oauth/client.json",
      redirect_uri: "https://attacker.example/callback",
      code_challenge: "a".repeat(43),
      code_challenge_method: "S256",
      resource: getMcpResourceUrl(),
      scope: "flows:read flows:write offline_access",
    });

    expect(validateAuthorizationParams(params)).toMatchObject({
      success: false,
      error: "invalid_request",
    });
  });

  it("signs authorization intent data and detects tampering", () => {
    const intent = createAuthorizationIntent(
      {
        clientId: "https://chatgpt.com/oauth/client.json",
        redirectUri: "https://chatgpt.com/connector_platform_oauth_redirect",
        codeChallenge: "a".repeat(43),
        scopes: ["flows:read", "flows:write", "offline_access"],
        resource: getMcpResourceUrl(),
        state: "state",
      },
      "user_1",
      "workspace_1"
    );

    expect(verifyAuthorizationIntent(intent)).toMatchObject({
      userId: "user_1",
      workspaceId: "workspace_1",
    });
    expect(verifyAuthorizationIntent(`${intent}x`)).toBeNull();
  });
});
