/**
 * Crea (o repara) el usuario OWNER inicial y sus membresías.
 *
 *   npm run bootstrap -- --email admin@empresa.com --name "Admin" [--password ...] [--company <nit|id>]
 *
 * Sin --company se asigna OWNER a todas las empresas existentes.
 * La contraseña puede venir por --password, por BOOTSTRAP_PASSWORD o por stdin:
 *   BOOTSTRAP_PASSWORD=... npm run bootstrap -- --email admin@empresa.com
 *   printf 'mi-contraseña-larga' | npm run bootstrap -- --email admin@empresa.com
 *
 * Sin credenciales hardcodeadas en el código ni en el repositorio.
 */
import { createDb, createPool, loadEnv, requireDatabaseUrl } from '../db/connection.js';
import { migrateToLatest } from '../db/migrator.js';
import { hashPassword, PasswordPolicyError } from '../auth/passwords.js';
import { grantMembership } from '../auth/memberships.js';
import { audit } from '../auth/service.js';
import type { Json } from '../db/schema.js';

interface Options {
  email: string;
  name: string;
  password?: string;
  companies: string[];
  platformAdmin: boolean;
  help: boolean;
}

function usage(): string {
  return [
    'Uso: npm run bootstrap -- --email <correo> [--name "<nombre>"] [--password <contraseña>]',
    '                        [--company <nit|id>]... [--no-platform-admin]',
    '',
    '  --email              Obligatorio. Correo del usuario OWNER inicial.',
    '  --name               Nombre completo (por defecto, parte local del correo).',
    '  --password           Contraseña (alternativa: env BOOTSTRAP_PASSWORD o stdin).',
    '  --company            Asigna OWNER a esa empresa (nit o id). Repetible.',
    '                       Sin --company: a todas las empresas existentes.',
    '  --no-platform-admin  No marcar platform_admin (sin bypass de permisos).',
  ].join('\n');
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    email: '',
    name: '',
    companies: [],
    platformAdmin: true,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = (): string => {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`Falta el valor de ${arg}.`);
      }
      i += 1;
      return value;
    };
    switch (arg) {
      case '--email':
        options.email = next();
        break;
      case '--name':
        options.name = next();
        break;
      case '--password':
        options.password = next();
        break;
      case '--company':
        options.companies.push(next());
        break;
      case '--no-platform-admin':
        options.platformAdmin = false;
        break;
      case '-h':
      case '--help':
        options.help = true;
        break;
      default:
        throw new Error(`Argumento desconocido: ${arg}`);
    }
  }
  return options;
}

async function readPasswordFromStdin(): Promise<string | null> {
  if (process.stdin.isTTY) return null;
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  const value = Buffer.concat(chunks).toString('utf8').trim();
  return value.length > 0 ? value : null;
}

async function resolvePassword(options: Options): Promise<string | null> {
  if (options.password) return options.password;
  if (process.env.BOOTSTRAP_PASSWORD) return process.env.BOOTSTRAP_PASSWORD;
  return readPasswordFromStdin();
}

async function main(): Promise<void> {
  loadEnv();
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  if (!options.email || !options.email.includes('@')) {
    console.error(usage());
    process.exitCode = 1;
    return;
  }

  const password = await resolvePassword(options);
  if (!password) {
    console.error(
      'Falta la contraseña. Usa --password, la variable BOOTSTRAP_PASSWORD o la envía por stdin.',
    );
    process.exitCode = 1;
    return;
  }

  let passwordHash: string;
  try {
    passwordHash = await hashPassword(password);
  } catch (error) {
    if (error instanceof PasswordPolicyError) {
      console.error(`Contraseña rechazada: ${error.message}`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  const url = requireDatabaseUrl();
  const pool = createPool(url, { max: 1 });
  const db = createDb(url);

  try {
    await migrateToLatest(pool);

    const email = options.email.trim().toLowerCase();
    const fullName = (options.name || email.split('@')[0]).trim();

    const existing = await db
      .selectFrom('users')
      .selectAll()
      .where((eb) => eb.fn('lower', ['email']), '=', email)
      .executeTakeFirst();

    let userId: string;
    if (existing) {
      userId = existing.id;
      await db
        .updateTable('users')
        .set({
          password_hash: passwordHash,
          full_name: fullName || existing.full_name,
          status: 'ACTIVE',
          must_change_password: false,
          platform_admin: options.platformAdmin,
          failed_attempts: 0,
          locked_until: null,
        })
        .where('id', '=', userId)
        .execute();
      console.log(`Usuario existente actualizado: ${email}`);
    } else {
      const created = await db
        .insertInto('users')
        .values({
          email,
          full_name: fullName,
          password_hash: passwordHash,
          status: 'ACTIVE',
          platform_admin: options.platformAdmin,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      userId = created.id;
      await audit(db, {
        entityType: 'users',
        entityId: userId,
        action: 'USER_CREATED',
        userId,
        targetUserId: userId,
        after: { email, via: 'bootstrap' } as Json,
      });
      console.log(`Usuario creado: ${email}`);
    }

    let companies: Array<{ id: string; nit: string; legal_name: string }>;
    if (options.companies.length > 0) {
      companies = [];
      for (const key of options.companies) {
        const row = await db
          .selectFrom('companies')
          .select(['id', 'nit', 'legal_name'])
          .where((eb) =>
            eb.or([eb(eb.fn('lower', ['nit']), '=', key.toLowerCase()), eb('id', '=', key)]),
          )
          .executeTakeFirst();
        if (!row) {
          console.error(`Empresa no encontrada: ${key}`);
          process.exitCode = 1;
          return;
        }
        companies.push(row);
      }
    } else {
      companies = await db.selectFrom('companies').select(['id', 'nit', 'legal_name']).execute();
    }

    if (companies.length === 0) {
      console.log('No hay empresas registradas: el usuario queda sin membresías.');
      console.log('Al importar el primer archivo .xlsx se creará la empresa y quedará como OWNER.');
    }

    for (const company of companies) {
      const { created } = await grantMembership(db, {
        companyId: company.id,
        userId,
        roleCode: 'OWNER',
        grantedBy: userId,
      });
      console.log(
        `${created ? 'Membresía creada' : 'Membresía existente'}: OWNER en ${company.legal_name} (NIT ${company.nit})`,
      );
    }

    console.log(`Listo. platform_admin=${options.platformAdmin ? 'sí' : 'no'}.`);
  } finally {
    await db.destroy();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
