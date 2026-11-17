-- Kept as a fail-closed compatibility entry for old runbooks and mounts.
DO $$ BEGIN
  RAISE EXCEPTION 'Legacy init.sql disabled. Back up and restore-test, then use db:migrate and db:seed. See docs/architecture/MIGRATIONS.md';
END $$;
