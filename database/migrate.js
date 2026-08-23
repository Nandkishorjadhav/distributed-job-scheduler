const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function resolveModule(name) {
  try {
    return require(name);
  } catch {
    const paths = [
      path.join(__dirname, '..', 'backend', 'shared', 'node_modules', name),
      path.join(__dirname, '..', 'backend', 'api', 'node_modules', name),
      path.join(__dirname, '..', 'node_modules', name),
    ];
    for (const p of paths) {
      try {
        return require(p);
      } catch {}
    }
    throw new Error(`Cannot resolve dependency '${name}' in backend packages.`);
  }
}

const dotenv = resolveModule('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const { Pool } = resolveModule('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME || 'job_scheduler',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'password',
});

async function initMigrationTable(client) {
  const query = `
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      version VARCHAR(255) NOT NULL UNIQUE,
      name VARCHAR(255) NOT NULL,
      checksum VARCHAR(64) NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      execution_time_ms INT NOT NULL
    );
  `;
  await client.query(query);
}

async function getAppliedMigrations(client) {
  const result = await client.query(
    'SELECT version, name, checksum, applied_at, execution_time_ms FROM schema_migrations ORDER BY version ASC'
  );
  return new Map(result.rows.map((r) => [r.version, r]));
}

function calculateChecksum(content) {
  return crypto.createHash('sha256').update(content.trim()).digest('hex');
}

async function runMigrations() {
  const migrationsDir = path.join(__dirname, 'migrations');
  const isStatusOnly = process.argv.includes('--status');

  console.log('='.repeat(70));
  console.log(' Distributed Job Scheduler — Database Migration Engine');
  console.log('='.repeat(70));

  const client = await pool.connect();
  try {
    await initMigrationTable(client);
    const applied = await getAppliedMigrations(client);

    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    if (files.length === 0) {
      console.log('No migration files found in', migrationsDir);
      return;
    }

    if (isStatusOnly) {
      console.log('\nMigration Status:');
      console.log('-'.repeat(70));
      for (const file of files) {
        const version = file.split('_')[0];
        const isApplied = applied.has(version);
        const status = isApplied ? '[APPLIED]' : '[PENDING]';
        const appliedAt = isApplied ? applied.get(version).applied_at.toISOString() : '-';
        console.log(` ${status.padEnd(12)} ${file.padEnd(42)} ${appliedAt}`);
      }
      console.log('-'.repeat(70));
      return;
    }

    let appliedCount = 0;
    for (const file of files) {
      const version = file.split('_')[0];
      const filePath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(filePath, 'utf8');
      const checksum = calculateChecksum(sql);

      if (applied.has(version)) {
        const record = applied.get(version);
        if (record.checksum !== checksum) {
          console.warn(`[WARN] Migration ${file} has been modified since it was applied.`);
        }
        continue;
      }

      console.log(`\nApplying migration: ${file}...`);
      const startTime = Date.now();

      await client.query('BEGIN');
      try {
        await client.query(sql);
        const duration = Date.now() - startTime;

        await client.query(
          `INSERT INTO schema_migrations (version, name, checksum, execution_time_ms)
           VALUES ($1, $2, $3, $4)`,
          [version, file, checksum, duration]
        );

        await client.query('COMMIT');
        console.log(`[SUCCESS] Applied ${file} (${duration}ms)`);
        appliedCount++;
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`[ERROR] Failed to apply migration ${file}:`, err.message);
        throw err;
      }
    }

    if (appliedCount === 0) {
      console.log('\nDatabase schema is up to date. All migrations already applied.');
    } else {
      console.log(`\nSuccessfully applied ${appliedCount} migration(s).`);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

runMigrations().catch((err) => {
  console.error('\nMigration runner failed:', err);
  process.exit(1);
});
