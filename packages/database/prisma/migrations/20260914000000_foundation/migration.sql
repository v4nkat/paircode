-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "RoomStatus" AS ENUM ('ACTIVE', 'ENDED');

-- CreateEnum
CREATE TYPE "MemberRole" AS ENUM ('OWNER', 'PARTICIPANT');

-- CreateEnum
CREATE TYPE "Visibility" AS ENUM ('VISIBLE', 'HIDDEN');

-- CreateEnum
CREATE TYPE "ExecutionStatus" AS ENUM ('QUEUED', 'RUNNING', 'PASSED', 'FAILED', 'ERROR');

-- CreateEnum
CREATE TYPE "ErrorCategory" AS ENUM ('WRONG_ANSWER', 'TIMEOUT', 'MEMORY_LIMIT', 'RUNTIME_ERROR', 'COMPILE_ERROR', 'QUEUE_FAILURE', 'SANDBOX_UNAVAILABLE', 'WORKER_FAILURE', 'INTERNAL_ERROR');

-- CreateEnum
CREATE TYPE "DispatchState" AS ENUM ('PENDING', 'ENQUEUED');

-- CreateEnum
CREATE TYPE "SnapshotReason" AS ENUM ('CHECKPOINT', 'EXECUTION', 'SESSION_END');

-- CreateEnum
CREATE TYPE "RoomEventType" AS ENUM ('CREATED', 'JOINED', 'LEFT', 'ENDED', 'PROBLEM_CHANGED', 'EXECUTION_QUEUED', 'EXECUTION_COMPLETED');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "clerkId" VARCHAR(255) NOT NULL,
    "displayName" VARCHAR(100) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Room" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "title" VARCHAR(100) NOT NULL,
    "selectedProblemId" UUID NOT NULL,
    "selectionRevision" INTEGER NOT NULL DEFAULT 0,
    "status" "RoomStatus" NOT NULL DEFAULT 'ACTIVE',
    "inviteTokenHash" CHAR(64),
    "inviteExpiresAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMPTZ(3),

    CONSTRAINT "Room_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoomMember" (
    "roomId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "seat" INTEGER NOT NULL,
    "role" "MemberRole" NOT NULL,
    "joinedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMPTZ(3),
    "lastSeenAt" TIMESTAMPTZ(3),

    CONSTRAINT "RoomMember_pkey" PRIMARY KEY ("roomId","userId")
);

-- CreateTable
CREATE TABLE "Problem" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(100) NOT NULL,
    "version" INTEGER NOT NULL,
    "title" VARCHAR(150) NOT NULL,
    "promptMarkdown" TEXT NOT NULL,
    "language" VARCHAR(20) NOT NULL,
    "starterCode" TEXT NOT NULL,
    "functionSignature" TEXT NOT NULL,
    "constraints" TEXT NOT NULL,
    "comparator" VARCHAR(60) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Problem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestCase" (
    "id" UUID NOT NULL,
    "problemId" UUID NOT NULL,
    "visibility" "Visibility" NOT NULL,
    "input" JSONB NOT NULL,
    "expectedOutput" JSONB NOT NULL,
    "ordering" INTEGER NOT NULL,

    CONSTRAINT "TestCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoomDocument" (
    "roomId" UUID NOT NULL,
    "state" BYTEA NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "savedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoomDocument_pkey" PRIMARY KEY ("roomId")
);

-- CreateTable
CREATE TABLE "CodeSnapshot" (
    "id" UUID NOT NULL,
    "roomId" UUID NOT NULL,
    "problemId" UUID NOT NULL,
    "language" VARCHAR(20) NOT NULL,
    "sourceCode" TEXT NOT NULL,
    "sourceHash" CHAR(64) NOT NULL,
    "createdById" UUID,
    "reason" "SnapshotReason" NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CodeSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Execution" (
    "id" UUID NOT NULL,
    "roomId" UUID NOT NULL,
    "requestedById" UUID NOT NULL,
    "codeSnapshotId" UUID NOT NULL,
    "problemId" UUID NOT NULL,
    "language" VARCHAR(20) NOT NULL,
    "status" "ExecutionStatus" NOT NULL DEFAULT 'QUEUED',
    "errorCategory" "ErrorCategory",
    "dispatchState" "DispatchState" NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" VARCHAR(128) NOT NULL,
    "requestHash" CHAR(64) NOT NULL,
    "queueJobId" VARCHAR(128),
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "leaseToken" UUID,
    "leaseExpiresAt" TIMESTAMPTZ(3),
    "queuedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "durationMs" INTEGER,

    CONSTRAINT "Execution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExecutionTestResult" (
    "id" UUID NOT NULL,
    "executionId" UUID NOT NULL,
    "testCaseId" UUID NOT NULL,
    "problemId" UUID NOT NULL,
    "passed" BOOLEAN,
    "durationMs" INTEGER,
    "memoryKb" INTEGER,
    "outputPreview" VARCHAR(8192),
    "errorPreview" VARCHAR(2048),
    "sandboxToken" VARCHAR(255),
    "submissionState" VARCHAR(32) NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExecutionTestResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoomEvent" (
    "id" UUID NOT NULL,
    "roomId" UUID NOT NULL,
    "actorId" UUID,
    "eventType" "RoomEventType" NOT NULL,
    "metadataJson" JSONB NOT NULL DEFAULT '{}',
    "deduplicationKey" VARCHAR(255),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoomEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_clerkId_key" ON "User"("clerkId");

-- CreateIndex
CREATE UNIQUE INDEX "Room_inviteTokenHash_key" ON "Room"("inviteTokenHash");

-- CreateIndex
CREATE INDEX "Room_ownerId_createdAt_id_idx" ON "Room"("ownerId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "RoomMember_userId_joinedAt_idx" ON "RoomMember"("userId", "joinedAt");

-- CreateIndex
CREATE UNIQUE INDEX "RoomMember_roomId_seat_key" ON "RoomMember"("roomId", "seat");

-- CreateIndex
CREATE UNIQUE INDEX "Problem_slug_version_key" ON "Problem"("slug", "version");

-- CreateIndex
CREATE UNIQUE INDEX "TestCase_problemId_ordering_key" ON "TestCase"("problemId", "ordering");

-- CreateIndex
CREATE UNIQUE INDEX "TestCase_id_problemId_key" ON "TestCase"("id", "problemId");

-- CreateIndex
CREATE INDEX "CodeSnapshot_roomId_createdAt_id_idx" ON "CodeSnapshot"("roomId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "CodeSnapshot_problemId_idx" ON "CodeSnapshot"("problemId");

-- CreateIndex
CREATE UNIQUE INDEX "CodeSnapshot_id_roomId_problemId_key" ON "CodeSnapshot"("id", "roomId", "problemId");

-- CreateIndex
CREATE UNIQUE INDEX "Execution_queueJobId_key" ON "Execution"("queueJobId");

-- CreateIndex
CREATE INDEX "Execution_roomId_queuedAt_id_idx" ON "Execution"("roomId", "queuedAt", "id");

-- CreateIndex
CREATE INDEX "Execution_dispatchState_status_queuedAt_idx" ON "Execution"("dispatchState", "status", "queuedAt");

-- CreateIndex
CREATE INDEX "Execution_status_leaseExpiresAt_idx" ON "Execution"("status", "leaseExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Execution_roomId_requestedById_idempotencyKey_key" ON "Execution"("roomId", "requestedById", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "Execution_id_problemId_key" ON "Execution"("id", "problemId");

-- CreateIndex
CREATE UNIQUE INDEX "ExecutionTestResult_executionId_testCaseId_key" ON "ExecutionTestResult"("executionId", "testCaseId");

-- CreateIndex
CREATE UNIQUE INDEX "RoomEvent_deduplicationKey_key" ON "RoomEvent"("deduplicationKey");

-- CreateIndex
CREATE INDEX "RoomEvent_roomId_createdAt_id_idx" ON "RoomEvent"("roomId", "createdAt", "id");

-- AddForeignKey
ALTER TABLE "Room" ADD CONSTRAINT "Room_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Room" ADD CONSTRAINT "Room_selectedProblemId_fkey" FOREIGN KEY ("selectedProblemId") REFERENCES "Problem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomMember" ADD CONSTRAINT "RoomMember_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomMember" ADD CONSTRAINT "RoomMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestCase" ADD CONSTRAINT "TestCase_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomDocument" ADD CONSTRAINT "RoomDocument_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CodeSnapshot" ADD CONSTRAINT "CodeSnapshot_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CodeSnapshot" ADD CONSTRAINT "CodeSnapshot_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CodeSnapshot" ADD CONSTRAINT "CodeSnapshot_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Execution" ADD CONSTRAINT "Execution_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Execution" ADD CONSTRAINT "Execution_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Execution" ADD CONSTRAINT "Execution_codeSnapshotId_fkey" FOREIGN KEY ("codeSnapshotId") REFERENCES "CodeSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Execution" ADD CONSTRAINT "Execution_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExecutionTestResult" ADD CONSTRAINT "ExecutionTestResult_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "Execution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExecutionTestResult" ADD CONSTRAINT "ExecutionTestResult_testCaseId_fkey" FOREIGN KEY ("testCaseId") REFERENCES "TestCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomEvent" ADD CONSTRAINT "RoomEvent_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomEvent" ADD CONSTRAINT "RoomEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Reviewed additions to the generated schema. Keep this file in sync with the migration.
ALTER TABLE "RoomMember" ADD CONSTRAINT "RoomMember_seat_check" CHECK (seat IN (1, 2));
ALTER TABLE "Room" ADD CONSTRAINT "Room_revision_check" CHECK ("selectionRevision" >= 0);
ALTER TABLE "RoomDocument" ADD CONSTRAINT "RoomDocument_revision_check" CHECK (revision >= 0);
ALTER TABLE "CodeSnapshot" ADD CONSTRAINT "CodeSnapshot_source_size_check" CHECK (octet_length("sourceCode") BETWEEN 1 AND 65536);
ALTER TABLE "CodeSnapshot" ADD CONSTRAINT "CodeSnapshot_language_check" CHECK (language = 'python');
ALTER TABLE "Execution" ADD CONSTRAINT "Execution_language_check" CHECK (language = 'python');
ALTER TABLE "Problem" ADD CONSTRAINT "Problem_language_check" CHECK (language = 'python');
ALTER TABLE "Problem" ADD CONSTRAINT "Problem_version_check" CHECK (version > 0);
ALTER TABLE "TestCase" ADD CONSTRAINT "TestCase_ordering_check" CHECK (ordering >= 0);
ALTER TABLE "Execution" ADD CONSTRAINT "Execution_attempt_count_check" CHECK ("attemptCount" >= 0);
ALTER TABLE "Execution" ADD CONSTRAINT "Execution_snapshot_scope_fkey"
  FOREIGN KEY ("codeSnapshotId", "roomId", "problemId") REFERENCES "CodeSnapshot" (id, "roomId", "problemId");
ALTER TABLE "ExecutionTestResult" ADD CONSTRAINT "Result_execution_scope_fkey"
  FOREIGN KEY ("executionId", "problemId") REFERENCES "Execution" (id, "problemId");
ALTER TABLE "ExecutionTestResult" ADD CONSTRAINT "Result_test_scope_fkey"
  FOREIGN KEY ("testCaseId", "problemId") REFERENCES "TestCase" (id, "problemId");

CREATE FUNCTION protect_snapshot_contents() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.id,NEW."roomId",NEW."problemId",NEW.language,NEW."sourceCode",NEW."sourceHash",NEW.reason,NEW."createdAt")
     IS DISTINCT FROM
     ROW(OLD.id,OLD."roomId",OLD."problemId",OLD.language,OLD."sourceCode",OLD."sourceHash",OLD.reason,OLD."createdAt") THEN
    RAISE EXCEPTION 'Code snapshot contents are immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER immutable_snapshot BEFORE UPDATE ON "CodeSnapshot"
  FOR EACH ROW EXECUTE FUNCTION protect_snapshot_contents();

CREATE FUNCTION protect_catalog_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Published problem versions and test definitions are immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER immutable_problem BEFORE UPDATE ON "Problem"
  FOR EACH ROW EXECUTE FUNCTION protect_catalog_version();
CREATE TRIGGER immutable_test BEFORE UPDATE ON "TestCase"
  FOR EACH ROW EXECUTE FUNCTION protect_catalog_version();

CREATE FUNCTION reject_hidden_output() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "TestCase" WHERE id = NEW."testCaseId" AND visibility = 'HIDDEN')
     AND (NEW."outputPreview" IS NOT NULL OR NEW."errorPreview" IS NOT NULL) THEN
    RAISE EXCEPTION 'Hidden test output must not be persisted in preview fields';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER hidden_output_boundary BEFORE INSERT OR UPDATE ON "ExecutionTestResult"
  FOR EACH ROW EXECUTE FUNCTION reject_hidden_output();
