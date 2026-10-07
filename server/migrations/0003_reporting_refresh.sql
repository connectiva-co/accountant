-- Accountant · Fase 5 · Refrescado de reportería + ajustes de integridad.

-- RADIAN puede traer totales negativos (nc, anulaciones): se registra el valor
-- real con su incidencia en lugar de rechazar la fila o alterar el importe.
ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_total_check;
ALTER TABLE document_taxes DROP CONSTRAINT IF EXISTS document_taxes_amount_check;

-- Estado 'INSERTED' explícito para las filas que crearon un registro nuevo
-- (antes 'PROCESSED', ambiguo con "procesada sin cambios").
ALTER TABLE import_rows DROP CONSTRAINT IF EXISTS import_rows_status_check;
ALTER TABLE import_rows ADD CONSTRAINT import_rows_status_check
  CHECK (processing_status IN ('PENDING', 'INSERTED', 'UNCHANGED', 'UPDATED', 'REJECTED', 'ERROR'));

/**
 * Recalcula TODAS las tablas de reportería de (empresa, año, mes) desde cero.
 * La reportería es derivada: nunca se edita a mano, solo se refresca.
 * Se llama al terminar cada importación para los periodos afectados.
 */
CREATE OR REPLACE FUNCTION refresh_reporting_month(
  p_company_id uuid,
  p_year integer,
  p_month integer
) RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_from date := make_date(p_year, p_month, 1);
  v_to   date := (v_from + interval '1 month')::date;
BEGIN
  /* ---------------------------------------------------------------- */
  /* 1. Mensual por empresa                                            */
  /* ---------------------------------------------------------------- */
  INSERT INTO reporting_monthly (company_id, year, month, updated_at)
  VALUES (p_company_id, p_year, p_month, now())
  ON CONFLICT (company_id, year, month) DO UPDATE SET updated_at = now();

  UPDATE reporting_monthly m
  SET sales_count = (
        SELECT count(*) FROM documents d JOIN document_types dt ON dt.id = d.document_type_id
        WHERE d.company_id = p_company_id AND d.is_active AND dt.category = 'INVOICE'
          AND d.direction = 'ISSUED' AND d.issued_at >= v_from AND d.issued_at < v_to),
      sales_total = (
        SELECT coalesce(sum(d.total), 0) FROM documents d JOIN document_types dt ON dt.id = d.document_type_id
        WHERE d.company_id = p_company_id AND d.is_active AND dt.category = 'INVOICE'
          AND d.direction = 'ISSUED' AND d.issued_at >= v_from AND d.issued_at < v_to),
      purchase_count = (
        SELECT count(*) FROM documents d JOIN document_types dt ON dt.id = d.document_type_id
        WHERE d.company_id = p_company_id AND d.is_active AND dt.category = 'INVOICE'
          AND d.direction = 'RECEIVED' AND d.issued_at >= v_from AND d.issued_at < v_to),
      purchase_total = (
        SELECT coalesce(sum(d.total), 0) FROM documents d JOIN document_types dt ON dt.id = d.document_type_id
        WHERE d.company_id = p_company_id AND d.is_active AND dt.category = 'INVOICE'
          AND d.direction = 'RECEIVED' AND d.issued_at >= v_from AND d.issued_at < v_to),
      credit_notes_count = (
        SELECT count(*) FROM documents d JOIN document_types dt ON dt.id = d.document_type_id
        WHERE d.company_id = p_company_id AND d.is_active AND dt.category = 'CREDIT_NOTE'
          AND d.issued_at >= v_from AND d.issued_at < v_to),
      credit_notes_total = (
        SELECT coalesce(sum(d.total), 0) FROM documents d JOIN document_types dt ON dt.id = d.document_type_id
        WHERE d.company_id = p_company_id AND d.is_active AND dt.category = 'CREDIT_NOTE'
          AND d.issued_at >= v_from AND d.issued_at < v_to),
      payroll_count = (
        SELECT count(*) FROM documents d JOIN document_types dt ON dt.id = d.document_type_id
        WHERE d.company_id = p_company_id AND d.is_active AND dt.category = 'PAYROLL'
          AND d.issued_at >= v_from AND d.issued_at < v_to),
      payroll_total = (
        SELECT coalesce(sum(d.total), 0) FROM documents d JOIN document_types dt ON dt.id = d.document_type_id
        WHERE d.company_id = p_company_id AND d.is_active AND dt.category = 'PAYROLL'
          AND d.issued_at >= v_from AND d.issued_at < v_to),
      support_documents_count = (
        SELECT count(*) FROM documents d JOIN document_types dt ON dt.id = d.document_type_id
        WHERE d.company_id = p_company_id AND d.is_active AND dt.category = 'SUPPORT'
          AND d.issued_at >= v_from AND d.issued_at < v_to),
      support_documents_total = (
        SELECT coalesce(sum(d.total), 0) FROM documents d JOIN document_types dt ON dt.id = d.document_type_id
        WHERE d.company_id = p_company_id AND d.is_active AND dt.category = 'SUPPORT'
          AND d.issued_at >= v_from AND d.issued_at < v_to),
      -- IVA generado = IVA de facturas emitidas - IVA de NC emitidas (paridad con la app).
      vat_generated = (
        SELECT coalesce(sum(x.amount) FILTER (WHERE tt.code = 'IVA' AND d.direction = 'ISSUED'
                                               AND dt.category = 'INVOICE'), 0)
                - coalesce(sum(x.amount) FILTER (WHERE tt.code = 'IVA' AND d.direction = 'ISSUED'
                                                 AND dt.category = 'CREDIT_NOTE'), 0)
        FROM document_taxes x
        JOIN documents d ON d.id = x.document_id
        JOIN tax_types tt ON tt.id = x.tax_type_id
        JOIN document_types dt ON dt.id = d.document_type_id
        WHERE d.company_id = p_company_id AND d.is_active
          AND d.issued_at >= v_from AND d.issued_at < v_to
      ),
      vat_deductible = (
        SELECT coalesce(sum(x.amount) FILTER (WHERE tt.code = 'IVA' AND d.direction = 'RECEIVED'
                                               AND dt.category = 'INVOICE'), 0)
                - coalesce(sum(x.amount) FILTER (WHERE tt.code = 'IVA' AND d.direction = 'RECEIVED'
                                                 AND dt.category = 'CREDIT_NOTE'), 0)
        FROM document_taxes x
        JOIN documents d ON d.id = x.document_id
        JOIN tax_types tt ON tt.id = x.tax_type_id
        JOIN document_types dt ON dt.id = d.document_type_id
        WHERE d.company_id = p_company_id AND d.is_active
          AND d.issued_at >= v_from AND d.issued_at < v_to
      ),
      withholding_total = (
        SELECT coalesce(sum(x.amount), 0)
        FROM document_taxes x
        JOIN documents d ON d.id = x.document_id
        JOIN tax_types tt ON tt.id = x.tax_type_id
        WHERE d.company_id = p_company_id AND d.is_active
          AND tt.code IN ('IVA_RETE', 'RENTA_RETE', 'ICA_RETE')
          AND d.issued_at >= v_from AND d.issued_at < v_to
      ),
      unique_customers = (
        SELECT count(DISTINCT d.receiver_id) FROM documents d
        JOIN document_types dt ON dt.id = d.document_type_id
        WHERE d.company_id = p_company_id AND d.is_active AND dt.category = 'INVOICE'
          AND d.direction = 'ISSUED' AND d.receiver_id IS NOT NULL
          AND d.issued_at >= v_from AND d.issued_at < v_to
      ),
      unique_suppliers = (
        SELECT count(DISTINCT d.issuer_id) FROM documents d
        JOIN document_types dt ON dt.id = d.document_type_id
        WHERE d.company_id = p_company_id AND d.is_active AND dt.category = 'INVOICE'
          AND d.direction = 'RECEIVED' AND d.issuer_id IS NOT NULL
          AND d.issued_at >= v_from AND d.issued_at < v_to
      ),
      documents_count = (
        SELECT count(*) FROM documents d
        WHERE d.company_id = p_company_id AND d.is_active
          AND d.issued_at >= v_from AND d.issued_at < v_to
      ),
      documents_with_issues = (
        SELECT count(DISTINCT vi.document_id)
        FROM validation_issues vi
        JOIN documents d ON d.id = vi.document_id
        WHERE vi.company_id = p_company_id AND vi.resolved_at IS NULL
          AND d.issued_at >= v_from AND d.issued_at < v_to
      ),
      updated_at = now()
  WHERE m.company_id = p_company_id AND m.year = p_year AND m.month = p_month;

  /* ---------------------------------------------------------------- */
  /* 2. Por tercero (cliente/proveedor)                                */
  /* ---------------------------------------------------------------- */
  DELETE FROM reporting_counterparty_monthly
  WHERE company_id = p_company_id AND year = p_year AND month = p_month;

  INSERT INTO reporting_counterparty_monthly (
    company_id, third_party_id, year, month,
    sales_count, sales_total, purchase_count, purchase_total,
    credit_notes_count, credit_notes_total, tax_total,
    first_transaction_date, last_transaction_date, updated_at
  )
  WITH base AS (
    SELECT
      d.id, d.issued_at, d.direction, d.total, dt.category, x.party_id,
      coalesce((SELECT sum(t.amount) FROM document_taxes t WHERE t.document_id = d.id), 0) AS doc_taxes
    FROM documents d
    JOIN document_types dt ON dt.id = d.document_type_id
    JOIN LATERAL (VALUES (d.issuer_id, 'ISSUED'), (d.receiver_id, 'RECEIVED'))
      AS x(party_id, role)
      ON x.party_id IS NOT NULL
     AND NOT (x.role = 'RECEIVED' AND d.issuer_id = d.receiver_id)
    WHERE d.company_id = p_company_id
      AND d.is_active
      AND d.issued_at >= v_from AND d.issued_at < v_to
  )
  SELECT
    p_company_id, party_id, p_year, p_month,
    count(*) FILTER (WHERE category = 'INVOICE' AND direction = 'ISSUED'),
    coalesce(sum(total) FILTER (WHERE category = 'INVOICE' AND direction = 'ISSUED'), 0),
    count(*) FILTER (WHERE category = 'INVOICE' AND direction = 'RECEIVED'),
    coalesce(sum(total) FILTER (WHERE category = 'INVOICE' AND direction = 'RECEIVED'), 0),
    count(*) FILTER (WHERE category = 'CREDIT_NOTE' AND direction = 'ISSUED'),
    coalesce(sum(total) FILTER (WHERE category = 'CREDIT_NOTE' AND direction = 'ISSUED'), 0),
    sum(doc_taxes),
    min(issued_at), max(issued_at), now()
  FROM base
  GROUP BY party_id;

  /* ---------------------------------------------------------------- */
  /* 3. Por impuesto                                                   */
  /* ---------------------------------------------------------------- */
  DELETE FROM reporting_tax_monthly
  WHERE company_id = p_company_id AND year = p_year AND month = p_month;

  INSERT INTO reporting_tax_monthly (
    company_id, tax_type_id, year, month, direction,
    document_count, taxable_base, tax_amount, updated_at
  )
  SELECT p_company_id, tt.id, p_year, p_month, d.direction,
         count(*),
         NULL::numeric,  -- RADIAN no trae base imponible por impuesto: se deja NULL (nunca se infiere).
         coalesce(sum(x.amount), 0),
         now()
  FROM document_taxes x
  JOIN documents d ON d.id = x.document_id
  JOIN tax_types tt ON tt.id = x.tax_type_id
  WHERE d.company_id = p_company_id
    AND d.is_active
    AND d.issued_at >= v_from AND d.issued_at < v_to
  GROUP BY tt.id, d.direction;
END;
$$;
