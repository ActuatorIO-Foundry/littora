-- Run as a read-only transaction with a private JSON array of approved SQL
-- logins in the session setting littora.approved_logins. Do not print identities.
do $$
begin
  if exists(
    with approved as (
      select jsonb_array_elements_text(current_setting('littora.approved_logins')::jsonb) as name
    )
    select from pg_catalog.pg_roles principal
    where principal.rolcanlogin and not exists(select from approved where name=principal.rolname)
      and exists(select from pg_catalog.pg_roles effective
        where (principal.oid=effective.oid or pg_has_role(principal.oid,effective.oid,'SET'))
          and has_schema_privilege(effective.oid,'moderation','usage')
          and (has_function_privilege(effective.oid,'moderation.decide(uuid,text,text)','execute')
            or has_table_privilege(effective.oid,'moderation.queue','select')))
  ) then raise exception 'Unapproved moderation login: private access cutover blocked';
  end if;
end $$;
