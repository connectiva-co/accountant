-- 0019_document_siigo_voucher_type.sql
-- Agrega siigo_voucher_type_id a documents para parametrizar el tipo de comprobante en Siigo por factura

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS siigo_voucher_type_id integer;

