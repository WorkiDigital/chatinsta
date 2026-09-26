-- CreateEnum
CREATE TYPE "CollectDataFieldType" AS ENUM ('EMAIL', 'PHONE', 'TEXT');

-- CreateEnum
CREATE TYPE "ContactAnswerStatus" AS ENUM ('PENDING', 'ANSWERED', 'EXPIRED');

-- AlterTable
ALTER TABLE "Automation" ADD COLUMN     "collectDataEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "collectDataFieldType" "CollectDataFieldType" NOT NULL DEFAULT 'TEXT',
ADD COLUMN     "collectDataInvalidMessage" TEXT,
ADD COLUMN     "collectDataQuestion" TEXT;

-- CreateTable
CREATE TABLE "ContactAnswer" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "automationId" TEXT NOT NULL,
    "instagramUserId" TEXT NOT NULL,
    "commenterName" TEXT,
    "status" "ContactAnswerStatus" NOT NULL DEFAULT 'PENDING',
    "question" TEXT NOT NULL,
    "answer" TEXT,
    "fieldType" "CollectDataFieldType" NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "triggerSource" TEXT NOT NULL,
    "triggerText" TEXT,
    "matchedKeyword" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContactAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContactAnswer_workspaceId_idx" ON "ContactAnswer"("workspaceId");

-- CreateIndex
CREATE INDEX "ContactAnswer_status_expiresAt_idx" ON "ContactAnswer"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ContactAnswer_automationId_instagramUserId_key" ON "ContactAnswer"("automationId", "instagramUserId");

-- AddForeignKey
ALTER TABLE "ContactAnswer" ADD CONSTRAINT "ContactAnswer_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactAnswer" ADD CONSTRAINT "ContactAnswer_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "Automation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

