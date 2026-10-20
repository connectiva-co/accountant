/* 0006: two_factor_enabled en users (estado real del enrolamiento 2FA).
   Preparado en Fase 3; el enrolamiento TOTP llega en la Fase 4. */
ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_enabled boolean NOT NULL DEFAULT false;
