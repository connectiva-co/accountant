-- 0015_document_expense_account.sql
-- Agrega columna expense_account a documents para permitir sobreescribir la cuenta PUC por factura

ALTER TABLE documents ADD COLUMN IF NOT EXISTS expense_account character varying(30);

