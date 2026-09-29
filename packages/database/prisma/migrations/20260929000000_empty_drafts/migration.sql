-- Deleting a draft is a valid collaborative edit. Execution submissions remain nonempty.
ALTER TABLE "CodeSnapshot" DROP CONSTRAINT "CodeSnapshot_source_size_check";
ALTER TABLE "CodeSnapshot" ADD CONSTRAINT "CodeSnapshot_source_size_check"
  CHECK (octet_length("sourceCode") <= 65536 AND (reason <> 'EXECUTION' OR octet_length("sourceCode") > 0));
