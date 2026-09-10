import type { PoolClient } from 'pg';

/** Run inside a read-only transaction. Check every privilege individually (comma lists mean OR). */
export async function inspectStagingPermissions(client: Pick<PoolClient, 'query'>): Promise<number> {
  const role = await client.query<{ safe: boolean }>(`
    SELECT current_user = 'rove_staging_app'
      AND NOT (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)
      AND NOT has_schema_privilege(current_user, 'public', 'CREATE')
      AND NOT EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname <> current_user
        AND pg_has_role(current_user, r.oid, 'MEMBER')) AS safe
    FROM pg_roles WHERE rolname = current_user
  `);
  if (role.rows[0]?.safe !== true) throw new Error('Runtime role permissions are unsafe.');
  const tables = await client.query<{ safe: boolean }>(`
    SELECT has_table_privilege(current_user, c.oid, 'SELECT')
      AND has_table_privilege(current_user, c.oid, 'INSERT')
      AND has_table_privilege(current_user, c.oid, 'UPDATE')
      AND has_table_privilege(current_user, c.oid, 'DELETE')
      AND NOT has_table_privilege(current_user, c.oid, 'TRUNCATE') AS safe
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
  `);
  if (!tables.rows.length || tables.rows.some((row) => row.safe !== true))
    throw new Error('Application tables are absent or have incorrect runtime permissions.');
  const sequences = await client.query<{ safe: boolean }>(`
    SELECT has_sequence_privilege(current_user, c.oid, 'USAGE')
      AND has_sequence_privilege(current_user, c.oid, 'SELECT') AS safe
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'S'
  `);
  if (sequences.rows.some((row) => row.safe !== true))
    throw new Error('Application sequence permissions are incomplete.');
  return tables.rows.length;
}
