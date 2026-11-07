-- 0021_document_payable_account.sql
-- Permite sobrescribir y guardar la cuenta contable por pagar para una factura específica

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS payable_account character varying(30);

