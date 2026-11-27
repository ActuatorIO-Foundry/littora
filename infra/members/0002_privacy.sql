-- Apply only on the dedicated member store, after 0001_sessions.sql.
begin;
do $$ begin
  if current_database() !~ '^littora_members(_ci_[a-f0-9]{32})?$'
     or to_regclass('members.account') is null then
    raise exception 'Expected a dedicated, initialized member database';
  end if;
  create role littora_member_privacy nologin;
  execute format('grant connect on database %I to littora_member_privacy',current_database());
end $$;
set local role littora_members_owner;
-- Existing sessions remain usable for browsing, but never become recent by upgrading.
alter table members.session add column issued_at timestamptz;
alter table members.session alter column issued_at set default clock_timestamp();
create table members.erasure_request (
  account_id uuid primary key references members.account on delete cascade,
  requested_at timestamptz not null default now()
);
create function members.privacy_account(p_digest bytea) returns uuid
language sql stable strict security invoker set search_path = pg_catalog, pg_temp as $$
  select s.account_id from members.session s where s.digest=p_digest and s.expires_at>now()
    and s.issued_at between now()-interval '10 minutes' and now()
$$;
create function members.export_self(p_digest bytea) returns jsonb
language sql stable strict security definer set search_path = pg_catalog, pg_temp as $$
  select jsonb_build_object('memberId',a.id,'issuer',a.issuer,'subject',a.subject,
    'sessions',(select jsonb_agg(jsonb_build_object('issuedAt',s.issued_at,'expiresAt',s.expires_at) order by s.expires_at)
      from members.session s where s.account_id=a.id),
    'erasureRequestedAt',r.requested_at)
  from members.account a
  left join members.erasure_request r on r.account_id=a.id
  where a.id=members.privacy_account(p_digest)
$$;
create function members.request_erasure(p_digest bytea) returns timestamptz
language sql strict security definer set search_path = pg_catalog, pg_temp as $$
  insert into members.erasure_request as r (account_id)
    select id from members.privacy_account(p_digest) id where id is not null
    on conflict (account_id) do update set requested_at=r.requested_at
    returning requested_at
$$;
-- Offline owner only. A stale confirmation cannot affect a newly created account.
create function members.complete_erasure(p_account uuid, p_requested timestamptz) returns boolean
language sql strict security invoker set search_path = pg_catalog, pg_temp as $$
  with erased as (
    delete from members.account a using members.erasure_request r
    where a.id=p_account and r.account_id=a.id and r.requested_at=p_requested returning a.id
  ) select exists(select from erased)
$$;
revoke all on function members.privacy_account(bytea), members.export_self(bytea), members.request_erasure(bytea),
  members.complete_erasure(uuid,timestamptz) from public;
grant usage on schema members to littora_member_privacy;
grant execute on function members.export_self(bytea), members.request_erasure(bytea) to littora_member_privacy;
commit;
