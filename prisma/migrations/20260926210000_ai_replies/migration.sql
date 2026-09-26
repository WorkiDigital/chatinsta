-- AlterTable
ALTER TABLE "Automation" ADD COLUMN     "aiReplyEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "aiReplyInstructions" TEXT,
ADD COLUMN     "aiReplyMaxPerContact" INTEGER NOT NULL DEFAULT 5;

-- CreateTable
CREATE TABLE "AiConnection" (
    "workspaceId" TEXT NOT NULL,
    "apiKey" TEXT NOT NULL,
    "model" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiConnection_pkey" PRIMARY KEY ("workspaceId")
);

-- CreateTable
CREATE TABLE "AiReply" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "automationId" TEXT NOT NULL,
    "instagramUserId" TEXT NOT NULL,
    "inboundText" TEXT NOT NULL,
    "replyText" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiReply_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiReply_workspaceId_idx" ON "AiReply"("workspaceId");

-- CreateIndex
CREATE INDEX "AiReply_automationId_instagramUserId_createdAt_idx" ON "AiReply"("automationId", "instagramUserId", "createdAt");

-- AddForeignKey
ALTER TABLE "AiConnection" ADD CONSTRAINT "AiConnection_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiReply" ADD CONSTRAINT "AiReply_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiReply" ADD CONSTRAINT "AiReply_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "Automation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

