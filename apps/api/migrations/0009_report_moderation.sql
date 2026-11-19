-- Private operator interface. No login or privilege is provisioned by this migration.
CREATE SCHEMA moderation;
REVOKE ALL ON SCHEMA moderation FROM PUBLIC;

CREATE TABLE moderation.decisions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  report_id uuid NOT NULL REFERENCES public.reports(id),
  previous_status text NOT NULL,
  next_status text NOT NULL,
  action text NOT NULL,
  reason text NOT NULL,
  operator_login name NOT NULL,
  decided_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  dispute_id uuid REFERENCES public.reports(id)
);
CREATE INDEX ON moderation.decisions (report_id, id);
CREATE INDEX reports_verified_recent_idx ON public.reports (created_at, beach_id) WHERE status='verified';

CREATE VIEW moderation.queue AS
SELECT r.id, r.beach_id, b.name AS beach, r.type, r.value, r.created_at,
       c.observed_at, c.expires_at, target.type AS disputed_type, target.value AS disputed_value
FROM public.reports r
JOIN public.report_contributions c ON c.report_id = r.id
JOIN public.beaches b ON b.id = r.beach_id
LEFT JOIN public.reports target ON target.id::text = r.value->>'contests' AND target.beach_id = r.beach_id
WHERE r.status = 'pending' AND c.expires_at > now()
  AND c.observed_at <= now() AND coalesce(r.value->>'demo','false') <> 'true';

CREATE FUNCTION moderation.decide(subject uuid, decision text, rationale text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  item record;
  target public.reports%ROWTYPE;
  new_status text;
BEGIN
  IF decision IS NULL OR decision NOT IN ('publish','reject','withdraw','uphold','dismiss')
     OR rationale IS NULL OR rationale NOT IN ('consistent','incorrect','duplicate','unverifiable','outdated') THEN
    RAISE EXCEPTION 'Invalid decision or reason' USING ERRCODE='22023';
  END IF;
  SELECT r.*, c.report_id AS submitted, coalesce(c.expires_at, r.created_at + interval '24 hours') AS expires,
         coalesce(c.observed_at,r.created_at) AS observed INTO item
  FROM public.reports r
  LEFT JOIN public.report_contributions c ON c.report_id=r.id
  WHERE r.id=subject AND coalesce(r.value->>'demo','false') <> 'true' FOR UPDATE OF r;
  IF NOT FOUND OR item.expires IS NULL OR item.expires <= clock_timestamp() OR item.observed > clock_timestamp() THEN
    RAISE EXCEPTION 'No active observation' USING ERRCODE='P0002';
  END IF;

  IF item.value ? 'contests' AND item.type='other' AND item.status='pending' AND item.submitted IS NOT NULL
     AND decision IN ('uphold','dismiss') THEN
    IF decision='uphold' THEN
      SELECT * INTO STRICT target FROM public.reports
      WHERE id=(item.value->>'contests')::uuid AND beach_id=item.beach_id FOR UPDATE;
      IF target.status='verified' THEN
        UPDATE public.reports SET status='rejected' WHERE id=target.id;
        INSERT INTO moderation.decisions(report_id,previous_status,next_status,action,reason,operator_login,dispute_id)
        VALUES (target.id,'verified','rejected','withdraw',rationale,session_user,subject);
      END IF;
    END IF;
    -- A dispute is private even when upheld; it is never itself published.
    new_status := 'rejected';
  ELSIF NOT coalesce(item.value ? 'contests',false) AND item.status='pending' AND item.submitted IS NOT NULL
        AND decision IN ('publish','reject') THEN
    new_status := CASE WHEN decision='publish' THEN 'verified' ELSE 'rejected' END;
  ELSIF item.status='verified' AND decision='withdraw' THEN
    new_status := 'rejected';
  ELSE
    RAISE EXCEPTION 'Transition unavailable' USING ERRCODE='55000';
  END IF;
  UPDATE public.reports SET status=new_status WHERE id=subject;
  INSERT INTO moderation.decisions(report_id,previous_status,next_status,action,reason,operator_login)
  VALUES (subject,item.status,new_status,decision,rationale,session_user);
END;
$$;
REVOKE ALL ON FUNCTION moderation.decide(uuid,text,text) FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA moderation FROM PUBLIC;
