cuenta-- 0018_determination_accounting_account.sql
-- Permite sobrescribir y guardar la cuenta contable auxiliar directamente por determinación de impuesto de la factura

ALTER TABLE document_tax_determinations
  ADD COLUMN IF NOT EXISTS accounting_account character varying(30);
