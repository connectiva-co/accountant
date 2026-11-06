-- 0016_payment_account.sql
-- Cuenta de tesorería/pago (banco/caja) para cruce de cuentas posterior

ALTER TABLE third_party_tax_profiles ADD COLUMN IF NOT EXISTS payment_account character varying(30);
ALTER TABLE documents ADD COLUMN IF NOT EXISTS payment_account character varying(30);

