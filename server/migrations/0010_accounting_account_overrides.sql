-- 0010_accounting_account_overrides.sql: Cuentas contables específicas por regla tributaria

ALTER TABLE third_party_tax_rules
  ADD COLUMN IF NOT EXISTS accounting_account varchar(30);

ALTER TABLE company_tax_configurations
  ADD COLUMN IF NOT EXISTS accounting_account varchar(30);
