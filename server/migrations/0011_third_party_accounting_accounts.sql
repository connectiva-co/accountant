-- Migración 0011: Agregar cuentas contables por defecto a third_party_tax_profiles
ALTER TABLE third_party_tax_profiles 
  ADD COLUMN IF NOT EXISTS expense_account varchar(30),
  ADD COLUMN IF NOT EXISTS payable_account varchar(30);

COMMENT ON COLUMN third_party_tax_profiles.expense_account IS 'Cuenta contable Siigo de contrapartida/gasto (ej. 51103001)';
COMMENT ON COLUMN third_party_tax_profiles.payable_account IS 'Cuenta contable Siigo por pagar al proveedor (ej. 22050501)';
