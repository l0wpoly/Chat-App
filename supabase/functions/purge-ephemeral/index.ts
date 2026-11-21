import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const PURGE_SECRET = Deno.env.get('PURGE_SECRET') ?? '';

function unauthorized(): Response {
  return new Response(JSON.stringify({ error: 'Unauthorized' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(
      JSON.stringify({ error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const authHeader = req.headers.get('authorization') ?? '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const secretHeader = req.headers.get('x-purge-secret')?.trim() ?? '';

  const validServiceRole = bearerToken !== '' && bearerToken === SUPABASE_SERVICE_ROLE_KEY;
  const validPurgeSecret = PURGE_SECRET !== '' && secretHeader === PURGE_SECRET;

  if (!validServiceRole && !validPurgeSecret) {
    return unauthorized();
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: expiredCount, error: expiredErr } = await supabase.rpc('purge_expired_messages');
  if (expiredErr) {
    return new Response(JSON.stringify({ error: expiredErr.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { data: ceilingCount, error: ceilingErr } = await supabase.rpc('enforce_storage_ceiling');
  if (ceilingErr) {
    return new Response(JSON.stringify({ error: ceilingErr.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let queueRemovedCount = 0;
  const queueErrors: string[] = [];

  // Drain storage_cleanup_queue in batches via official Storage API
  while (true) {
    const { data: queueRows, error: queueFetchErr } = await supabase
      .from('storage_cleanup_queue')
      .select('id, bucket_id, object_path')
      .order('id', { ascending: true })
      .limit(100);

    if (queueFetchErr) {
      queueErrors.push(queueFetchErr.message);
      break;
    }

    if (!queueRows || queueRows.length === 0) {
      break;
    }

    const byBucket = new Map<string, string[]>();
    for (const row of queueRows) {
      const list = byBucket.get(row.bucket_id) ?? [];
      list.push(row.object_path);
      byBucket.set(row.bucket_id, list);
    }

    for (const [bucketId, paths] of byBucket.entries()) {
      for (const batch of chunkArray(paths, 100)) {
        const { error: removeErr } = await supabase.storage.from(bucketId).remove(batch);
        if (removeErr) {
          queueErrors.push(`${bucketId}: ${removeErr.message}`);
        } else {
          queueRemovedCount += batch.length;
        }
      }
    }

    const ids = queueRows.map((r) => r.id);
    const { error: deleteQueueErr } = await supabase
      .from('storage_cleanup_queue')
      .delete()
      .in('id', ids);

    if (deleteQueueErr) {
      queueErrors.push(deleteQueueErr.message);
      break;
    }

    if (queueRows.length < 100) {
      break;
    }
  }

  // Sweep any remaining orphaned or >1h old objects in chat-media bucket
  let orphanRemovedCount = 0;
  const { data: orphanRows, error: orphanErr } = await supabase.rpc('list_orphaned_chat_media');
  if (orphanErr) {
    queueErrors.push(orphanErr.message);
  } else if (orphanRows && orphanRows.length > 0) {
    const paths = orphanRows
      .map((r: { object_path: string }) => r.object_path)
      .filter((p: string) => Boolean(p));

    for (const batch of chunkArray(paths, 100)) {
      const { error: removeErr } = await supabase.storage.from('chat-media').remove(batch);
      if (removeErr) {
        queueErrors.push(`orphan-sweep: ${removeErr.message}`);
      } else {
        orphanRemovedCount += batch.length;
      }
    }
  }

  const { data: metrics, error: metricsErr } = await supabase.rpc('reconcile_storage_metrics');
  if (metricsErr) {
    queueErrors.push(metricsErr.message);
  }

  return new Response(
    JSON.stringify({
      ok: queueErrors.length === 0,
      purged_expired_messages: expiredCount ?? 0,
      purged_ceiling_messages: ceilingCount ?? 0,
      removed_queued_files: queueRemovedCount,
      removed_orphan_files: orphanRemovedCount,
      metrics: metrics ?? null,
      errors: queueErrors,
      executed_at: new Date().toISOString(),
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );
});
