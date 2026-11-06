-- 0017_iva_account.sql
-- Agrega iva_account a perfiles tributarios de terceros y a documentos para parametrización de IVA descontable (Compras vs Servicios).

ALTER TABLE third_party_tax_profiles
  ADD COLUMN IF NOT EXISTS iva_account character varying(30);

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS iva_account character varying(30);
