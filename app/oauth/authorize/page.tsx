import { redirect } from "next/navigation";
import { canManageWorkspace, getCurrentWorkspaceContext } from "@/lib/workspace-access";
import {
  buildAuthorizationRedirect,
  createAuthorizationIntent,
  getAllowedChatGptRedirectUri,
  getOAuthIssuer,
  MCP_OAUTH_SCOPES,
  validateAuthorizationParams,
} from "@/lib/mcp/oauth";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function toSearchParams(values: Awaited<SearchParams>): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === "string") params.set(key, value);
    else if (Array.isArray(value)) {
      for (const item of value) params.append(key, item);
    }
  }
  return params;
}

function ErrorCard({ message }: { message: string }) {
  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <section className="panel rounded w-full max-w-lg p-8 shadow-black/40">
        <h1 className="text-xl font-semibold text-foreground">
          Não foi possível conectar ao ChatGPT
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted">{message}</p>
      </section>
    </main>
  );
}

export default async function OAuthAuthorizePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const rawParams = toSearchParams(await searchParams);
  const validation = validateAuthorizationParams(rawParams);
  if (!validation.success) {
    const clientId = rawParams.get("client_id") ?? "";
    const redirectUri = rawParams.get("redirect_uri") ?? "";
    if (getAllowedChatGptRedirectUri(clientId) === redirectUri) {
      redirect(
        buildAuthorizationRedirect(redirectUri, {
          error: validation.error,
          error_description: validation.description,
          state: rawParams.get("state") ?? undefined,
          iss: getOAuthIssuer(),
        }).toString()
      );
    }
    return <ErrorCard message={validation.description} />;
  }

  const context = await getCurrentWorkspaceContext();
  if (!context) {
    const callbackUrl = `/oauth/authorize?${rawParams.toString()}`;
    redirect(`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`);
  }
  if (!canManageWorkspace(context.role)) {
    return (
      <ErrorCard message="Somente proprietários e administradores podem autorizar o acesso MCP deste workspace." />
    );
  }

  const intent = createAuthorizationIntent(
    validation.data,
    context.userId,
    context.workspaceId
  );

  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <section className="panel rounded w-full max-w-lg p-8 shadow-black/40">
        <p className="text-xs font-semibold uppercase tracking-wide text-accent">
          Conexão OAuth
        </p>
        <h1 className="mt-2 text-2xl font-semibold text-foreground">
          Autorizar o ChatGPT
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          O ChatGPT está solicitando acesso ao workspace{" "}
          <strong className="text-foreground">{context.workspace.name}</strong>.
        </p>

        <div className="mt-6 rounded border border-border bg-surface p-4">
          <p className="text-sm font-medium text-foreground">Permissões</p>
          <ul className="mt-3 space-y-2 text-sm text-muted">
            <li>• Ler contas, fluxos, conversas e diagnósticos</li>
            <li>• Criar, editar, ativar e pausar fluxos</li>
            <li>• Enviar mensagens em conversas do Instagram</li>
            <li>• Manter a conexão ativa com renovação segura</li>
          </ul>
          <p className="mt-3 text-xs text-muted">
            Escopos: {MCP_OAUTH_SCOPES.join(" ")}
          </p>
        </div>

        <form action="/api/oauth/authorize" method="post" className="mt-6 flex gap-3">
          <input type="hidden" name="intent" value={intent} />
          <button
            type="submit"
            name="decision"
            value="deny"
            className="flex-1 rounded border border-border px-5 py-3 text-sm font-semibold text-muted hover:text-foreground"
          >
            Cancelar
          </button>
          <button
            type="submit"
            name="decision"
            value="approve"
            className="flex-1 rounded bg-accent px-5 py-3 text-sm font-semibold text-white"
          >
            Autorizar
          </button>
        </form>
      </section>
    </main>
  );
}
