# veil — Ephemeral Monochrome Chat

A privacy-first, monochrome Discord-inspired real-time messaging app built with React, TypeScript, Vite, WebRTC, and Supabase.

- **Strict Monochrome Design:** Pure white (`#FFFFFF`), off-white (`#F7F7F8`), hairline `#E5E5E7` borders, crisp charcoal text (`#18181B`).
- **60-Minute Ephemeral Privacy:** Messages, images, videos, and audio auto-expire after 1 hour.
- **5 GB Supabase Failsafe:** Client-side WebP avatar compression (`256×256`, ≤ 50 KB), upload size caps, and an automatic 4.5 GB trigger that trims the oldest messages & queued media files down to 4.0 GB before ever hitting 5 GB.
- **Zero-Bloat P2P Voice & 720p 30fps Screen Sharing:** Native WebRTC over Supabase Realtime Broadcast + Presence — zero call rows written to your database.

---

## 1. Set Up Supabase (Database, Storage & API Keys)

1. Go to [supabase.com](https://supabase.com), sign in, and click **New project**.
2. Wait ~2 minutes for the database to finish provisioning.
3. **Copy your Project URL and Anon API Key:**
   - Open **Project Settings** (gear icon in the left sidebar) → **API** (or **Data API** / **API Keys**).
   - Copy **Project URL** (looks like `https://abcdefghijklmno.supabase.co`) — this will be your `VITE_SUPABASE_URL`.
   - Copy the **anon / public** key (safe for frontend browsers) — this will be your `VITE_SUPABASE_ANON_KEY`.
   - **Important:** Never put your `service_role` key into Render frontend environment variables or commit it to GitHub.
4. **Enable `pg_cron` and `pg_net` (for automatic hourly deletion):**
   - In Supabase Dashboard, go to **Database** → **Extensions**.
   - Search for `pg_cron` and enable it.
   - Search for `pg_net` and enable it.
5. **Run the Database & RLS Schema:**
   - Go to **SQL Editor** → **New query**.
   - Open [`supabase/schema.sql`](./supabase/schema.sql), copy its entire contents, paste it into the SQL Editor, and click **Run**.
   - This creates all tables, strict Row Level Security (RLS) policies, private `avatars` and `chat-media` storage buckets, the 4.5 GB ceiling failsafe triggers, Realtime publication, and the hourly PostgreSQL purge job.

---

## 2. Deploy the Hourly Storage Cleanup Edge Function

PostgreSQL `pg_cron` deletes message rows every hour, while Supabase Storage files (`chat-media` images, videos, and audio) must be deleted via the Supabase Storage API. The Edge Function in [`supabase/functions/purge-ephemeral/index.ts`](./supabase/functions/purge-ephemeral/index.ts) drains the cleanup queue and removes any expired/orphaned files.

### Option A: Deploy via Supabase CLI
```bash
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase functions deploy purge-ephemeral --no-verify-jwt
```

### Option B: Deploy via Supabase Dashboard
1. Go to **Edge Functions** → **Deploy a new function** → name it `purge-ephemeral`.
2. Paste the contents of [`supabase/functions/purge-ephemeral/index.ts`](./supabase/functions/purge-ephemeral/index.ts) and deploy.
3. Make sure JWT verification is disabled (`--no-verify-jwt`) if calling with a custom `x-purge-secret`, or pass `Authorization: Bearer YOUR_SERVICE_ROLE_KEY` (the function checks both).

### Schedule the Edge Function Hourly
In Supabase **SQL Editor**, run this query once (replacing `YOUR_PROJECT_REF` and `YOUR_SERVICE_ROLE_KEY` from **Project Settings → API**):

```sql
SELECT cron.schedule(
  'veil-hourly-storage-purge',
  '5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/purge-ephemeral',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY'
    ),
    body := '{}'::jsonb
  );
  $$
);
```

---

## 3. Publish to GitHub

1. Create a new repository on [github.com/new](https://github.com/new) (e.g., `veil-chat`).
2. Upload all files in this folder (excluding `node_modules` and `dist`, which `.gitignore` already ignores) using GitHub Desktop, VS Code Source Control, or Git CLI:
   ```bash
   git init
   git add .
   git commit -m "Initial commit: veil ephemeral chat"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/veil-chat.git
   git push -u origin main
   ```

---

## 4. Deploy from GitHub to Render

This repo includes [`render.yaml`](./render.yaml) configured as a Render **Static Site** with SPA fallback routing (`/*` → `/index.html`).

### Option A: One-Click Blueprint (`render.yaml`)
1. Go to [dashboard.render.com](https://dashboard.render.com) → **New +** → **Blueprint**.
2. Connect your GitHub account and pick your `veil-chat` repository.
3. Render prompts you for the environment variables defined in `render.yaml`:
   - `VITE_SUPABASE_URL` → paste your Supabase **Project URL**
   - `VITE_SUPABASE_ANON_KEY` → paste your Supabase **anon / public** key
4. Click **Apply** and wait for the build to complete.

### Option B: Manual Static Site
1. Render Dashboard → **New +** → **Static Site** → select your GitHub repository.
2. Set:
   - **Build Command:** `npm install && npm run build`
   - **Publish Directory:** `dist`
3. Under **Redirects/Rewrites**, add:
   - **Source:** `/*` → **Destination:** `/index.html` → **Action:** `Rewrite`
4. Under **Environment**, add:
   - `VITE_SUPABASE_URL` = your Supabase Project URL
   - `VITE_SUPABASE_ANON_KEY` = your Supabase anon public key
5. Click **Create Static Site**.

### Final Step: Whitelist Your Render URL in Supabase Auth
1. Copy your live Render URL (e.g. `https://veil-chat.onrender.com`).
2. In Supabase Dashboard → **Authentication** → **URL Configuration**:
   - Set **Site URL** to `https://veil-chat.onrender.com`.
   - Under **Redirect URLs**, add `https://veil-chat.onrender.com/**`.

---

## 5. STUN / TURN Configuration for WebRTC Calls

By default, voice calls and 720p 30fps screen sharing use public STUN servers (`stun.l.google.com:19302` and `stun.cloudflare.com:3478`), which work for most home and mobile networks without extra setup.

If users connect across strict corporate/symmetric NAT firewalls, you can optionally provide a custom STUN/TURN array via the `VITE_ICE_SERVERS` environment variable in Render (or `.env`):

```env
VITE_ICE_SERVERS=[{"urls":"stun:stun.l.google.com:19302"},{"urls":"turn:your-turn-host.com:3478","username":"user","credential":"password"}]
```

---

## 6. Local Development

```bash
cp .env.example .env
# Fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env
npm install
npm run dev
```
