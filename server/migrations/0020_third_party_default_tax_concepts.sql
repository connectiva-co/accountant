-- 0020_third_party_default_tax_concepts.sql
-- Agrega conceptos de retención predeterminados (Renta e ICA) al perfil tributario del tercero

ALTER TABLE third_party_tax_profiles
  ADD COLUMN IF NOT EXISTS default_renta_concept_id uuid REFERENCES tax_concepts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS default_ica_concept_id uuid REFERENCES tax_concepts(id) ON DELETE SET NULL;

