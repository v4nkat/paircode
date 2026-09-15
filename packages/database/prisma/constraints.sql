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
