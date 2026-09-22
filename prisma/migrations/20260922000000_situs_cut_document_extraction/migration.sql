-- Scope cutdown phase 8: remove the OCR sidecar.
--
-- DocumentExtraction held a mock classifier's proposal — a document type and a linked entity
-- for a human to confirm in the Documents "Review Required" tab. That tab goes with the
-- Documents browsing UI, and there was never a live OCR engine behind it.
--
-- The `Document` table itself is NOT touched. Receipt emission still archives a PDF against it
-- (lib/services/receipts/service.ts), and that copy is the proof of a filing made at Finanças,
-- so it outlives the browser that used to display it. A leaf drop: document_extractions is
-- referenced by nothing.

DROP INDEX IF EXISTS "document_extractions_userId_status_idx";
DROP INDEX IF EXISTS "document_extractions_documentId_key";

DROP TABLE IF EXISTS "document_extractions";
