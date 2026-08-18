create extension if not exists pgcrypto with schema extensions;

create schema if not exists pilot_private;

revoke all on schema pilot_private from public, anon, authenticated;
grant usage on schema pilot_private to service_role;

create table pilot_private.pilot_sessions (
  session_id uuid primary key,
  write_secret_hash bytea not null,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default (clock_timestamp() + interval '30 days'),
  initial_sample_id text not null,
  context jsonb not null default '{}'::jsonb,
  constraint pilot_sessions_secret_hash_length check (octet_length(write_secret_hash) = 32),
  constraint pilot_sessions_expiry check (
    expires_at > created_at and expires_at <= created_at + interval '30 days'
  ),
  constraint pilot_sessions_sample_id check (
    initial_sample_id ~ '^[a-z0-9][a-z0-9-]{0,63}$'
  ),
  constraint pilot_sessions_context_object check (jsonb_typeof(context) = 'object'),
  constraint pilot_sessions_context_size check (octet_length(context::text) <= 2048)
);

create table pilot_private.pilot_events (
  session_id uuid not null references pilot_private.pilot_sessions(session_id) on delete cascade,
  event_id uuid not null,
  event_name text not null,
  occurred_at timestamptz,
  received_at timestamptz not null default clock_timestamp(),
  properties jsonb not null default '{}'::jsonb,
  primary key (session_id, event_id),
  constraint pilot_events_name check (
    event_name in (
      'page_view',
      'play_started',
      'engagement_10s',
      'progress_25',
      'progress_50',
      'progress_75',
      'progress_100',
      'sample_selected',
      'second_sample_started',
      'speed_changed',
      'music_toggled',
      'vote_submitted',
      'suggestion_submitted',
      'main_site_clicked',
      'meaningful_engagement'
    )
  ),
  constraint pilot_events_properties_object check (jsonb_typeof(properties) = 'object'),
  constraint pilot_events_properties_size check (octet_length(properties::text) <= 2048)
);

create table pilot_private.pilot_feedback_revisions (
  session_id uuid not null references pilot_private.pilot_sessions(session_id) on delete cascade,
  revision smallint not null,
  received_at timestamptz not null default clock_timestamp(),
  vote text not null,
  suggestion text,
  sample_id text not null,
  primary key (session_id, revision),
  constraint pilot_feedback_revision check (revision between 1 and 20),
  constraint pilot_feedback_vote check (vote in ('like', 'dislike')),
  constraint pilot_feedback_suggestion check (
    suggestion is null or char_length(suggestion) between 1 and 500
  ),
  constraint pilot_feedback_sample_id check (
    sample_id ~ '^[a-z0-9][a-z0-9-]{0,63}$'
  )
);

create index pilot_sessions_created_at_idx
  on pilot_private.pilot_sessions(created_at);
create index pilot_events_name_received_at_idx
  on pilot_private.pilot_events(event_name, received_at);
create index pilot_events_session_received_at_idx
  on pilot_private.pilot_events(session_id, received_at);
create index pilot_feedback_received_at_idx
  on pilot_private.pilot_feedback_revisions(received_at);

alter table pilot_private.pilot_sessions enable row level security;
alter table pilot_private.pilot_events enable row level security;
alter table pilot_private.pilot_feedback_revisions enable row level security;

revoke all on all tables in schema pilot_private from public, anon, authenticated;
grant select on all tables in schema pilot_private to service_role;

create or replace function public.register_pilot_session(
  p_session_id uuid,
  p_session_secret text,
  p_initial_sample_id text,
  p_context jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash bytea;
  v_existing_hash bytea;
begin
  if p_session_id is null
    or p_session_secret !~ '^[0-9a-f]{64}$'
    or p_initial_sample_id !~ '^[a-z0-9][a-z0-9-]{0,63}$'
    or p_context is null
    or jsonb_typeof(p_context) <> 'object'
    or octet_length(p_context::text) > 2048
    or (p_context - array[
      'device',
      'viewport_width',
      'referrer_host',
      'utm_source',
      'utm_medium',
      'utm_campaign'
    ]) <> '{}'::jsonb
  then
    raise exception using errcode = '22023', message = 'Invalid pilot session';
  end if;

  v_hash := extensions.digest(convert_to(p_session_secret, 'UTF8'), 'sha256');

  insert into pilot_private.pilot_sessions (
    session_id,
    write_secret_hash,
    initial_sample_id,
    context
  )
  values (p_session_id, v_hash, p_initial_sample_id, p_context)
  on conflict (session_id) do nothing;

  select write_secret_hash
    into v_existing_hash
  from pilot_private.pilot_sessions
  where session_id = p_session_id
    and expires_at > statement_timestamp();

  if not found or v_existing_hash <> v_hash then
    raise exception using errcode = '28000', message = 'Invalid pilot session credentials';
  end if;
end
$$;

create or replace function public.record_pilot_event(
  p_session_id uuid,
  p_session_secret text,
  p_event_id uuid,
  p_event_name text,
  p_occurred_at timestamptz,
  p_properties jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_created_at timestamptz;
  v_existing pilot_private.pilot_events%rowtype;
begin
  select created_at
    into v_created_at
  from pilot_private.pilot_sessions
  where session_id = p_session_id
    and expires_at > statement_timestamp()
    and write_secret_hash = extensions.digest(
      convert_to(p_session_secret, 'UTF8'),
      'sha256'
    );

  if not found then
    raise exception using errcode = '28000', message = 'Invalid pilot session credentials';
  end if;

  if p_event_id is null
    or p_event_name not in (
      'page_view',
      'play_started',
      'engagement_10s',
      'progress_25',
      'progress_50',
      'progress_75',
      'progress_100',
      'sample_selected',
      'second_sample_started',
      'speed_changed',
      'music_toggled',
      'vote_submitted',
      'suggestion_submitted',
      'main_site_clicked',
      'meaningful_engagement'
    )
    or p_properties is null
    or jsonb_typeof(p_properties) <> 'object'
    or octet_length(p_properties::text) > 2048
    or exists (
      select 1
      from jsonb_each(p_properties) property
      where jsonb_typeof(property.value) not in ('string', 'number', 'boolean', 'null')
    )
  then
    raise exception using errcode = '22023', message = 'Invalid pilot event';
  end if;

  if p_occurred_at between v_created_at - interval '5 minutes'
    and statement_timestamp() + interval '5 minutes'
  then
    null;
  else
    p_occurred_at := null;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_session_id::text, 731943));

  select *
    into v_existing
  from pilot_private.pilot_events
  where session_id = p_session_id and event_id = p_event_id;

  if found then
    if v_existing.event_name is not distinct from p_event_name
      and v_existing.occurred_at is not distinct from p_occurred_at
      and v_existing.properties is not distinct from p_properties
    then
      return;
    end if;

    raise exception using errcode = '22023', message = 'Event id reused with different content';
  end if;

  if (
    select count(*)
    from pilot_private.pilot_events
    where session_id = p_session_id
  ) >= 200 then
    raise exception using errcode = '54000', message = 'Pilot event limit reached';
  end if;

  insert into pilot_private.pilot_events (
    session_id,
    event_id,
    event_name,
    occurred_at,
    properties
  )
  values (
    p_session_id,
    p_event_id,
    p_event_name,
    p_occurred_at,
    p_properties
  );
end
$$;

create or replace function public.submit_pilot_feedback(
  p_session_id uuid,
  p_session_secret text,
  p_vote text,
  p_suggestion text,
  p_sample_id text
)
returns smallint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_revision smallint;
  v_suggestion text := nullif(btrim(p_suggestion), '');
begin
  perform 1
  from pilot_private.pilot_sessions
  where session_id = p_session_id
    and expires_at > statement_timestamp()
    and write_secret_hash = extensions.digest(
      convert_to(p_session_secret, 'UTF8'),
      'sha256'
    );

  if not found then
    raise exception using errcode = '28000', message = 'Invalid pilot session credentials';
  end if;

  if p_vote is null
    or p_vote not in ('like', 'dislike')
    or char_length(coalesce(v_suggestion, '')) > 500
    or p_sample_id !~ '^[a-z0-9][a-z0-9-]{0,63}$'
  then
    raise exception using errcode = '22023', message = 'Invalid pilot feedback';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_session_id::text, 901247));

  select (coalesce(max(revision), 0) + 1)::smallint
    into v_revision
  from pilot_private.pilot_feedback_revisions
  where session_id = p_session_id;

  if v_revision > 20 then
    raise exception using errcode = '54000', message = 'Feedback revision limit reached';
  end if;

  insert into pilot_private.pilot_feedback_revisions (
    session_id,
    revision,
    vote,
    suggestion,
    sample_id
  )
  values (
    p_session_id,
    v_revision,
    p_vote,
    v_suggestion,
    p_sample_id
  );

  return v_revision;
end
$$;

revoke all on function public.register_pilot_session(uuid, text, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.record_pilot_event(uuid, text, uuid, text, timestamptz, jsonb)
  from public, anon, authenticated;
revoke all on function public.submit_pilot_feedback(uuid, text, text, text, text)
  from public, anon, authenticated;

grant execute on function public.register_pilot_session(uuid, text, text, jsonb) to anon;
grant execute on function public.record_pilot_event(uuid, text, uuid, text, timestamptz, jsonb) to anon;
grant execute on function public.submit_pilot_feedback(uuid, text, text, text, text) to anon;

create view pilot_private.pilot_feedback_current
with (security_invoker = true)
as
select distinct on (session_id)
  session_id,
  received_at,
  vote,
  suggestion,
  sample_id
from pilot_private.pilot_feedback_revisions
order by session_id, revision desc;

revoke all on pilot_private.pilot_feedback_current from public, anon, authenticated;
grant select on pilot_private.pilot_feedback_current to service_role;
