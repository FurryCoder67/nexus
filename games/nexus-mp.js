// =============================================================================
// NEXUS Multiplayer — Firebase Realtime Database bridge
// No server needed. Uses Firebase free tier (100 simultaneous connections).
//
// SETUP (one-time, free):
//   1. Go to https://console.firebase.google.com
//   2. Create a project → Realtime Database → Start in test mode
//   3. Copy your database URL (looks like: https://YOUR-PROJECT-default-rtdb.firebaseio.com)
//   4. Set window.NEXUS_FB_URL = "https://YOUR-PROJECT-default-rtdb.firebaseio.com"
//      before loading this script, OR set it in nexus-config.js
//
// Usage:
//   NexusMP.init(gameId)          → returns Promise<{roomCode, isHost}>
//   NexusMP.join(gameId, code)    → returns Promise<{roomCode, isHost}>
//   NexusMP.send(path, data)      → write data to shared room path
//   NexusMP.on(path, cb)          → subscribe to changes at path
//   NexusMP.off(path)             → unsubscribe
//   NexusMP.myId                  → unique player ID
//   NexusMP.roomCode              → current room code
//   NexusMP.isHost                → true if this player created the room
//   NexusMP.players               → Map of playerId → data
//   NexusMP.onPlayerJoin(cb)      → called when a new player joins
//   NexusMP.onPlayerLeave(cb)     → called when a player leaves
//   NexusMP.leave()               → clean disconnect
// =============================================================================

(function () {
  'use strict';

  // ── Config ──────────────────────────────────────────────────────────────────
  // Set window.NEXUS_FB_URL before loading this script.
  // Falls back to a shared demo DB (rate-limited, for testing only).
  const FB_URL = () =>
    window.NEXUS_FB_URL ||
    'https://nexus-games-default-rtdb.firebaseio.com';

  // ── Utilities ────────────────────────────────────────────────────────────────

  function uid() {
    return Math.random().toString(36).slice(2, 10) +
           Math.random().toString(36).slice(2, 10);
  }

  function roomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let c = '';
    for (let i = 0; i < 6; i++) c += chars[Math.floor(Math.random() * chars.length)];
    return c;
  }

  // ── Firebase REST helpers ────────────────────────────────────────────────────
  // We use Firebase REST API + Server-Sent Events (SSE) — no SDK needed.

  function fbUrl(path) {
    return `${FB_URL()}/${path}.json`;
  }

  async function fbGet(path) {
    const r = await fetch(fbUrl(path));
    if (!r.ok) throw new Error(`FB GET ${path} → ${r.status}`);
    return r.json();
  }

  async function fbSet(path, data) {
    const r = await fetch(fbUrl(path), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!r.ok) throw new Error(`FB SET ${path} → ${r.status}`);
    return r.json();
  }

  async function fbPatch(path, data) {
    const r = await fetch(fbUrl(path), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!r.ok) throw new Error(`FB PATCH ${path} → ${r.status}`);
    return r.json();
  }

  async function fbDelete(path) {
    await fetch(fbUrl(path), { method: 'DELETE' });
  }

  // ── SSE listener ─────────────────────────────────────────────────────────────
  // Firebase SSE streams changes at a path in real-time.

  const _listeners = new Map(); // path → EventSource

  function fbListen(path, cb) {
    if (_listeners.has(path)) {
      _listeners.get(path).close();
    }
    const es = new EventSource(`${FB_URL()}/${path}.json`);
    es.addEventListener('put', (e) => {
      try {
        const d = JSON.parse(e.data);
        cb(d.data, d.path);
      } catch (_) {}
    });
    es.addEventListener('patch', (e) => {
      try {
        const d = JSON.parse(e.data);
        cb(d.data, d.path);
      } catch (_) {}
    });
    es.onerror = () => {
      // SSE auto-reconnects; ignore transient errors
    };
    _listeners.set(path, es);
    return es;
  }

  function fbUnlisten(path) {
    if (_listeners.has(path)) {
      _listeners.get(path).close();
      _listeners.delete(path);
    }
  }

  // ── Presence (heartbeat) ─────────────────────────────────────────────────────

  let _heartbeatInterval = null;

  function startHeartbeat(roomPath, myId) {
    stopHeartbeat();
    _heartbeatInterval = setInterval(async () => {
      try {
        await fbPatch(`${roomPath}/players/${myId}`, { ts: Date.now() });
      } catch (_) {}
    }, 5000);
  }

  function stopHeartbeat() {
    if (_heartbeatInterval) {
      clearInterval(_heartbeatInterval);
      _heartbeatInterval = null;
    }
  }

  // ── Stale player cleanup ─────────────────────────────────────────────────────
  // Players who haven't sent a heartbeat in 15s are considered gone.

  let _cleanupInterval = null;

  function startCleanup(roomPath, onLeave) {
    stopCleanup();
    _cleanupInterval = setInterval(async () => {
      try {
        const players = await fbGet(`${roomPath}/players`);
        if (!players) return;
        const now = Date.now();
        for (const [id, p] of Object.entries(players)) {
          if (id === NexusMP.myId) continue;
          if (p.ts && now - p.ts > 15000) {
            await fbDelete(`${roomPath}/players/${id}`);
            NexusMP.players.delete(id);
            if (onLeave) onLeave(id, p);
          }
        }
      } catch (_) {}
    }, 8000);
  }

  function stopCleanup() {
    if (_cleanupInterval) {
      clearInterval(_cleanupInterval);
      _cleanupInterval = null;
    }
  }

  // ── NexusMP public API ───────────────────────────────────────────────────────

  const NexusMP = {
    myId: null,
    roomCode: null,
    isHost: false,
    players: new Map(),
    _roomPath: null,
    _subs: new Map(),
    _onJoin: null,
    _onLeave: null,

    // ── Create a new room ──────────────────────────────────────────────────────
    async init(gameId, displayName) {
      this.myId = uid();
      this.roomCode = roomCode();
      this.isHost = true;
      this._roomPath = `games/${gameId}/rooms/${this.roomCode}`;

      const playerData = {
        id: this.myId,
        name: displayName || 'Player',
        ts: Date.now(),
        isHost: true,
      };

      await fbSet(this._roomPath, {
        created: Date.now(),
        host: this.myId,
        players: { [this.myId]: playerData },
        state: {},
      });

      this.players.set(this.myId, playerData);
      this._watchPlayers();
      startHeartbeat(this._roomPath, this.myId);
      startCleanup(this._roomPath, (id, p) => {
        if (this._onLeave) this._onLeave(id, p);
      });

      // Auto-delete room after 2 hours
      setTimeout(() => { try { fbDelete(this._roomPath); } catch (_) {} }, 7200000);

      return { roomCode: this.roomCode, isHost: true };
    },

    // ── Join an existing room ──────────────────────────────────────────────────
    async join(gameId, code, displayName) {
      this.myId = uid();
      this.roomCode = code.toUpperCase().trim();
      this.isHost = false;
      this._roomPath = `games/${gameId}/rooms/${this.roomCode}`;

      // Verify room exists
      const room = await fbGet(this._roomPath);
      if (!room) throw new Error('Room not found');

      const playerData = {
        id: this.myId,
        name: displayName || 'Player',
        ts: Date.now(),
        isHost: false,
      };

      await fbPatch(`${this._roomPath}/players`, { [this.myId]: playerData });

      // Load existing players
      if (room.players) {
        for (const [id, p] of Object.entries(room.players)) {
          this.players.set(id, p);
        }
      }
      this.players.set(this.myId, playerData);

      this._watchPlayers();
      startHeartbeat(this._roomPath, this.myId);
      startCleanup(this._roomPath, (id, p) => {
        if (this._onLeave) this._onLeave(id, p);
      });

      return { roomCode: this.roomCode, isHost: false };
    },

    // ── Watch player list for joins/leaves ────────────────────────────────────
    _watchPlayers() {
      fbListen(`${this._roomPath}/players`, (data) => {
        if (!data) return;
        const incoming = typeof data === 'object' ? data : {};
        for (const [id, p] of Object.entries(incoming)) {
          if (!this.players.has(id) && id !== this.myId) {
            this.players.set(id, p);
            if (this._onJoin) this._onJoin(id, p);
          } else {
            this.players.set(id, p);
          }
        }
      });
    },

    // ── Write shared state ────────────────────────────────────────────────────
    async send(subPath, data) {
      if (!this._roomPath) return;
      try {
        await fbPatch(`${this._roomPath}/state/${subPath}`, data);
      } catch (_) {}
    },

    async set(subPath, data) {
      if (!this._roomPath) return;
      try {
        await fbSet(`${this._roomPath}/state/${subPath}`, data);
      } catch (_) {}
    },

    // ── Subscribe to shared state changes ────────────────────────────────────
    on(subPath, cb) {
      const fullPath = `${this._roomPath}/state/${subPath}`;
      fbListen(fullPath, cb);
      this._subs.set(subPath, fullPath);
    },

    off(subPath) {
      const fullPath = this._subs.get(subPath);
      if (fullPath) fbUnlisten(fullPath);
      this._subs.delete(subPath);
    },

    // ── Player join/leave callbacks ───────────────────────────────────────────
    onPlayerJoin(cb) { this._onJoin = cb; },
    onPlayerLeave(cb) { this._onLeave = cb; },

    // ── Get current state snapshot ────────────────────────────────────────────
    async getState(subPath) {
      try {
        return await fbGet(`${this._roomPath}/state/${subPath}`);
      } catch (_) { return null; }
    },

    // ── Leave / cleanup ───────────────────────────────────────────────────────
    async leave() {
      stopHeartbeat();
      stopCleanup();
      for (const path of _listeners.keys()) fbUnlisten(path);
      _listeners.clear();
      if (this._roomPath && this.myId) {
        try { await fbDelete(`${this._roomPath}/players/${this.myId}`); } catch (_) {}
        // If host, delete whole room
        if (this.isHost) {
          try { await fbDelete(this._roomPath); } catch (_) {}
        }
      }
      this.myId = null;
      this.roomCode = null;
      this.isHost = false;
      this.players.clear();
      this._roomPath = null;
    },

    // ── List open rooms for a game ────────────────────────────────────────────
    async listRooms(gameId) {
      try {
        const rooms = await fbGet(`games/${gameId}/rooms`);
        if (!rooms) return [];
        const now = Date.now();
        return Object.entries(rooms)
          .filter(([, r]) => r && r.created && now - r.created < 7200000)
          .map(([code, r]) => ({
            code,
            playerCount: r.players ? Object.keys(r.players).length : 0,
            created: r.created,
          }));
      } catch (_) { return []; }
    },
  };

  window.NexusMP = NexusMP;
  console.log('[NexusMP] Ready — Firebase REST multiplayer loaded');
})();
