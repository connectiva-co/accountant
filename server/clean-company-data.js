import pg from 'pg';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  try {
    const envPath = path.resolve(__dirname, '.env');
    const content = readFileSync(envPath, 'utf8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx > 0) {
        const key = trimmed.slice(0, idx).trim();
        const val = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
        if (!process.env[key]) process.env[key] = val;
      }
    }
  } catch {}
}

loadEnv();

const databaseUrl = process.env.DATABASE_URL || 'postgresql://devuser:devpass@100.90.215.73:5432/accountant';
const pool = new pg.Pool({ connectionString: databaseUrl });

/**
 * Limpia los documentos e importaciones de una empresa conservando
 * intactas sus configuraciones, perfiles tributarios e integraciones.
 */
async function cleanCompanyData(companyNitOrId) {
  const client = await pool.connect();
  try {
    console.log('--- Iniciando limpieza de datos operativos ---');
    await client.query('BEGIN');

    let companiesQuery = 'SELECT id, nit, legal_name FROM companies';
    const params = [];

    if (companyNitOrId) {
      companiesQuery += ' WHERE id::text = $1 OR nit = $1';
      params.push(companyNitOrId);
    }

    const { rows: companies } = await client.query(companiesQuery, params);

    if (companies.length === 0) {
      console.log('No se encontraron empresas para limpiar.');
      await client.query('ROLLBACK');
      return;
    }

    for (const company of companies) {
      console.log(`\nLimpiando documentos de: ${company.legal_name} (NIT: ${company.nit}, ID: ${company.id})`);
      const cId = company.id;

      // 1. Desvincular dependencias cruzadas
      await client.query(`UPDATE documents SET first_seen_import_id = NULL, last_seen_import_id = NULL WHERE company_id = $1`, [cId]);
      await client.query(`UPDATE third_party_history SET source_import_id = NULL WHERE third_party_id IN (SELECT id FROM third_parties WHERE company_id = $1)`, [cId]);

      // 2. Tablas asociadas a documentos
      await client.query(`DELETE FROM document_taxes WHERE document_id IN (SELECT id FROM documents WHERE company_id = $1)`, [cId]);
      await client.query(`DELETE FROM document_events WHERE company_id = $1`, [cId]);
      await client.query(`DELETE FROM document_status_history WHERE document_id IN (SELECT id FROM documents WHERE company_id = $1)`, [cId]);
      await client.query(`DELETE FROM document_versions WHERE document_id IN (SELECT id FROM documents WHERE company_id = $1)`, [cId]);
      await client.query(`DELETE FROM validation_issues WHERE company_id = $1`, [cId]);
      await client.query(`DELETE FROM document_integration_matches WHERE company_id = $1`, [cId]);
      await client.query(`DELETE FROM document_tax_determinations WHERE company_id = $1`, [cId]);
      await client.query(`DELETE FROM import_rows WHERE import_id IN (SELECT id FROM imports WHERE company_id = $1)`, [cId]);

      // 3. Documentos e importaciones
      const delDocs = await client.query(`DELETE FROM documents WHERE company_id = $1 RETURNING id`, [cId]);
      const delImps = await client.query(`DELETE FROM imports WHERE company_id = $1 RETURNING id`, [cId]);

      // 4. Tablas agregadas de reportería
      await client.query(`DELETE FROM reporting_monthly WHERE company_id = $1`, [cId]);
      await client.query(`DELETE FROM reporting_counterparty_monthly WHERE company_id = $1`, [cId]);
      await client.query(`DELETE FROM reporting_tax_monthly WHERE company_id = $1`, [cId]);

      console.log(`   -> Eliminados: ${delDocs.rowCount} documentos, ${delImps.rowCount} importaciones.`);
      console.log(`   -> Configuraciones, cuentas PUC y perfiles RUT conservados.`);
    }

    await client.query('COMMIT');
    console.log('\nLimpieza completada exitosamente.');

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error durante la limpieza, transacción revertida:', error);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

const target = process.argv[2]; // opcional: NIT o UUID de empresa
cleanCompanyData(target).catch(console.error);

