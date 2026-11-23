-- Bootstrap a dedicated identity database, never the catalogue or its migrations.
begin;
do $$
begin
  if current_database() !~ '^littora_members(_ci_[a-f0-9]{32})?$'
      or exists (select from pg_namespace where nspname not in ('public','information_schema') and nspname !~ '^pg_')
      or exists (select from pg_class where relnamespace = 'public'::regnamespace)
      or exists (select from pg_proc where pronamespace = 'public'::regnamespace) then
    raise exception 'Expected an empty, dedicated member database';
  end if;
  execute format('revoke all on database %I from public', current_database());
end $$;
create role littora_members_owner nologin;
create role littora_session_reader nologin;
create role littora_session_issuer nologin;
do $$ begin
  execute format('grant connect on database %I to littora_session_reader, littora_session_issuer', current_database());
end $$;
revoke all on schema public from public;
create schema members authorization littora_members_owner;
set local role littora_members_owner;

create table members.account (
  id uuid primary key default gen_random_uuid(),
  issuer text collate "C" not null check (octet_length(issuer) between 1 and 2048),
  subject text collate "C" not null check (octet_length(subject) between 1 and 255),
  unique (issuer, subject)
);
create table members.session (
  digest bytea primary key check (octet_length(digest) = 32),
  account_id uuid not null references members.account on delete cascade,
  expires_at timestamptz not null
);
create index session_account_expiry on members.session (account_id, expires_at desc);
create index session_expiry on members.session (expires_at);

create function members.start_session(p_issuer text, p_subject text, p_digest bytea, p_previous bytea)
returns table(member_id uuid, expires_at timestamptz)
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare account uuid;
begin
  -- Lock the account even for concurrent first sign-ins before enforcing the device cap.
  insert into members.account (issuer, subject) values (p_issuer, p_subject)
    on conflict (issuer, subject) do update set subject = excluded.subject returning id into account;
  delete from members.session s where s.digest = p_previous;
  delete from members.session s where s.account_id = account and (s.expires_at <= now() or s.digest in
    (select d.digest from members.session d where d.account_id = account order by d.expires_at desc, d.digest offset 4));
  return query insert into members.session values (p_digest, account, clock_timestamp() + interval '12 hours')
    returning members.session.account_id, members.session.expires_at;
end $$;

create function members.read_session(p_digest bytea)
returns table(member_id uuid, expires_at timestamptz)
language sql stable strict security definer set search_path = pg_catalog, pg_temp as $$
  select s.account_id, s.expires_at from members.session s where s.digest = p_digest and s.expires_at > now()
$$;
create function members.end_session(p_digest bytea) returns void
language sql strict security definer set search_path = pg_catalog, pg_temp as $$
  delete from members.session where digest = p_digest
$$;

revoke all on all functions in schema members from public;
grant usage on schema members to littora_session_reader, littora_session_issuer;
grant execute on function members.read_session(bytea), members.end_session(bytea) to littora_session_reader;
grant execute on function members.start_session(text,text,bytea,bytea) to littora_session_issuer;
commit;
