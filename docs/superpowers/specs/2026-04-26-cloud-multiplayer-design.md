# Nexus Cloud Multiplayer — Design Spec
**Date:** 2026-04-26  
**Status:** Approved

## Context

Nexus currently uses PeerJS WebRTC P2P for multiplayer (`nexus-mp.js`). Players connect directly to each other using manually shared 6-character room codes. There are no real accounts — just display names stored in localStorage. This creates a poor experience: no room discovery, no persistent progress, no leaderboards, and no identity across games.

This spec replaces the P2P layer with a Supabase-powered cloud backend that gives every player a real account, persistent sessions, one-click lobby browsing, stat tracking, and leaderboards — across all five active games simultaneously.

---

## Goals

- Players create accounts once and stay logged in permanently across all games
- Three sign-in methods: Google, Discord, Email/Password
- Replace manual room codes with live browsable cloud lobbies (one-click join)
- Save per-game stats and progress to the cloud
- Global and per-game leaderboards visible in every lobby
- All five games upgraded: Jujutsu Hunters, Spirit Chase, Domain Defender, Culling Colony, Cursed Arena

---

## Architecture

Three Supabase services do all the work — no server to deploy or maintain:

| Layer | Service | Purpose |
|-------|---------|---------|
| Auth | Supabase Auth | Google, Discord, Email sign-in; persistent sessions via localStorage |
| Realtime | Supabase Realtime | Live game room list, player join/leave events, in-game state broadcast |
| Database | Supabase PostgreSQL | Profiles, stats, leaderboards |

### New files

| File | Purpose |
|------|---------|
| `games/nexus-auth.js` | Auth module — sign in/out, session check, redirect to login |
| `games/nexus-cloud.js` | Drop-in replacement for `nexus-mp.js` — cloud rooms + realtime sync |
| `games/nexus-db.js` | Stats save/load, profile read/write, leaderboard queries |
| `login.html` | Standalone login page with Google, Discord, Email, guest option |
| `games/migration.sql` | One-time SQL run in Supabase dashboard — creates all tables |

### Modified files

- `games/nexus-config.js` — adds `SUPABASE_URL` and `SUPABASE_ANON_KEY` fields
- `multiplayer-lobby.html` — rewritten to show live cloud rooms instead of P2P codes
- `index.html` — shows signed-in user name/avatar, global leaderboard section
- `profile.html` — shows real account data, per-game stats
- `games/culling-colony/index.html` — integrate `nexus-auth.js`, `nexus-cloud.js`, `nexus-db.js`
- `games/cursed-arena/index.html` — same
- `games/domain-defender/index.html` — same
- `games/jujutsuhunters/hunters.html` — same (replaces existing custom auth)
- `games/spirit-chase/index.html` — same

`nexus-mp.js` is left in place but no longer loaded by any game.

---

## Database Schema

All created by `games/migration.sql` — paste into Supabase SQL editor and click Run.

### `profiles`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | FK to `auth.users`, PK |
| username | text | Unique display name |
| display_name | text | Shown in game (may differ from username) |
| avatar_url | text | Profile picture URL |
| xp | integer | Platform-wide XP, default 0 |
| level | integer | Computed from XP, default 1 |
| created_at | timestamptz | |

Auto-created via trigger on first sign-in. RLS: users can only update their own row.

### `game_rooms`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| game_id | text | `'hunters'`, `'spirit-chase'`, etc. |
| host_id | uuid | FK to `profiles` |
| room_name | text | |
| status | text | `waiting` / `playing` / `finished` |
| max_players | integer | Default 4 |
| is_public | boolean | Default true |
| settings | jsonb | Game-specific config |
| created_at | timestamptz | |

Realtime enabled. Rows auto-deleted when status = `finished` after 60 seconds.

### `room_players`
| Column | Type | Notes |
|--------|------|-------|
| room_id | uuid | FK to `game_rooms` |
| player_id | uuid | FK to `profiles` |
| is_host | boolean | |
| is_ready | boolean | Default false |
| joined_at | timestamptz | |

Realtime enabled. Row deleted on disconnect.

### `game_stats`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| player_id | uuid | FK to `profiles` |
| game_id | text | |
| score | integer | |
| won | boolean | |
| playtime_seconds | integer | |
| extra | jsonb | Game-specific data (kills, waves, etc.) |
| recorded_at | timestamptz | |

One row per completed game session. Never mutated — append-only.

### `leaderboards` (SQL view)
Aggregates `game_stats` by `game_id` + `player_id`: `best_score`, `total_wins`, `total_playtime`, `rank`. Filtered by `game_id` for per-game boards; unfiltered for global.

---

## Auth Flow

1. Any game or page calls `NexusAuth.requireAuth()` on load
2. If no session → redirect to `login.html?returnTo=<current-url>`
3. `login.html` shows Google, Discord, Email/Password, and "Continue as guest" (anonymous Supabase auth)
4. On success → redirect back to `returnTo`
5. Session persists in localStorage — user never signs in again on that browser
6. `nexus-auth.js` exposes: `NexusAuth.getUser()`, `NexusAuth.requireAuth()`, `NexusAuth.signOut()`

---

## Cloud Lobby Flow (`nexus-cloud.js`)

`NexusCloud` is the public API — same ergonomics as the old `NexusMP`:

```js
await NexusCloud.listRooms(gameId)              // returns open rooms for a game
await NexusCloud.createRoom(gameId, roomName, maxPlayers, settings)
await NexusCloud.joinRoom(roomId)
NexusCloud.send(channel, data)          // broadcast to room
NexusCloud.on(channel, callback)        // listen for messages
NexusCloud.onPlayerJoin(callback)
NexusCloud.onPlayerLeave(callback)
NexusCloud.leave()
NexusCloud.players                      // Map<playerId, profile>
NexusCloud.isHost
```

Internally uses Supabase Realtime broadcast channels. Host sends state; all peers receive. On host disconnect, oldest remaining player auto-promotes to host.

---

## Stats API (`nexus-db.js`)

```js
await NexusDB.saveStats(gameId, { score, won, playtime_seconds, extra })
await NexusDB.getLeaderboard(gameId, limit = 10)   // returns ranked rows
await NexusDB.getMyStats(gameId)                    // returns aggregate for current user
await NexusDB.getProfile()                          // current user's profile row
await NexusDB.updateProfile({ display_name, avatar_url })
```

---

## Login Page (`login.html`)

- Nexus logo + tagline
- Google sign-in button (Supabase OAuth)
- Discord sign-in button (Supabase OAuth)
- Email + Password form with Sign In / Sign Up toggle
- "Continue as guest" link (Supabase anonymous auth — upgradeable later)
- Redirects to `returnTo` query param after success
- Matches existing dark cyan/purple Nexus aesthetic

---

## Per-Game Integration Pattern

Each game adds three script tags (after `nexus-config.js`):
```html
<script src="/games/nexus-auth.js"></script>
<script src="/games/nexus-cloud.js"></script>
<script src="/games/nexus-db.js"></script>
```

Then on multiplayer game start:
1. `await NexusAuth.requireAuth()` — ensure signed in
2. Show lobby UI (list rooms via `NexusCloud.listRooms(gameId)`)
3. Create or join room
4. On game end: `await NexusDB.saveStats(gameId, {...})`

Jujutsu Hunters replaces its existing custom auth/save system with these modules.

---

## User Setup (one-time, ~15 minutes)

1. Create free project at supabase.com
2. In Supabase dashboard → Authentication → Providers: enable Google, Discord, Email
3. Create Discord app at discord.com/developers → copy Client ID + Secret → paste into Supabase Discord provider settings
4. Create Google OAuth credentials in Google Cloud Console → paste into Supabase Google provider settings
5. In Supabase dashboard → SQL Editor: paste contents of `games/migration.sql` → click Run
6. Copy Project URL + anon key from Supabase Settings → paste into `games/nexus-config.js`

All code is written — no further action needed.

---

## Verification

1. Open `login.html` — all three sign-in methods work, session persists on refresh
2. Open any game → not signed in → redirected to login → sign in → returned to game
3. Open any game → signed in → click Multiplayer → lobby shows live rooms
4. Player A creates room → Player B joins → both see each other in room
5. Play a game → on end, stats appear in leaderboard
6. Open `profile.html` → shows real account info + per-game stats
7. Open `index.html` → shows signed-in user name in header
