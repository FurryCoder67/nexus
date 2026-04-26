# Cloud Multiplayer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Nexus's PeerJS P2P system with a Supabase-powered cloud backend giving every player a persistent account, one-click lobby browsing, per-game stat tracking, and leaderboards across all five active games.

**Architecture:** Supabase handles Auth (Google, Discord, Email), Realtime channels (live room state broadcast), and PostgreSQL (profiles, rooms, stats, leaderboards). Three new JS modules (`nexus-auth.js`, `nexus-cloud.js`, `nexus-db.js`) slot into each game alongside the existing `nexus-config.js` pattern. Games redirect to `multiplayer-lobby.html?game=<id>` for room browsing, then receive a `?room=<id>` param back to auto-join.

**Tech Stack:** Supabase JS SDK v2 (CDN), vanilla JS, no build step. All game files are self-contained HTML.

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `games/nexus-config.js` | Modify | Add `NEXUS_SUPABASE_URL` + `NEXUS_SUPABASE_ANON_KEY` |
| `games/migration.sql` | Create | One-time SQL that creates all tables + RLS policies |
| `games/nexus-auth.js` | Create | Auth module: sign-in/out, session, `requireAuth()` |
| `login.html` | Create | Login page: Google, Discord, Email/Password, guest |
| `games/nexus-db.js` | Create | Stats save, leaderboard queries, profile CRUD |
| `games/nexus-cloud.js` | Create | Cloud rooms + realtime broadcast (replaces nexus-mp.js) |
| `games/multiplayer-lobby.html` | Rewrite | Live room browser powered by Supabase Realtime |
| `index.html` | Modify | Show signed-in user in header; global leaderboard section |
| `profile.html` | Modify | Show real account data + per-game stats from Supabase |
| `games/spirit-chase/index.html` | Modify | Swap NexusMP → NexusCloud; add stats on game end |
| `games/domain-defender/index.html` | Modify | Same |
| `games/culling-colony/index.html` | Modify | Same |
| `games/cursed-arena/index.html` | Modify | Same |
| `games/jujutsuhunters/hunters.html` | Modify | Same; replace existing custom auth/save |

---

## Task 1: Update nexus-config.js and Create migration.sql

**Files:**
- Modify: `games/nexus-config.js`
- Create: `games/migration.sql`

- [ ] **Step 1: Update nexus-config.js**

Replace the entire contents of `games/nexus-config.js` with:

```js
window.NEXUS_PLAYER_NAME = localStorage.getItem('nexus_playername') || 'Sorcerer';
window.NEXUS_SUPABASE_URL = 'YOUR_SUPABASE_URL';
window.NEXUS_SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';
```

> **User action required:** After creating a Supabase project at supabase.com, replace `YOUR_SUPABASE_URL` and `YOUR_SUPABASE_ANON_KEY` with the values from Project Settings → API.

- [ ] **Step 2: Create migration.sql**

Create `games/migration.sql` with:

```sql
-- profiles: one row per user, auto-created on first sign-in
create table if not exists public.profiles (
  id uuid references auth.users(id) on delete cascade primary key,
  username text unique,
  display_name text,
  avatar_url text,
  xp integer default 0,
  level integer default 1,
  created_at timestamptz default now()
);
alter table public.profiles enable row level security;
create policy "Public profiles are viewable by everyone" on public.profiles
  for select using (true);
create policy "Users can update own profile" on public.profiles
  for update using (auth.uid() = id);

-- Auto-create profile row whenever a user signs up
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, username, display_name, avatar_url)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data->>'preferred_username',
      split_part(coalesce(new.email, new.id::text), '@', 1)
    ),
    coalesce(
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'name',
      new.raw_user_meta_data->>'preferred_username',
      split_part(coalesce(new.email, new.id::text), '@', 1)
    ),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- game_rooms: one row per active game session
create table if not exists public.game_rooms (
  id uuid default gen_random_uuid() primary key,
  game_id text not null,
  host_id uuid references public.profiles(id) on delete cascade not null,
  room_name text not null,
  status text default 'waiting' check (status in ('waiting', 'playing', 'finished')),
  max_players integer default 4,
  is_public boolean default true,
  settings jsonb default '{}',
  created_at timestamptz default now()
);
alter table public.game_rooms enable row level security;
create policy "Anyone can view public rooms" on public.game_rooms
  for select using (is_public = true or host_id = auth.uid());
create policy "Auth users can create rooms" on public.game_rooms
  for insert with check (auth.uid() = host_id);
create policy "Host can update room" on public.game_rooms
  for update using (auth.uid() = host_id);
create policy "Host can delete room" on public.game_rooms
  for delete using (auth.uid() = host_id);

-- room_players: join table tracking who is in each room
create table if not exists public.room_players (
  room_id uuid references public.game_rooms(id) on delete cascade,
  player_id uuid references public.profiles(id) on delete cascade,
  is_host boolean default false,
  is_ready boolean default false,
  joined_at timestamptz default now(),
  primary key (room_id, player_id)
);
alter table public.room_players enable row level security;
create policy "Anyone can view room players" on public.room_players
  for select using (true);
create policy "Auth users can join rooms" on public.room_players
  for insert with check (auth.uid() = player_id);
create policy "Players can update own status" on public.room_players
  for update using (auth.uid() = player_id);
create policy "Players can leave" on public.room_players
  for delete using (auth.uid() = player_id);

-- game_stats: append-only log of completed game sessions
create table if not exists public.game_stats (
  id uuid default gen_random_uuid() primary key,
  player_id uuid references public.profiles(id) on delete cascade not null,
  game_id text not null,
  score integer default 0,
  won boolean default false,
  playtime_seconds integer default 0,
  extra jsonb default '{}',
  recorded_at timestamptz default now()
);
alter table public.game_stats enable row level security;
create policy "Anyone can view stats" on public.game_stats
  for select using (true);
create policy "Auth users can insert own stats" on public.game_stats
  for insert with check (auth.uid() = player_id);

-- leaderboards: aggregated view, no table needed
create or replace view public.leaderboards as
select
  p.id as player_id,
  p.username,
  p.display_name,
  p.avatar_url,
  gs.game_id,
  max(gs.score) as best_score,
  count(*) filter (where gs.won = true) as total_wins,
  count(*) as total_games,
  sum(gs.playtime_seconds) as total_playtime,
  rank() over (partition by gs.game_id order by max(gs.score) desc) as rank
from public.game_stats gs
join public.profiles p on p.id = gs.player_id
group by p.id, p.username, p.display_name, p.avatar_url, gs.game_id;

-- Enable realtime for room tables
alter publication supabase_realtime add table public.game_rooms;
alter publication supabase_realtime add table public.room_players;
```

- [ ] **Step 3: Run migration in Supabase**

> **User action required:** Go to your Supabase project → SQL Editor → paste the full contents of `games/migration.sql` → click Run. You should see "Success. No rows returned."

- [ ] **Step 4: Commit**

```bash
git add games/nexus-config.js games/migration.sql
git commit -m "feat: add Supabase config and database migration"
```

---

## Task 2: Create nexus-auth.js

**Files:**
- Create: `games/nexus-auth.js`

- [ ] **Step 1: Create the file**

Create `games/nexus-auth.js` with:

```js
(function () {
  const SUPABASE_CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js';

  function loadSupabase(cb) {
    if (window.supabase) { cb(); return; }
    const s = document.createElement('script');
    s.src = SUPABASE_CDN;
    s.onload = cb;
    document.head.appendChild(s);
  }

  let _client = null;

  window.NexusAuth = {
    _ready: new Promise(resolve => {
      loadSupabase(() => {
        _client = window.supabase.createClient(
          window.NEXUS_SUPABASE_URL,
          window.NEXUS_SUPABASE_ANON_KEY
        );
        resolve();
      });
    }),

    getClient() { return _client; },

    async getSession() {
      await this._ready;
      const { data } = await _client.auth.getSession();
      return data.session;
    },

    async getUser() {
      const session = await this.getSession();
      return session ? session.user : null;
    },

    async getProfile() {
      await this._ready;
      const user = await this.getUser();
      if (!user) return null;
      const { data } = await _client
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();
      return data;
    },

    async requireAuth() {
      const user = await this.getUser();
      if (!user) {
        const returnTo = encodeURIComponent(window.location.href);
        window.location.href = '/login.html?returnTo=' + returnTo;
        return null;
      }
      return user;
    },

    async signOut() {
      await this._ready;
      await _client.auth.signOut();
      window.location.href = '/login.html';
    },

    onAuthChange(callback) {
      this._ready.then(() => {
        _client.auth.onAuthStateChange((_event, session) => {
          callback(session ? session.user : null);
        });
      });
    }
  };
})();
```

- [ ] **Step 2: Verify manually**

Open any HTML file that loads `nexus-config.js` and `nexus-auth.js` in a browser. Open DevTools console and run:

```js
await NexusAuth.getUser()
```

Expected: `null` (not signed in yet — that's correct).

- [ ] **Step 3: Commit**

```bash
git add games/nexus-auth.js
git commit -m "feat: add NexusAuth module with Supabase session management"
```

---

## Task 3: Create login.html

**Files:**
- Create: `login.html` (at project root, same level as `index.html`)

- [ ] **Step 1: Create the file**

Create `login.html` with:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>NEXUS — Sign In</title>
  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>
  <script src="/games/nexus-config.js"></script>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      min-height: 100vh;
      background: #06040f;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: 'Segoe UI', system-ui, sans-serif;
      color: #f1f5f9;
    }
    .card {
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 16px;
      padding: 40px 32px;
      width: 100%;
      max-width: 400px;
    }
    .logo {
      text-align: center;
      margin-bottom: 32px;
    }
    .logo-text {
      font-size: 34px;
      font-weight: 900;
      letter-spacing: 4px;
      background: linear-gradient(135deg, #06b6d4, #7c3aed);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .logo-sub {
      color: #64748b;
      font-size: 13px;
      margin-top: 6px;
    }
    .oauth-btn {
      display: flex;
      align-items: center;
      gap: 12px;
      width: 100%;
      padding: 12px 16px;
      border-radius: 10px;
      border: 1px solid rgba(255,255,255,0.12);
      background: rgba(255,255,255,0.06);
      color: #f1f5f9;
      font-size: 14px;
      cursor: pointer;
      margin-bottom: 10px;
      transition: background 0.15s;
    }
    .oauth-btn:hover { background: rgba(255,255,255,0.1); }
    .oauth-btn.discord {
      border-color: rgba(88,101,242,0.4);
      background: rgba(88,101,242,0.12);
    }
    .divider {
      display: flex;
      align-items: center;
      gap: 12px;
      margin: 20px 0;
      color: #475569;
      font-size: 12px;
    }
    .divider::before, .divider::after {
      content: '';
      flex: 1;
      height: 1px;
      background: rgba(255,255,255,0.08);
    }
    input {
      width: 100%;
      padding: 11px 14px;
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 8px;
      color: #f1f5f9;
      font-size: 14px;
      margin-bottom: 10px;
    }
    input:focus { outline: none; border-color: rgba(6,182,212,0.5); }
    input::placeholder { color: #475569; }
    .submit-btn {
      width: 100%;
      padding: 12px;
      background: linear-gradient(135deg, #06b6d4, #7c3aed);
      border: none;
      border-radius: 8px;
      color: #fff;
      font-size: 14px;
      font-weight: 700;
      letter-spacing: 0.5px;
      cursor: pointer;
      margin-top: 4px;
    }
    .toggle-link {
      text-align: center;
      font-size: 12px;
      color: #475569;
      margin-top: 12px;
    }
    .toggle-link span { color: #06b6d4; cursor: pointer; }
    .guest-link {
      text-align: center;
      margin-top: 20px;
      font-size: 12px;
      color: #475569;
      cursor: pointer;
    }
    .guest-link:hover { color: #94a3b8; }
    .msg {
      padding: 10px 14px;
      border-radius: 8px;
      font-size: 13px;
      margin-bottom: 14px;
      display: none;
    }
    .msg.error { background: rgba(239,68,68,0.15); border: 1px solid rgba(239,68,68,0.3); color: #fca5a5; }
    .msg.info  { background: rgba(6,182,212,0.12); border: 1px solid rgba(6,182,212,0.3); color: #67e8f9; }
  </style>
</head>
<body>
<div class="card">
  <div class="logo">
    <div class="logo-text">NEXUS</div>
    <div class="logo-sub">Sign in to save progress and play online</div>
  </div>

  <div id="msg" class="msg"></div>

  <button class="oauth-btn" onclick="signInWith('google')">
    <svg width="18" height="18" viewBox="0 0 24 24">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
    </svg>
    Continue with Google
  </button>

  <button class="oauth-btn discord" onclick="signInWith('discord')">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="#5865F2">
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057c.003.02.015.039.031.048a19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z"/>
    </svg>
    Continue with Discord
  </button>

  <div class="divider">or use email</div>

  <input type="email" id="email" placeholder="Email address" />
  <input type="password" id="password" placeholder="Password" />
  <button class="submit-btn" id="submitBtn" onclick="submitEmail()">SIGN IN</button>

  <div class="toggle-link">
    <span id="toggleText">Don't have an account? </span>
    <span onclick="toggleMode()"><span id="toggleAction">Sign up</span></span>
  </div>

  <div class="guest-link" onclick="continueAsGuest()">Continue as guest →</div>
</div>

<script>
  const _sb = supabase.createClient(window.NEXUS_SUPABASE_URL, window.NEXUS_SUPABASE_ANON_KEY);
  let _mode = 'signin';

  // If already signed in, redirect immediately
  _sb.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_IN' && session) {
      const returnTo = localStorage.getItem('nexus_return_to') ||
        new URLSearchParams(window.location.search).get('returnTo') ||
        '/index.html';
      localStorage.removeItem('nexus_return_to');
      window.location.href = returnTo;
    }
  });

  function showMsg(text, type) {
    const el = document.getElementById('msg');
    el.textContent = text;
    el.className = 'msg ' + type;
    el.style.display = 'block';
  }

  async function signInWith(provider) {
    const returnTo = new URLSearchParams(window.location.search).get('returnTo') || '/index.html';
    localStorage.setItem('nexus_return_to', returnTo);
    const { error } = await _sb.auth.signInWithOAuth({
      provider,
      options: { redirectTo: window.location.origin + '/login.html' }
    });
    if (error) showMsg(error.message, 'error');
  }

  async function submitEmail() {
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    if (!email || !password) { showMsg('Enter email and password.', 'error'); return; }

    if (_mode === 'signin') {
      const { error } = await _sb.auth.signInWithPassword({ email, password });
      if (error) { showMsg(error.message, 'error'); return; }
    } else {
      const { error } = await _sb.auth.signUp({ email, password });
      if (error) { showMsg(error.message, 'error'); return; }
      showMsg('Check your email to confirm your account, then sign in.', 'info');
      toggleMode();
      return;
    }
    // onAuthStateChange handles redirect
  }

  async function continueAsGuest() {
    const { error } = await _sb.auth.signInAnonymously();
    if (error) { showMsg(error.message, 'error'); return; }
    // onAuthStateChange handles redirect
  }

  function toggleMode() {
    _mode = _mode === 'signin' ? 'signup' : 'signin';
    document.getElementById('submitBtn').textContent = _mode === 'signin' ? 'SIGN IN' : 'CREATE ACCOUNT';
    document.getElementById('toggleText').textContent = _mode === 'signin' ? "Don't have an account? " : 'Already have an account? ';
    document.getElementById('toggleAction').textContent = _mode === 'signin' ? 'Sign up' : 'Sign in';
  }
</script>
</body>
</html>
```

- [ ] **Step 2: Enable auth providers in Supabase**

> **User action required:**  
> In Supabase dashboard → Authentication → Providers:
> - Enable **Email** (already on by default — confirm "Enable Email provider" is checked)
> - Enable **Google**: create OAuth credentials at console.cloud.google.com → paste Client ID + Secret
> - Enable **Discord**: create app at discord.com/developers → OAuth2 → paste Client ID + Secret  
> In Supabase → Authentication → URL Configuration → add `http://localhost:PORT` (your local server port) to "Redirect URLs"

- [ ] **Step 3: Open login.html in browser and verify**

Open `login.html` directly. You should see the Nexus sign-in card with Google, Discord, Email form, and guest link. No console errors.

- [ ] **Step 4: Commit**

```bash
git add login.html
git commit -m "feat: add login page with Google, Discord, and email auth"
```

---

## Task 4: Create nexus-db.js

**Files:**
- Create: `games/nexus-db.js`

- [ ] **Step 1: Create the file**

Create `games/nexus-db.js` with:

```js
(function () {
  window.NexusDB = {
    async saveStats(gameId, { score = 0, won = false, playtime_seconds = 0, extra = {} } = {}) {
      await NexusAuth._ready;
      const user = await NexusAuth.getUser();
      if (!user) return null;

      const client = NexusAuth.getClient();
      const { error } = await client
        .from('game_stats')
        .insert({ player_id: user.id, game_id: gameId, score, won, playtime_seconds, extra });

      if (!error) {
        const xpGained = Math.floor(score / 100) + (won ? 50 : 10);
        const { data: profile } = await client
          .from('profiles').select('xp').eq('id', user.id).single();
        const newXp = (profile?.xp || 0) + xpGained;
        const newLevel = Math.floor(newXp / 1000) + 1;
        await client
          .from('profiles')
          .update({ xp: newXp, level: newLevel })
          .eq('id', user.id);
      }
      return !error;
    },

    async getLeaderboard(gameId, limit = 10) {
      await NexusAuth._ready;
      const { data } = await NexusAuth.getClient()
        .from('leaderboards')
        .select('*')
        .eq('game_id', gameId)
        .order('best_score', { ascending: false })
        .limit(limit);
      return data || [];
    },

    async getMyStats(gameId) {
      await NexusAuth._ready;
      const user = await NexusAuth.getUser();
      if (!user) return null;
      const { data } = await NexusAuth.getClient()
        .from('leaderboards')
        .select('*')
        .eq('game_id', gameId)
        .eq('player_id', user.id)
        .maybeSingle();
      return data;
    },

    async getProfile() {
      return NexusAuth.getProfile();
    },

    async updateProfile({ display_name, avatar_url } = {}) {
      await NexusAuth._ready;
      const user = await NexusAuth.getUser();
      if (!user) return null;
      const updates = {};
      if (display_name !== undefined) updates.display_name = display_name;
      if (avatar_url !== undefined) updates.avatar_url = avatar_url;
      const { data } = await NexusAuth.getClient()
        .from('profiles')
        .update(updates)
        .eq('id', user.id)
        .select()
        .single();
      return data;
    }
  };
})();
```

- [ ] **Step 2: Verify manually**

In a browser console (on a page that loads `nexus-auth.js` and `nexus-db.js`), after signing in:

```js
await NexusDB.getLeaderboard('spirit-chase', 5)
```

Expected: empty array `[]` (no stats yet — that's correct).

- [ ] **Step 3: Commit**

```bash
git add games/nexus-db.js
git commit -m "feat: add NexusDB module for stats, leaderboards, and profiles"
```

---

## Task 5: Create nexus-cloud.js

**Files:**
- Create: `games/nexus-cloud.js`

- [ ] **Step 1: Create the file**

Create `games/nexus-cloud.js` with:

```js
(function () {
  let _roomId = null;
  let _broadcastChannel = null;
  let _presenceChannel = null;
  let _listeners = {};
  let _playerJoinCb = null;
  let _playerLeaveCb = null;

  const NexusCloud = {
    players: new Map(),
    isHost: false,
    roomId: null,

    async listRooms(gameId) {
      await NexusAuth._ready;
      const { data } = await NexusAuth.getClient()
        .from('game_rooms')
        .select('id, room_name, max_players, settings, created_at, profiles!host_id(display_name), room_players(count)')
        .eq('game_id', gameId)
        .eq('status', 'waiting')
        .eq('is_public', true)
        .order('created_at', { ascending: false });
      return data || [];
    },

    async createRoom(gameId, roomName, maxPlayers, settings) {
      await NexusAuth._ready;
      const user = await NexusAuth.requireAuth();
      if (!user) return null;
      const profile = await NexusAuth.getProfile();

      const { data: room, error } = await NexusAuth.getClient()
        .from('game_rooms')
        .insert({ game_id: gameId, host_id: user.id, room_name: roomName || profile.display_name + "'s room", max_players: maxPlayers || 4, settings: settings || {} })
        .select()
        .single();
      if (error) throw error;

      await NexusAuth.getClient()
        .from('room_players')
        .insert({ room_id: room.id, player_id: user.id, is_host: true });

      _roomId = room.id;
      this.roomId = room.id;
      this.isHost = true;
      this.players.set(user.id, { id: user.id, name: profile.display_name, isHost: true });
      await this._subscribe(room.id);
      return room;
    },

    async joinRoom(roomId) {
      await NexusAuth._ready;
      const user = await NexusAuth.requireAuth();
      if (!user) return null;
      const profile = await NexusAuth.getProfile();

      const { error } = await NexusAuth.getClient()
        .from('room_players')
        .insert({ room_id: roomId, player_id: user.id, is_host: false });
      if (error) throw error;

      _roomId = roomId;
      this.roomId = roomId;
      this.isHost = false;

      const { data: rows } = await NexusAuth.getClient()
        .from('room_players')
        .select('player_id, is_host, profiles(id, display_name)')
        .eq('room_id', roomId);
      this.players.clear();
      for (const rp of rows || []) {
        this.players.set(rp.player_id, { id: rp.player_id, name: rp.profiles.display_name, isHost: rp.is_host });
      }
      await this._subscribe(roomId);
      return { roomId };
    },

    async _subscribe(roomId) {
      const client = NexusAuth.getClient();

      _presenceChannel = client
        .channel('room-db-' + roomId)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'room_players', filter: 'room_id=eq.' + roomId },
          async ({ new: row }) => {
            const { data: p } = await client.from('profiles').select('*').eq('id', row.player_id).single();
            const player = { id: row.player_id, name: p.display_name, isHost: row.is_host };
            this.players.set(player.id, player);
            if (_playerJoinCb) _playerJoinCb(player.id, player);
          })
        .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'room_players', filter: 'room_id=eq.' + roomId },
          ({ old: row }) => {
            const player = this.players.get(row.player_id);
            this.players.delete(row.player_id);
            if (_playerLeaveCb && player) _playerLeaveCb(player.id, player);
          })
        .subscribe();

      _broadcastChannel = client
        .channel('game-bc-' + roomId)
        .on('broadcast', { event: 'msg' }, ({ payload }) => {
          const cb = _listeners[payload._ch];
          if (cb) cb(payload._data, payload._from);
        })
        .subscribe();
    },

    send(channel, data) {
      if (!_broadcastChannel) return;
      NexusAuth.getUser().then(user => {
        _broadcastChannel.send({
          type: 'broadcast',
          event: 'msg',
          payload: { _ch: channel, _data: data, _from: user?.id }
        });
      });
    },

    on(channel, callback)    { _listeners[channel] = callback; },
    off(channel)             { delete _listeners[channel]; },
    onPlayerJoin(callback)   { _playerJoinCb = callback; },
    onPlayerLeave(callback)  { _playerLeaveCb = callback; },

    async leave() {
      const user = await NexusAuth.getUser();
      const client = NexusAuth.getClient();
      if (_roomId && user) {
        await client.from('room_players').delete().eq('room_id', _roomId).eq('player_id', user.id);
        if (this.isHost) {
          await client.from('game_rooms').update({ status: 'finished' }).eq('id', _roomId);
        }
      }
      if (_broadcastChannel) { client.removeChannel(_broadcastChannel); _broadcastChannel = null; }
      if (_presenceChannel)  { client.removeChannel(_presenceChannel);  _presenceChannel = null; }
      _roomId = null;
      this.roomId = null;
      this.isHost = false;
      this.players.clear();
      _listeners = {};
    }
  };

  window.NexusCloud = NexusCloud;
})();
```

- [ ] **Step 2: Verify manually**

In browser console (after signing in on any page with auth + cloud scripts):

```js
const rooms = await NexusCloud.listRooms('test-game')
console.log(rooms)  // Expected: []
```

- [ ] **Step 3: Commit**

```bash
git add games/nexus-cloud.js
git commit -m "feat: add NexusCloud module replacing PeerJS with Supabase Realtime"
```

---

## Task 6: Rewrite multiplayer-lobby.html

**Files:**
- Modify: `games/multiplayer-lobby.html`

The lobby receives `?game=spirit-chase` and an optional `?returnTo=/games/spirit-chase/index.html` in the URL. After creating or joining a room it navigates to `returnTo?room=<id>&host=true/false`.

- [ ] **Step 1: Replace the entire file**

Replace the full contents of `games/multiplayer-lobby.html` with:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>NEXUS — Lobby</title>
  <script src="nexus-config.js"></script>
  <script src="nexus-auth.js"></script>
  <script src="nexus-cloud.js"></script>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #06040f; color: #f1f5f9; font-family: 'Segoe UI', system-ui, sans-serif; min-height: 100vh; padding: 24px; }
    header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 28px; }
    .back-btn { background: none; border: 1px solid rgba(255,255,255,0.12); color: #94a3b8; padding: 8px 16px; border-radius: 8px; cursor: pointer; font-size: 13px; }
    .back-btn:hover { border-color: rgba(255,255,255,0.25); color: #f1f5f9; }
    .user-pill { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.08); border-radius: 20px; padding: 6px 14px; font-size: 13px; color: #94a3b8; }
    .user-pill span { color: #06b6d4; }
    h1 { font-size: 22px; font-weight: 800; margin-bottom: 6px; }
    .subtitle { color: #64748b; font-size: 13px; margin-bottom: 24px; }
    .create-bar { display: flex; gap: 10px; margin-bottom: 28px; }
    .create-bar input { flex: 1; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; padding: 10px 14px; color: #f1f5f9; font-size: 14px; }
    .create-bar input:focus { outline: none; border-color: rgba(6,182,212,0.5); }
    .create-bar input::placeholder { color: #475569; }
    .create-btn { background: linear-gradient(135deg, #06b6d4, #7c3aed); border: none; border-radius: 8px; padding: 10px 20px; color: #fff; font-size: 14px; font-weight: 700; cursor: pointer; white-space: nowrap; }
    .section-label { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #475569; margin-bottom: 12px; }
    .room-list { display: flex; flex-direction: column; gap: 8px; }
    .room-card { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; padding: 14px 16px; display: flex; justify-content: space-between; align-items: center; transition: border-color 0.15s; }
    .room-card:hover { border-color: rgba(6,182,212,0.25); }
    .room-card.full { opacity: 0.45; }
    .room-info h3 { font-size: 14px; font-weight: 700; margin-bottom: 4px; }
    .room-info p  { font-size: 12px; color: #64748b; }
    .join-btn { background: rgba(6,182,212,0.12); border: 1px solid rgba(6,182,212,0.35); border-radius: 7px; padding: 7px 16px; color: #06b6d4; font-size: 13px; font-weight: 600; cursor: pointer; }
    .join-btn:hover { background: rgba(6,182,212,0.2); }
    .empty { color: #475569; font-size: 14px; padding: 24px 0; text-align: center; }
    .loading { color: #475569; font-size: 13px; padding: 16px 0; }
  </style>
</head>
<body>
<header>
  <button class="back-btn" onclick="goBack()">← Back</button>
  <div class="user-pill">Playing as <span id="userName">...</span></div>
</header>

<h1 id="pageTitle">Multiplayer Lobby</h1>
<p class="subtitle" id="pageSubtitle">Browse open rooms or create your own</p>

<div class="create-bar">
  <input type="text" id="roomNameInput" placeholder="Room name (optional)" maxlength="40" />
  <button class="create-btn" onclick="createRoom()">+ Create Room</button>
</div>

<div class="section-label">Open Rooms</div>
<div class="room-list" id="roomList"><p class="loading">Loading rooms...</p></div>

<script>
  const params  = new URLSearchParams(window.location.search);
  const gameId  = params.get('game') || 'unknown';
  const returnTo = params.get('returnTo') || '/index.html';

  const GAME_LABELS = {
    'hunters': 'Jujutsu Hunters',
    'spirit-chase': 'Spirit Chase',
    'domain-defender': 'Domain Defender',
    'culling-colony': 'Culling Colony',
    'cursed-arena': 'Cursed Arena'
  };

  document.getElementById('pageTitle').textContent = (GAME_LABELS[gameId] || gameId) + ' — Lobby';

  function goBack() { window.location.href = returnTo; }

  async function init() {
    const user = await NexusAuth.requireAuth();
    if (!user) return;
    const profile = await NexusAuth.getProfile();
    document.getElementById('userName').textContent = profile?.display_name || 'Player';
    loadRooms();
    // Refresh every 5 seconds
    setInterval(loadRooms, 5000);
  }

  async function loadRooms() {
    const rooms = await NexusCloud.listRooms(gameId);
    const list = document.getElementById('roomList');
    if (!rooms.length) {
      list.innerHTML = '<p class="empty">No open rooms — be the first to create one!</p>';
      return;
    }
    list.innerHTML = rooms.map(r => {
      const playerCount = r.room_players?.[0]?.count || 1;
      const full = playerCount >= r.max_players;
      return `<div class="room-card ${full ? 'full' : ''}">
        <div class="room-info">
          <h3>${escHtml(r.room_name)}</h3>
          <p>Host: ${escHtml(r.profiles?.display_name || '?')} &middot; ${playerCount}/${r.max_players} players</p>
        </div>
        ${full
          ? '<button class="join-btn" style="opacity:0.4;cursor:default">Full</button>'
          : `<button class="join-btn" onclick="joinRoom('${r.id}')">Join</button>`}
      </div>`;
    }).join('');
  }

  async function createRoom() {
    const name = document.getElementById('roomNameInput').value.trim();
    const room = await NexusCloud.createRoom(gameId, name || null, 4, {});
    if (room) {
      window.location.href = returnTo + '?room=' + room.id + '&host=true';
    }
  }

  async function joinRoom(roomId) {
    await NexusCloud.joinRoom(roomId);
    window.location.href = returnTo + '?room=' + roomId;
  }

  function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  init();
</script>
</body>
</html>
```

- [ ] **Step 2: Verify**

Open `games/multiplayer-lobby.html?game=spirit-chase&returnTo=/games/spirit-chase/index.html` in a browser. You should see the lobby UI with the create bar and "No open rooms" message. The page title should read "Spirit Chase — Lobby".

- [ ] **Step 3: Commit**

```bash
git add games/multiplayer-lobby.html
git commit -m "feat: rewrite multiplayer lobby with cloud room browser"
```

---

## Task 7: Update index.html — auth header and leaderboard

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Add Supabase scripts to index.html**

Find the closing `</body>` tag in `index.html`. Just before it, add:

```html
  <script src="/games/nexus-config.js"></script>
  <script src="/games/nexus-auth.js"></script>
  <script src="/games/nexus-db.js"></script>
  <script>
    NexusAuth._ready.then(async () => {
      const profile = await NexusAuth.getProfile();
      if (profile) {
        const avatarEl = document.querySelector('.user-avatar, .avatar, [data-role="avatar"]');
        const nameEl   = document.querySelector('.user-name, .username, [data-role="username"]');
        if (avatarEl && profile.avatar_url) avatarEl.src = profile.avatar_url;
        if (nameEl) nameEl.textContent = profile.display_name;
        // Update sign-in/out button if present
        const signBtn = document.querySelector('[data-role="auth-btn"]');
        if (signBtn) {
          signBtn.textContent = 'SIGN OUT';
          signBtn.onclick = () => NexusAuth.signOut();
        }
      }
    });
  </script>
```

- [ ] **Step 2: Add `data-role` to the existing auth button in index.html**

Find the "PLAY NOW" button (or sign-in button) in the header nav. Add `data-role="auth-btn"` to it:

```html
<button class="nav-btn" data-role="auth-btn" onclick="window.location.href='/login.html'">PLAY NOW</button>
```

> The exact element may differ — search `index.html` for the header button and add the `data-role` attribute.

- [ ] **Step 3: Verify**

Open `index.html` while signed in. The header should show your display name. Open while signed out — button should say "PLAY NOW" and link to login.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: show signed-in user info in index.html header"
```

---

## Task 8: Update profile.html — real account data

**Files:**
- Modify: `profile.html`

- [ ] **Step 1: Add scripts to profile.html**

Find the closing `</body>` tag in `profile.html`. Just before it, add:

```html
  <script src="/games/nexus-config.js"></script>
  <script src="/games/nexus-auth.js"></script>
  <script src="/games/nexus-db.js"></script>
  <script>
    const GAME_IDS = ['hunters', 'spirit-chase', 'domain-defender', 'culling-colony', 'cursed-arena'];

    NexusAuth._ready.then(async () => {
      const user = await NexusAuth.requireAuth();
      if (!user) return;
      const profile = await NexusAuth.getProfile();

      // Populate any name/avatar elements
      document.querySelectorAll('[data-profile="name"]').forEach(el => {
        el.textContent = profile.display_name || profile.username;
      });
      document.querySelectorAll('[data-profile="avatar"]').forEach(el => {
        if (profile.avatar_url) el.src = profile.avatar_url;
      });
      document.querySelectorAll('[data-profile="level"]').forEach(el => {
        el.textContent = 'Level ' + profile.level;
      });
      document.querySelectorAll('[data-profile="xp"]').forEach(el => {
        el.textContent = profile.xp + ' XP';
      });

      // Load per-game stats
      const statsContainer = document.getElementById('nexus-stats-grid');
      if (statsContainer) {
        statsContainer.innerHTML = '';
        for (const gid of GAME_IDS) {
          const stats = await NexusDB.getMyStats(gid);
          const card = document.createElement('div');
          card.className = 'stat-card';
          card.innerHTML = `
            <div class="stat-game">${gid.replace(/-/g,' ').replace(/\b\w/g,c=>c.toUpperCase())}</div>
            <div class="stat-row">Best Score <strong>${stats?.best_score ?? '—'}</strong></div>
            <div class="stat-row">Wins <strong>${stats?.total_wins ?? '—'}</strong></div>
            <div class="stat-row">Games <strong>${stats?.total_games ?? '—'}</strong></div>
          `;
          statsContainer.appendChild(card);
        }
      }
    });
  </script>
```

- [ ] **Step 2: Add `data-profile` attributes and stats container to profile.html**

Find the existing profile name, avatar, and stats elements in `profile.html` and add the corresponding `data-profile` attributes. Then add a stats grid div where it makes sense:

```html
<!-- Add inside the profile stats section -->
<div id="nexus-stats-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:14px;margin-top:16px"></div>
```

Add minimal CSS for `.stat-card` and `.stat-row` if not already styled:

```html
<style>
.stat-card { background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08); border-radius:10px; padding:14px; }
.stat-game { font-size:11px; text-transform:uppercase; letter-spacing:1px; color:#06b6d4; margin-bottom:8px; }
.stat-row  { font-size:13px; color:#94a3b8; display:flex; justify-content:space-between; margin-bottom:4px; }
.stat-row strong { color:#f1f5f9; }
</style>
```

- [ ] **Step 3: Verify**

Open `profile.html` while signed in. Stats grid should appear (empty `—` values until games are played).

- [ ] **Step 4: Commit**

```bash
git add profile.html
git commit -m "feat: populate profile.html from Supabase account data and stats"
```

---

## Task 9: Integrate Spirit Chase

**Files:**
- Modify: `games/spirit-chase/index.html`

Spirit Chase uses NexusMP at lines 1495–1496 (script tags), 1501 (GAME_ID), 1633 (init), 1661 (join), 1695–1701 (send position), 1608–1645 (on/send handlers). Game end fires at `winRound()` line 926 and `endGame()` line 949.

- [ ] **Step 1: Replace script tags**

Find (near line 1495):
```html
<script src="../nexus-config.js"></script>
<script src="../nexus-mp.js"></script>
```

Replace with:
```html
<script src="../nexus-config.js"></script>
<script src="../nexus-auth.js"></script>
<script src="../nexus-cloud.js"></script>
<script src="../nexus-db.js"></script>
```

- [ ] **Step 2: Replace multiplayer init UI**

Find the section around lines 1620–1665 that shows the host/join modal and calls `NexusMP.init` / `NexusMP.join`. Replace those two call sites:

Find:
```js
const { roomCode } = await NexusMP.init(GAME_ID, name);
```
Replace with:
```js
const lobbyUrl = '/games/multiplayer-lobby.html?game=' + GAME_ID + '&returnTo=' + encodeURIComponent(window.location.pathname);
window.location.href = lobbyUrl;
return;
```

Find:
```js
await NexusMP.join(GAME_ID, code, name);
```
Replace with:
```js
// Join is now handled via lobby redirect — auto-join on page load below
```

- [ ] **Step 3: Add auto-join on page load**

After the `const GAME_ID = 'spirit-chase';` line (line 1501), add:

```js
// Auto-join room if redirected from lobby
(async function() {
  const roomId = new URLSearchParams(window.location.search).get('room');
  if (!roomId) return;
  const isHost = new URLSearchParams(window.location.search).get('host') === 'true';
  await NexusAuth._ready;
  if (isHost) {
    // Room already created in lobby — just subscribe
    await NexusCloud.joinRoom(roomId);
  } else {
    await NexusCloud.joinRoom(roomId);
  }
  mpActive = true;
  setupMPHandlers();
})();
```

- [ ] **Step 4: Replace all NexusMP references with NexusCloud**

In the multiplayer handlers section (lines ~1608–1735), replace every occurrence:

| Find | Replace |
|------|---------|
| `NexusMP.on(` | `NexusCloud.on(` |
| `NexusMP.send(` | `NexusCloud.send(` |
| `NexusMP.onPlayerJoin(` | `NexusCloud.onPlayerJoin(` |
| `NexusMP.onPlayerLeave(` | `NexusCloud.onPlayerLeave(` |
| `NexusMP.myId` | `(await NexusAuth.getUser())?.id` |
| `NexusMP.leave()` | `NexusCloud.leave()` |
| `NexusMP.players` | `NexusCloud.players` |
| `NexusMP.isHost` | `NexusCloud.isHost` |

- [ ] **Step 5: Save stats on game end**

Find the `winRound()` function (around line 926). At the beginning of the function body, add:

```js
if (mpActive) NexusDB.saveStats(GAME_ID, { score: score || 0, won: true, playtime_seconds: Math.round((performance.now() - gameStartTime) / 1000) });
```

Find the `endGame()` function (around line 949). At the beginning of the function body, add:

```js
if (mpActive) NexusDB.saveStats(GAME_ID, { score: score || 0, won: false, playtime_seconds: Math.round((performance.now() - gameStartTime) / 1000) });
```

> If `gameStartTime` doesn't exist, add `const gameStartTime = performance.now();` near the start of the game initialization.

- [ ] **Step 6: Verify**

1. Open `spirit-chase/index.html` directly — single-player should work unchanged.
2. Open `spirit-chase/index.html?room=fake-id` — should attempt join (will fail gracefully with console error — that's fine without a real room).
3. Lobby button should navigate to `multiplayer-lobby.html?game=spirit-chase`.

- [ ] **Step 7: Commit**

```bash
git add games/spirit-chase/index.html
git commit -m "feat: integrate Spirit Chase with NexusCloud multiplayer"
```

---

## Task 10: Integrate Domain Defender

**Files:**
- Modify: `games/domain-defender/index.html`

Domain Defender uses NexusMP at lines 1495–1496 (scripts), 781 (GAME_ID), 931 (init), 953 (join), 789–821 (send), 888–901 (on). Game end fires at `gameOver()` line 589 and `victory()` line 605.

- [ ] **Step 1: Replace script tags** (identical to Task 9 Step 1)

Find (near line 1495):
```html
<script src="../nexus-config.js"></script>
<script src="../nexus-mp.js"></script>
```
Replace with:
```html
<script src="../nexus-config.js"></script>
<script src="../nexus-auth.js"></script>
<script src="../nexus-cloud.js"></script>
<script src="../nexus-db.js"></script>
```

- [ ] **Step 2: Replace NexusMP.init call (line 931)**

Find:
```js
const { roomCode } = await NexusMP.init(GAME_ID, name);
```
Replace with:
```js
const lobbyUrl = '/games/multiplayer-lobby.html?game=' + GAME_ID + '&returnTo=' + encodeURIComponent(window.location.pathname);
window.location.href = lobbyUrl;
return;
```

Find (line 953):
```js
await NexusMP.join(GAME_ID, code, name);
```
Replace with: *(delete or comment out this line)*

- [ ] **Step 3: Add auto-join on page load**

After `const GAME_ID = 'domain-defender';` (line 781), add:

```js
(async function() {
  const roomId = new URLSearchParams(window.location.search).get('room');
  if (!roomId) return;
  await NexusAuth._ready;
  await NexusCloud.joinRoom(roomId);
  mpActive = true;
  setupMPHandlers();
})();
```

- [ ] **Step 4: Replace all NexusMP references** (same substitution table as Task 9 Step 4)

- [ ] **Step 5: Save stats on game end**

Find `gameOver()` (line 589). Add at the start of its body:

```js
if (mpActive) NexusDB.saveStats(GAME_ID, { score: score || 0, won: false, playtime_seconds: Math.round((performance.now() - gameStartTime) / 1000) });
```

Find `victory()` (line 605). Add at the start of its body:

```js
if (mpActive) NexusDB.saveStats(GAME_ID, { score: score || 0, won: true, playtime_seconds: Math.round((performance.now() - gameStartTime) / 1000) });
```

- [ ] **Step 6: Commit**

```bash
git add games/domain-defender/index.html
git commit -m "feat: integrate Domain Defender with NexusCloud multiplayer"
```

---

## Task 11: Integrate Culling Colony

**Files:**
- Modify: `games/culling-colony/index.html`

Culling Colony uses NexusMP at lines 1495–1496 (scripts), 1480 (GAME_ID), 1575 (init), 1597 (join), 1542–1664 (on/send). Game end fires at `showElimScreen()` line 1044 and `triggerWin()` line 1060.

- [ ] **Step 1: Replace script tags** (identical to prior tasks)

- [ ] **Step 2: Replace NexusMP.init call (line 1575)**

Find:
```js
const { roomCode } = await NexusMP.init(GAME_ID, name);
```
Replace with:
```js
const lobbyUrl = '/games/multiplayer-lobby.html?game=' + GAME_ID + '&returnTo=' + encodeURIComponent(window.location.pathname);
window.location.href = lobbyUrl;
return;
```

Delete the `NexusMP.join` call at line 1597.

- [ ] **Step 3: Add auto-join on page load**

After `const GAME_ID = 'culling-colony';` (line 1480), add:

```js
(async function() {
  const roomId = new URLSearchParams(window.location.search).get('room');
  if (!roomId) return;
  await NexusAuth._ready;
  await NexusCloud.joinRoom(roomId);
  mpActive = true;
  setupMPHandlers();
})();
```

- [ ] **Step 4: Replace all NexusMP references** (same table as Task 9 Step 4)

- [ ] **Step 5: Save stats on game end**

Find `showElimScreen()` (line 1044). Add at the start:

```js
NexusDB.saveStats(GAME_ID, { score: G.kills || 0, won: false, playtime_seconds: Math.round((performance.now() - G.startTime) / 1000), extra: { kills: G.kills } });
```

Find `triggerWin()` (line 1060). Add at the start:

```js
NexusDB.saveStats(GAME_ID, { score: G.kills || 0, won: true, playtime_seconds: Math.round((performance.now() - G.startTime) / 1000), extra: { kills: G.kills } });
```

- [ ] **Step 6: Commit**

```bash
git add games/culling-colony/index.html
git commit -m "feat: integrate Culling Colony with NexusCloud multiplayer"
```

---

## Task 12: Integrate Cursed Arena

**Files:**
- Modify: `games/cursed-arena/index.html`

Cursed Arena uses NexusMP at lines 1495–1496 (scripts), 1050 (GAME_ID), 1179 (init), 1201 (join), 1062–1220 (on/send). Game end fires at `gameOver()` line 747 and `victory()` line 763.

- [ ] **Step 1: Replace script tags** (identical to prior tasks)

- [ ] **Step 2: Replace NexusMP.init (line 1179)**

Find:
```js
const { roomCode } = await NexusMP.init(GAME_ID, name);
```
Replace with:
```js
const lobbyUrl = '/games/multiplayer-lobby.html?game=' + GAME_ID + '&returnTo=' + encodeURIComponent(window.location.pathname);
window.location.href = lobbyUrl;
return;
```

Delete the `NexusMP.join` call at line 1201.

- [ ] **Step 3: Add auto-join on page load**

After `const GAME_ID = 'cursed-arena';` (line 1050), add:

```js
(async function() {
  const roomId = new URLSearchParams(window.location.search).get('room');
  if (!roomId) return;
  await NexusAuth._ready;
  await NexusCloud.joinRoom(roomId);
  mpActive = true;
  setupMPHandlers();
})();
```

- [ ] **Step 4: Replace all NexusMP references** (same table as Task 9 Step 4)

- [ ] **Step 5: Save stats on game end**

Find `gameOver()` (line 747). Add at the start:

```js
if (mpActive) NexusDB.saveStats(GAME_ID, { score: score || 0, won: false, playtime_seconds: Math.round((performance.now() - gameStartTime) / 1000) });
```

Find `victory()` (line 763). Add at the start:

```js
if (mpActive) NexusDB.saveStats(GAME_ID, { score: score || 0, won: true, playtime_seconds: Math.round((performance.now() - gameStartTime) / 1000) });
```

- [ ] **Step 6: Commit**

```bash
git add games/cursed-arena/index.html
git commit -m "feat: integrate Cursed Arena with NexusCloud multiplayer"
```

---

## Task 13: Integrate Jujutsu Hunters

**Files:**
- Modify: `games/jujutsuhunters/hunters.html`

Hunters has its own custom auth system (login/register API endpoints) in addition to NexusMP. Both are replaced. NexusMP is at line 2591 (script), 2695 (init), 2717 (join), 2667–2685 (on/send), 2673/2680 (player join/leave).

- [ ] **Step 1: Replace nexus-mp.js script tag (line 2591)**

Find:
```html
<script src="../nexus-mp.js"></script>
```
Replace with:
```html
<script src="../nexus-auth.js"></script>
<script src="../nexus-cloud.js"></script>
<script src="../nexus-db.js"></script>
```

- [ ] **Step 2: Replace NexusMP.init (line 2695)**

Find:
```js
const { roomCode } = await NexusMP.init(GAME_ID, name);
```
Replace with:
```js
const lobbyUrl = '/games/multiplayer-lobby.html?game=' + GAME_ID + '&returnTo=' + encodeURIComponent(window.location.pathname);
window.location.href = lobbyUrl;
return;
```

Delete the `NexusMP.join` call at line 2717.

- [ ] **Step 3: Add auto-join on page load**

Find `const GAME_ID` in hunters.html and add after it:

```js
(async function() {
  const roomId = new URLSearchParams(window.location.search).get('room');
  if (!roomId) return;
  await NexusAuth._ready;
  await NexusCloud.joinRoom(roomId);
  mpActive = true;
  setupMPHandlers();
  // Pre-fill player name from Supabase profile
  const profile = await NexusAuth.getProfile();
  if (profile) window.NEXUS_PLAYER_NAME = profile.display_name;
})();
```

- [ ] **Step 4: Replace all NexusMP references** (same table as Task 9 Step 4)

- [ ] **Step 5: Remove or bypass the custom login gate in hunters.html**

Search for any inline login form or `fetch('/api/auth/login')` calls in hunters.html. Replace the login gate check with:

```js
const user = await NexusAuth.requireAuth();
if (!user) return; // redirected to login.html
const profile = await NexusAuth.getProfile();
// Use profile.display_name wherever playerName was used
```

- [ ] **Step 6: Commit**

```bash
git add games/jujutsuhunters/hunters.html
git commit -m "feat: integrate Jujutsu Hunters with NexusCloud and replace custom auth"
```

---

## End-to-End Verification

- [ ] Open `login.html` — sign in with Google. Session persists on refresh. ✓
- [ ] Open `games/spirit-chase/index.html` unsigned — redirected to login. ✓ (single-player works without redirect)
- [ ] Open `games/multiplayer-lobby.html?game=spirit-chase&returnTo=/games/spirit-chase/index.html` — shows lobby, create button works.
- [ ] Player A creates room → navigated to spirit-chase with `?room=<id>&host=true`.
- [ ] Player B opens same lobby → sees Player A's room → clicks Join → navigated to spirit-chase with `?room=<id>`.
- [ ] Both see each other in `NexusCloud.players`. Game sync (ghost position) works.
- [ ] Complete a game → check Supabase dashboard → `game_stats` table has a new row.
- [ ] Open lobby again → leaderboard row appears for completed game.
- [ ] Open `profile.html` → stats grid shows games played.
- [ ] Repeat for Domain Defender, Culling Colony, Cursed Arena, Hunters.
