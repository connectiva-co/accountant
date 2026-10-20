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

async function cleanDemo() {
  const client = await pool.connect();
  try {
    console.log('Iniciando limpieza de base de datos...');
    await client.query('BEGIN');

    const jgvRes = await client.query(
      `SELECT id, nit, legal_name FROM companies WHERE nit = '900555053' OR legal_name ILIKE '%JGV%' LIMIT 1`
    );
    const mpRes = await client.query(
      `SELECT id, nit, legal_name FROM companies WHERE nit = '900452038' OR legal_name ILIKE '%MP NET%' LIMIT 1`
    );

    const jgv = jgvRes.rows[0];
    const mp = mpRes.rows[0];

    // =========================================================================
    // PARTE 1: ELIMINAR COMPLETAMENTE MP NET SOLUTIONS
    // =========================================================================
    if (mp) {
      console.log(`\n1. Eliminando completamente: ${mp.legal_name} (NIT ${mp.nit}, ID: ${mp.id})`);
      const mpId = mp.id;

      await client.query(`DELETE FROM reporting_counterparty_monthly WHERE company_id = $1`, [mpId]);
      await client.query(`DELETE FROM reporting_monthly WHERE company_id = $1`, [mpId]);
      await client.query(`DELETE FROM reporting_tax_monthly WHERE company_id = $1`, [mpId]);
      await client.query(`DELETE FROM validation_issues WHERE company_id = $1`, [mpId]);
      await client.query(`DELETE FROM import_rows WHERE import_id IN (SELECT id FROM imports WHERE company_id = $1)`, [mpId]);
      await client.query(`DELETE FROM document_events WHERE company_id = $1`, [mpId]);
      await client.query(`DELETE FROM document_taxes WHERE document_id IN (SELECT id FROM documents WHERE company_id = $1)`, [mpId]);
      await client.query(`DELETE FROM document_status_history WHERE document_id IN (SELECT id FROM documents WHERE company_id = $1)`, [mpId]);
      await client.query(`DELETE FROM document_versions WHERE document_id IN (SELECT id FROM documents WHERE company_id = $1)`, [mpId]);
      await client.query(`DELETE FROM document_integration_matches WHERE company_id = $1`, [mpId]);
      await client.query(`DELETE FROM documents WHERE company_id = $1`, [mpId]);
      await client.query(`DELETE FROM third_party_history WHERE third_party_id IN (SELECT id FROM third_parties WHERE company_id = $1)`, [mpId]);
      await client.query(`DELETE FROM third_parties WHERE company_id = $1`, [mpId]);
      await client.query(`DELETE FROM imports WHERE company_id = $1`, [mpId]);
      await client.query(`DELETE FROM integration_runs WHERE company_id = $1`, [mpId]);
      await client.query(`DELETE FROM sync_conflicts WHERE company_id = $1`, [mpId]);
      await client.query(`DELETE FROM sync_mappings WHERE company_id = $1`, [mpId]);
      await client.query(`DELETE FROM sync_routes WHERE sync_policy_id IN (SELECT id FROM sync_policies WHERE company_id = $1)`, [mpId]);
      await client.query(`DELETE FROM sync_policies WHERE company_id = $1`, [mpId]);
      await client.query(`DELETE FROM entity_external_refs WHERE company_id = $1`, [mpId]);
      await client.query(`DELETE FROM integration_sync_state WHERE company_integration_id IN (SELECT id FROM company_integrations WHERE company_id = $1)`, [mpId]);
      await client.query(`DELETE FROM integration_secrets WHERE company_integration_id IN (SELECT id FROM company_integrations WHERE company_id = $1)`, [mpId]);
      await client.query(`DELETE FROM integration_settings WHERE company_integration_id IN (SELECT id FROM company_integrations WHERE company_id = $1)`, [mpId]);
      await client.query(`DELETE FROM company_integrations WHERE company_id = $1`, [mpId]);
      await client.query(`DELETE FROM company_memberships WHERE company_id = $1`, [mpId]);
      await client.query(`DELETE FROM settings WHERE company_id = $1`, [mpId]);
      await client.query(`DELETE FROM audit_log WHERE company_id = $1`, [mpId]);
      await client.query(`DELETE FROM companies WHERE id = $1`, [mpId]);

      console.log(`   -> MP NET SOLUTIONS eliminada con éxito.`);
    } else {
      console.log('\n1. MP NET SOLUTIONS no se encontró en la base de datos (ya eliminada).');
    }

    // =========================================================================
    // PARTE 2: PURGAR DOCUMENTOS E IMPORTACIONES DE JGV
    // =========================================================================
    if (jgv) {
      console.log(`\n2. Limpiando documentos de: ${jgv.legal_name} (NIT ${jgv.nit}, ID: ${jgv.id})`);
      const jgvId = jgv.id;

      await client.query(`DELETE FROM reporting_counterparty_monthly WHERE company_id = $1`, [jgvId]);
      await client.query(`DELETE FROM reporting_monthly WHERE company_id = $1`, [jgvId]);
      await client.query(`DELETE FROM reporting_tax_monthly WHERE company_id = $1`, [jgvId]);
      await client.query(`DELETE FROM validation_issues WHERE company_id = $1`, [jgvId]);
      await client.query(`DELETE FROM import_rows WHERE import_id IN (SELECT id FROM imports WHERE company_id = $1)`, [jgvId]);
      await client.query(`DELETE FROM document_events WHERE company_id = $1`, [jgvId]);
      await client.query(`DELETE FROM document_taxes WHERE document_id IN (SELECT id FROM documents WHERE company_id = $1)`, [jgvId]);
      await client.query(`DELETE FROM document_status_history WHERE document_id IN (SELECT id FROM documents WHERE company_id = $1)`, [jgvId]);
      await client.query(`DELETE FROM document_versions WHERE document_id IN (SELECT id FROM documents WHERE company_id = $1)`, [jgvId]);
      await client.query(`DELETE FROM document_integration_matches WHERE company_id = $1`, [jgvId]);
      await client.query(`DELETE FROM documents WHERE company_id = $1`, [jgvId]);
      await client.query(`DELETE FROM third_party_history WHERE third_party_id IN (SELECT id FROM third_parties WHERE company_id = $1)`, [jgvId]);
      await client.query(`DELETE FROM third_parties WHERE company_id = $1`, [jgvId]);
      await client.query(`DELETE FROM imports WHERE company_id = $1`, [jgvId]);
      await client.query(`DELETE FROM integration_runs WHERE company_id = $1`, [jgvId]);

      console.log(`   -> JGV reiniciada a 0 documentos, 0 importaciones y 0 terceros.`);
      console.log(`   -> Integración de Siigo, credenciales, membresías y configuración conservadas intactas.`);
    } else {
      console.log('\n2. ADVERTENCIA: JGV no se encontró en la base de datos.');
    }

    await client.query('COMMIT');

    console.log('\n=== ESTADO FINAL EN BASE DE DATOS ===');
    const remaining = await client.query(`SELECT id, nit, legal_name FROM companies ORDER BY legal_name`);
    for (const c of remaining.rows) {
      const docs = await client.query(`SELECT count(*) FROM documents WHERE company_id = $1`, [c.id]);
      const imps = await client.query(`SELECT count(*) FROM imports WHERE company_id = $1`, [c.id]);
      console.log(`- ${c.legal_name} (${c.nit}): ${docs.rows[0].count} documentos, ${imps.rows[0].count} importaciones`);
    }

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error durante la limpieza, transacción revertida:', error);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

cleanDemo().catch(console.error);
