-- Accountant · Fase 1 · Seeds de catálogos (idempotente).
-- Solo datos reales de catálogo DIAN/RADIAN. No se crea ninguna empresa:
-- la empresa se deriva del archivo importado.

/* ------------------------------------------------------------------ */
/* Tipos de documento                                                  */
/* ------------------------------------------------------------------ */

INSERT INTO document_types (code, name, category, is_economic_document) VALUES
  ('FACTURA_ELECTRONICA',          'Factura electrónica',                 'INVOICE',     true),
  ('FACTURA_CONTINGENCIA',         'Factura electrónica de contingencia', 'INVOICE',     true),
  ('FACTURA_COMPRA',               'Factura de compra',                   'INVOICE',     true),
  ('NOTA_CREDITO',                 'Nota de crédito electrónica',         'CREDIT_NOTE', true),
  ('NOTA_DEBITO',                  'Nota de débito electrónica',          'DEBIT_NOTE',  true),
  ('DOCUMENTO_SOPORTE',            'Documento soporte',                   'SUPPORT',     true),
  ('DOCUMENTO_SOPORTE_NO_OBLIGADO','Documento soporte con no obligados',  'SUPPORT',     true),
  ('DOCUMENTO_EQUIVALENTE_POS',    'Documento equivalente POS',           'SUPPORT',     true),
  ('NOMINA_INDIVIDUAL',            'Nomina Individual',                   'PAYROLL',     true),
  ('CONTINGENCIA_NOMINA',          'Contingencia nómina',                 'PAYROLL',     true),
  ('APPLICATION_RESPONSE',         'Application response',                'EVENT',       false),
  ('OTRO',                         'Otro tipo de documento',              'OTHER',       true)
ON CONFLICT (code) DO NOTHING;

/* ------------------------------------------------------------------ */
/* Impuestos: las 16 columnas que trae RADIAN                          */
/* ------------------------------------------------------------------ */

INSERT INTO tax_types (code, name, category) VALUES
  ('IVA',             'IVA',                          'VAT'),
  ('IVA_RETE',        'Rete IVA',                     'WITHHOLDING'),
  ('RENTA_RETE',      'Rete Renta',                   'WITHHOLDING'),
  ('ICA_RETE',        'Rete ICA',                     'WITHHOLDING'),
  ('INC',             'INC',                          'INDIRECT'),
  ('IC',              'IC',                           'INDIRECT'),
  ('ICA',             'ICA',                          'INDIRECT'),
  ('INC_BOLSAS',      'INC Bolsas',                   'INDIRECT'),
  ('IN_CARBONO',      'IN Carbono',                   'INDIRECT'),
  ('INC_COMBUSTIBLES','INC Combustibles',             'INDIRECT'),
  ('IC_DATOS',        'IC Datos',                     'INDIRECT'),
  ('ICL',             'ICL',                          'INDIRECT'),
  ('INPP',            'INPP',                         'INDIRECT'),
  ('IBUA',            'IBUA',                         'INDIRECT'),
  ('ICUI',            'ICUI',                         'INDIRECT'),
  ('TIMBRE',          'Timbre',                       'INDIRECT')
ON CONFLICT (code) DO NOTHING;

/* ------------------------------------------------------------------ */
/* Configuración global (company_id NULL)                              */
/* ------------------------------------------------------------------ */

INSERT INTO settings (company_id, scope, key, value, value_type, description, is_system) VALUES
  (NULL, 'import',   'allow_unknown_document_type', 'false'::jsonb, 'boolean', 'Mapa tipos de documento desconocidos a OTRO en lugar de rechazarlos', true),
  (NULL, 'import',   'require_company_nit',         'true'::jsonb,  'boolean', 'Rechaza la importación si no se puede determinar el NIT de la empresa', true),
  (NULL, 'import',   'reject_rows_without_ids',     'true'::jsonb,  'boolean', 'Rechaza filas sin CUFE/CUDE ni identificador compuesto válido', true),
  (NULL, 'import',   'unknown_document_type_code',  '"OTRO"'::jsonb,'string',  'Código de tipo usado cuando no se reconoce el rotulo de RADIAN', true),
  (NULL, 'reporting','include_events_in_metrics',   'false'::jsonb, 'boolean', 'Excluye Application response de KPIs e indicadores', true),
  (NULL, 'reporting','include_inactive_documents',  'false'::jsonb, 'boolean', 'Incluye documentos inactivos (anulados/superados) en la reportería', true),
  (NULL, 'currency', 'display',                     '"COP"'::jsonb, 'string',  'Moneda de visualización por defecto', true),
  (NULL, 'currency', 'rounding_mode',               '"HALF_UP"'::jsonb, 'string', 'Modo de redondeo monetario', true),
  (NULL, 'company',  'default_timezone',            '"America/Bogota"'::jsonb, 'string', 'Zona horaria por defecto de las empresas', true),
  (NULL, 'company',  'default_currency',            '"COP"'::jsonb, 'string',  'Moneda por defecto de las empresas', true)
ON CONFLICT DO NOTHING;
