-- Migración: Crear tabla accounting_accounts para el catálogo PUC de Siigo
CREATE TABLE IF NOT EXISTS accounting_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code varchar(30) NOT NULL,
  name varchar(255) NOT NULL,
  level varchar(50) NOT NULL DEFAULT 'Auxiliar',
  is_transactional boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  category varchar(20),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_company_account_code UNIQUE (company_id, code)
);

CREATE INDEX IF NOT EXISTS idx_accounting_accounts_company_code ON accounting_accounts(company_id, code);
CREATE INDEX IF NOT EXISTS idx_accounting_accounts_company_active ON accounting_accounts(company_id, is_active);

