// Supabase Edge Function: delivers Sedompet push notifications.
//
// Called every few minutes by pg_cron (see SETUP-PUSH.md) with
//   Authorization: Bearer <PUSH_CRON_SECRET>
// It asks the database what to send (push_collect), sends each message with
// Web Push (VAPID), and removes devices that no longer exist (404/410).
//
// Secrets (supabase secrets set ...): VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY,
// VAPID_SUBJECT (mailto: or https: contact), PUSH_CRON_SECRET.
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.

import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import webpush from "npm:web-push@3.6.7";

const env = (k: string) => {
  const v = Deno.env.get(k);
  if (!v) throw new Error(`Missing secret ${k}`);
  return v;
};

Deno.serve(async (req) => {
  if (req.headers.get("authorization") !== `Bearer ${env("PUSH_CRON_SECRET")}`) {
    return new Response("forbidden", { status: 403 });
  }
  webpush.setVapidDetails(env("VAPID_SUBJECT"), env("VAPID_PUBLIC_KEY"), env("VAPID_PRIVATE_KEY"));
  const sb = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

  const { data, error } = await sb.rpc("push_collect");
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  const rows = (data ?? []) as { endpoint: string; p256dh: string; auth: string; title: string; body: string; url: string; tag: string }[];

  const ok: string[] = [];
  const gone: string[] = [];
  let failed = 0;
  await Promise.all(
    rows.map(async (r) => {
      try {
        await webpush.sendNotification(
          { endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } },
          JSON.stringify({ title: r.title, body: r.body, url: r.url, tag: r.tag }),
          { TTL: 60 * 60 * 12, urgency: "normal" },
        );
        ok.push(r.endpoint);
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) gone.push(r.endpoint);
        else failed++;
      }
    }),
  );
  if (gone.length) await sb.rpc("push_drop", { p_endpoints: gone });
  if (ok.length) await sb.rpc("push_ok", { p_endpoints: [...new Set(ok)] });
  return new Response(JSON.stringify({ messages: rows.length, sent: ok.length, removed: gone.length, failed }), {
    headers: { "content-type": "application/json" },
  });
});
