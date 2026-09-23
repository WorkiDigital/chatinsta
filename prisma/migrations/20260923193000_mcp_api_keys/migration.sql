CREATE TABLE "McpApiKey" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenPrefix" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "McpApiKey_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "McpApiKey_tokenHash_key" ON "McpApiKey"("tokenHash");
CREATE INDEX "McpApiKey_workspaceId_idx" ON "McpApiKey"("workspaceId");
CREATE INDEX "McpApiKey_workspaceId_revokedAt_idx" ON "McpApiKey"("workspaceId", "revokedAt");

ALTER TABLE "McpApiKey"
ADD CONSTRAINT "McpApiKey_workspaceId_fkey"
FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
