"use client";

import { useCallback, useEffect, useState } from "react";

type McpKey = {
  id: string;
  name: string;
  tokenPrefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

type CreatedMcpKey = McpKey & {
  token: string;
  endpoint: string;
};

export function McpAccess({ canManage }: { canManage: boolean }) {
  const [keys, setKeys] = useState<McpKey[]>([]);
  const [name, setName] = useState("My AI agent");
  const [created, setCreated] = useState<CreatedMcpKey | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    const response = await fetch("/api/mcp/keys", { cache: "no-store" });
    const result = await response.json();
    if (!result.success) throw new Error(result.error ?? "Could not load MCP keys");
    setKeys(result.data);
  }, []);

  useEffect(() => {
    if (canManage) {
      void fetch("/api/mcp/keys", { cache: "no-store" })
        .then((response) => response.json())
        .then((result) => {
          if (!result.success) throw new Error(result.error ?? "Could not load MCP keys");
          setKeys(result.data);
        })
        .catch((cause) =>
          setError(cause instanceof Error ? cause.message : "Could not load MCP keys")
        );
    }
  }, [canManage]);

  async function createKey(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/mcp/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const result = await response.json();
      if (!result.success) throw new Error(result.error ?? "Could not create MCP key");
      setCreated(result.data);
      setName("");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create MCP key");
    } finally {
      setBusy(false);
    }
  }

  async function revokeKey(id: string) {
    if (!confirm("Revoke this MCP key? Connected agents will lose access immediately.")) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/mcp/keys?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      const result = await response.json();
      if (!result.success) throw new Error(result.error ?? "Could not revoke MCP key");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not revoke MCP key");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel rounded p-4 sm:p-6" aria-labelledby="mcp-access-heading">
      <h2 id="mcp-access-heading" className="text-base font-semibold">
        MCP access
      </h2>
      <p className="mt-2 text-sm leading-6 text-muted">
        Connect an AI client to list, create, edit, activate, and pause flows in this workspace.
      </p>

      <div className="mt-4 rounded border border-border bg-surface/70 p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">Endpoint</p>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <code className="min-w-0 flex-1 overflow-x-auto rounded bg-background px-3 py-2 text-xs">
            {created?.endpoint ?? "/api/mcp"}
          </code>
          <button
            type="button"
            onClick={() =>
              void navigator.clipboard?.writeText(
                created?.endpoint ?? `${window.location.origin}/api/mcp`
              )
            }
            className="rounded border border-border px-3 py-2 text-xs font-medium"
          >
            Copy endpoint
          </button>
        </div>
      </div>

      {!canManage ? (
        <p className="mt-4 text-sm text-muted">
          Ask a workspace owner or admin to create an MCP key.
        </p>
      ) : (
        <>
          {error && (
            <p role="alert" className="mt-4 rounded border border-error/30 p-3 text-sm text-error">
              {error}
            </p>
          )}

          {created && (
            <div className="mt-4 rounded border border-warning/40 bg-warning/5 p-4">
              <p className="text-sm font-semibold">Copy this key now</p>
              <p className="mt-1 text-xs text-muted">
                For security, the complete key will not be shown again.
              </p>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <code className="min-w-0 flex-1 overflow-x-auto rounded bg-background px-3 py-2 text-xs">
                  {created.token}
                </code>
                <button
                  type="button"
                  onClick={() => void navigator.clipboard?.writeText(created.token)}
                  className="rounded border border-border px-3 py-2 text-xs font-medium"
                >
                  Copy key
                </button>
              </div>
              <button
                type="button"
                onClick={() => setCreated(null)}
                className="mt-3 text-xs underline underline-offset-4"
              >
                I saved it
              </button>
            </div>
          )}

          <form onSubmit={createKey} className="mt-5 flex flex-col gap-3 sm:flex-row">
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Key name, e.g. Codex"
              maxLength={80}
              required
              className="min-w-0 flex-1 rounded border border-border bg-surface px-4 py-2 text-sm"
            />
            <button
              type="submit"
              disabled={busy || !name.trim()}
              className="rounded bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {busy ? "Creating..." : "Create MCP key"}
            </button>
          </form>

          <div className="mt-5 space-y-3 border-t border-border pt-4">
            {keys.length === 0 ? (
              <p className="text-sm text-muted">No MCP keys yet.</p>
            ) : (
              keys.map((key) => (
                <div
                  key={key.id}
                  className="flex flex-col gap-3 rounded border border-border p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="text-sm font-medium">{key.name}</p>
                    <p className="mt-1 text-xs text-muted">
                      {key.tokenPrefix}... · {key.revokedAt ? "Revoked" : key.lastUsedAt ? `Last used ${new Date(key.lastUsedAt).toLocaleString()}` : "Never used"}
                    </p>
                  </div>
                  {!key.revokedAt && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void revokeKey(key.id)}
                      className="rounded border border-error/20 px-3 py-2 text-xs font-medium text-error disabled:opacity-50"
                    >
                      Revoke
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </>
      )}
    </section>
  );
}
