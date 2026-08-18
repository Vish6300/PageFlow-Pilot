-- Run these only in Supabase SQL Editor or with server-side service credentials.
-- Replace :start_at and :end_at with cohort timestamps.

-- Activation: a session started playback.
select
  count(*) as sessions,
  count(*) filter (
    where exists (
      select 1
      from pilot_private.pilot_events e
      where e.session_id = s.session_id and e.event_name = 'play_started'
    )
  ) as activated_sessions,
  round(
    count(*) filter (
      where exists (
        select 1
        from pilot_private.pilot_events e
        where e.session_id = s.session_id and e.event_name = 'play_started'
      )
    )::numeric / nullif(count(*), 0),
    4
  ) as activation_rate
from pilot_private.pilot_sessions s
where s.created_at >= :start_at and s.created_at < :end_at;

-- Primary meaningful engagement: recorded once by the app after >=10 active
-- seconds AND either >=50% progress or opening a second sample.
select
  count(*) as sessions,
  count(*) filter (
    where exists (
      select 1
      from pilot_private.pilot_events e
      where e.session_id = s.session_id
        and e.event_name = 'meaningful_engagement'
    )
  ) as meaningfully_engaged_sessions,
  round(
    count(*) filter (
      where exists (
        select 1
        from pilot_private.pilot_events e
        where e.session_id = s.session_id
          and e.event_name = 'meaningful_engagement'
      )
    )::numeric / nullif(count(*), 0),
    4
  ) as meaningful_engagement_rate
from pilot_private.pilot_sessions s
where s.created_at >= :start_at and s.created_at < :end_at;

-- Topic interest and depth.
select
  properties->>'topic' as topic,
  count(*) filter (where event_name = 'sample_selected') as selections,
  count(distinct session_id) filter (where event_name = 'play_started') as starts,
  count(distinct session_id) filter (where event_name = 'progress_50') as halfway_sessions,
  count(distinct session_id) filter (where event_name = 'progress_100') as completed_sessions
from pilot_private.pilot_events
where received_at >= :start_at
  and received_at < :end_at
  and event_name in (
    'sample_selected',
    'play_started',
    'progress_50',
    'progress_100'
  )
group by properties->>'topic'
order by starts desc, selections desc;

-- Topic switches by journey stage, separating pre-play exploration from
-- switches made during reading or after completing the current sample.
select
  properties->>'selection_stage' as selection_stage,
  properties->>'topic' as topic,
  count(*) as selections,
  count(distinct session_id) as sessions
from pilot_private.pilot_events
where received_at >= :start_at
  and received_at < :end_at
  and event_name = 'sample_selected'
group by properties->>'selection_stage', properties->>'topic'
order by selection_stage, selections desc;

-- Latest sentiment per anonymous session.
select
  vote,
  count(*) as responses,
  round(count(*)::numeric / sum(count(*)) over (), 4) as share
from pilot_private.pilot_feedback_current
where received_at >= :start_at and received_at < :end_at
group by vote;

-- Current suggestions. Always render these as untrusted plain text.
select received_at, vote, sample_id, suggestion
from pilot_private.pilot_feedback_current
where received_at >= :start_at
  and received_at < :end_at
  and suggestion is not null
order by received_at desc;

-- Main-site outbound intent (not confirmed arrival).
select
  count(*) as sessions,
  count(*) filter (
    where exists (
      select 1
      from pilot_private.pilot_events e
      where e.session_id = s.session_id
        and e.event_name = 'main_site_clicked'
    )
  ) as click_sessions,
  round(
    count(*) filter (
      where exists (
        select 1
        from pilot_private.pilot_events e
        where e.session_id = s.session_id
          and e.event_name = 'main_site_clicked'
      )
    )::numeric / nullif(count(*), 0),
    4
  ) as outbound_click_rate
from pilot_private.pilot_sessions s
where s.created_at >= :start_at and s.created_at < :end_at;
