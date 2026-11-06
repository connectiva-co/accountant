-- Migración: Crear tabla siigo_document_types para control de visibilidad de comprobantes
CREATE TABLE IF NOT EXISTS siigo_document_types (
  id integer PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code varchar(20) NOT NULL,
  name varchar(255) NOT NULL,
  description text,
  type varchar(10) NOT NULL DEFAULT 'CC',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_company_siigo_doc_type UNIQUE (company_id, id)
);

CREATE INDEX IF NOT EXISTS idx_siigo_doc_types_company_type ON siigo_document_types(company_id, type, is_active);

