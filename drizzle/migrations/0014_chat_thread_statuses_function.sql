-- One-call per-chat status for the chat list dots.
-- Returns: approval (plan proposed) > working (active plan or unanswered user msg) > empty (no messages) > done.
create or replace function public.chat_thread_statuses()
returns table (thread_id uuid, status text)
language sql
stable
security definer
set search_path = public
as $$
  with mine as (
    select id from public.chat_threads where user_id = auth.uid()
  ),
  ranked_plans as (
    select distinct on (p.thread_id)
      p.thread_id,
      case
        when p.status = 'proposed' then 'approval'
        when p.status in ('composing', 'approved', 'running', 'awaiting_media', 'retrying') then 'working'
        else null
      end as s
    from public.plans p
    where p.thread_id in (select id from mine)
    order by
      p.thread_id,
      case
        when p.status = 'proposed' then 2
        when p.status in ('composing', 'approved', 'running', 'awaiting_media', 'retrying') then 1
        else 0
      end desc,
      p.created_at desc
  ),
  last_msg as (
    select distinct on (m.thread_id) m.thread_id, m.role
    from public.chat_messages m
    where m.thread_id in (select id from mine)
    order by m.thread_id, m.created_at desc
  )
  select
    mine.id,
    coalesce(
      ranked_plans.s,
      case
        when last_msg.thread_id is null then 'empty'
        when last_msg.role = 'user' then 'working'
        else 'done'
      end
    )
  from mine
  left join ranked_plans on ranked_plans.thread_id = mine.id
  left join last_msg on last_msg.thread_id = mine.id;
$$;

revoke all on function public.chat_thread_statuses() from public;
revoke all on function public.chat_thread_statuses() from anon;
grant execute on function public.chat_thread_statuses() to authenticated;