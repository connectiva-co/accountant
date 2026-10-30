-- Migración: Agregar document_type_id a third_party_tax_profiles
ALTER TABLE third_party_tax_profiles ADD COLUMN IF NOT EXISTS document_type_id integer;

