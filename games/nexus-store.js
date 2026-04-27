// =============================================================================
// NEXUS Store — Local-first player data, leaderboard, friends, activity
// Works 100% offline. No external services required.
// =============================================================================
(function () {
  'use strict';

  const DB_KEY = 'nexus_db_v2';

  function load() {
    try { return JSON.parse(localStorage.getItem(DB_KEY)) || {}; }
    catch { return {}; }
  }

  function save(db) {
    localStorage.setItem(DB_KEY, JSON.stringify(db));
  }

  function getDB() {
    const db = load();
    if (!db.players)   db.players   = {};
    if (!db.stats)     db.stats     = [];
    if (!db.activity)  db.activity  = [];
    if (!db.friends)   db.friends   = {};   // playerId -> [friendId, ...]
    if (!db.requests)  db.requests  = {};   // playerId -> [fromId, ...]
    return db;
  }

  // ── Auth ──────────────────────────────────────────────────────────────────

  const SESSION_KEY = 'nexus_session';

  function currentSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY)); }
    catch { return null; }
  }

  function setSession(player) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(player));
  }

  function clearSession() {
    localStorage.removeItem(SESSION_KEY);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function hashPassword(pw) {
    // Simple deterministic hash (not cryptographic — fine for local-only)
    let h = 0;
    for (let i = 0; i < pw.length; i++) {
      h = (Math.imul(31, h) + pw.charCodeAt(i)) | 0;
    }
    return h.toString(16);
  }

  function avatarColor(name) {
    const colors = [
      'linear-gradient(135deg,#7c3aed,#06b6d4)',
      'linear-gradient(135deg,#dc2626,#7c3aed)',
      'linear-gradient(135deg,#059669,#06b6d4)',
      'linear-gradient(135deg,#d97706,#ef4444)',
      'linear-gradient(135deg,#7c3aed,#ec4899)',
      'linear-gradient(135deg,#0891b2,#22c55e)',
    ];
    let h = 0;
    for (let c of name) h = (h * 31 + c.charCodeAt(0)) | 0;
    return colors[Math.abs(h) % colors.length];
  }

  // ── NexusStore public API ─────────────────────────────────────────────────

  const NexusStore = {

    // ── Registration / Login ────────────────────────────────────────────────

    register(username, password, displayName) {
      const db = getDB();
      const uname = username.trim().toLowerCase();
      if (!uname || uname.length < 3) throw new Error('Username must be at least 3 characters.');
      if (!password || password.length < 4) throw new Error('Password must be at least 4 characters.');
      if (Object.values(db.players).find(p => p.username === uname)) {
        throw new Error('Username already taken.');
      }
      const player = {
        id: uid(),
        username: uname,
        displayName: (displayName || username).trim(),
        passwordHash: hashPassword(password),
        avatarColor: avatarColor(displayName || username),
        xp: 0,
        level: 1,
        wins: 0,
        games: 0,
        joinedAt: Date.now(),
        status: 'online',
        lastSeen: Date.now(),
      };
      db.players[player.id] = player;
      if (!db.friends[player.id]) db.friends[player.id] = [];
      save(db);
      setSession(player);
      return player;
    },

    login(username, password) {
      const db = getDB();
      const uname = username.trim().toLowerCase();
      const player = Object.values(db.players).find(p => p.username === uname);
      if (!player) throw new Error('No account found with that username.');
      if (player.passwordHash !== hashPassword(password)) throw new Error('Incorrect password.');
      player.status = 'online';
      player.lastSeen = Date.now();
      db.players[player.id] = player;
      save(db);
      setSession(player);
      return player;
    },

    loginAsGuest() {
      const name = 'Guest_' + Math.floor(Math.random() * 9999);
      const db = getDB();
      const player = {
        id: uid(),
        username: name.toLowerCase(),
        displayName: name,
        passwordHash: '',
        avatarColor: avatarColor(name),
        xp: 0,
        level: 1,
        wins: 0,
        games: 0,
        joinedAt: Date.now(),
        status: 'online',
        lastSeen: Date.now(),
        isGuest: true,
      };
      db.players[player.id] = player;
      if (!db.friends[player.id]) db.friends[player.id] = [];
      save(db);
      setSession(player);
      return player;
    },

    logout() {
      const session = currentSession();
      if (session) {
        const db = getDB();
        if (db.players[session.id]) {
          db.players[session.id].status = 'offline';
          db.players[session.id].lastSeen = Date.now();
          save(db);
        }
      }
      clearSession();
    },

    getSession() {
      return currentSession();
    },

    // Refresh session from DB (picks up XP changes etc.)
    refreshSession() {
      const s = currentSession();
      if (!s) return null;
      const db = getDB();
      const fresh = db.players[s.id];
      if (fresh) { setSession(fresh); return fresh; }
      return s;
    },

    // ── Stats / XP ──────────────────────────────────────────────────────────

    saveGameResult(gameId, gameName, score, won, playtimeSec, extra = {}) {
      const session = currentSession();
      if (!session) return;
      const db = getDB();
      const player = db.players[session.id];
      if (!player) return;

      // Record stat
      db.stats.push({
        id: uid(),
        playerId: session.id,
        gameId,
        score,
        won,
        playtimeSec,
        extra,
        at: Date.now(),
      });

      // XP gain
      const xpGain = Math.floor(score / 10) + (won ? 100 : 0) + Math.floor(playtimeSec / 60) * 5;
      player.xp += xpGain;
      player.level = Math.floor(Math.sqrt(player.xp / 100)) + 1;
      player.games += 1;
      if (won) player.wins += 1;
      player.lastSeen = Date.now();
      db.players[session.id] = player;

      // Activity feed entry
      db.activity.unshift({
        id: uid(),
        playerId: session.id,
        displayName: player.displayName,
        avatarColor: player.avatarColor,
        gameId,
        gameName,
        score,
        won,
        at: Date.now(),
      });
      if (db.activity.length > 200) db.activity = db.activity.slice(0, 200);

      save(db);
      setSession(player);
      return { xpGain, newXP: player.xp, newLevel: player.level };
    },

    // ── Leaderboard ─────────────────────────────────────────────────────────

    getLeaderboard(limit = 20) {
      const db = getDB();
      return Object.values(db.players)
        .sort((a, b) => b.xp - a.xp)
        .slice(0, limit)
        .map((p, i) => ({
          rank: i + 1,
          id: p.id,
          displayName: p.displayName,
          avatarColor: p.avatarColor,
          xp: p.xp,
          level: p.level,
          wins: p.wins,
          games: p.games,
          winRate: p.games > 0 ? ((p.wins / p.games) * 100).toFixed(0) : '0',
        }));
    },

    // ── Friends ─────────────────────────────────────────────────────────────

    sendFriendRequest(toUsername) {
      const session = currentSession();
      if (!session) throw new Error('Not logged in.');
      const db = getDB();
      const target = Object.values(db.players).find(p => p.username === toUsername.trim().toLowerCase());
      if (!target) throw new Error('Player not found.');
      if (target.id === session.id) throw new Error('Cannot add yourself.');
      if ((db.friends[session.id] || []).includes(target.id)) throw new Error('Already friends.');
      if (!db.requests[target.id]) db.requests[target.id] = [];
      if (db.requests[target.id].includes(session.id)) throw new Error('Request already sent.');
      db.requests[target.id].push(session.id);
      save(db);
      return target.displayName;
    },

    acceptFriendRequest(fromId) {
      const session = currentSession();
      if (!session) return;
      const db = getDB();
      const reqs = db.requests[session.id] || [];
      if (!reqs.includes(fromId)) return;
      db.requests[session.id] = reqs.filter(id => id !== fromId);
      if (!db.friends[session.id]) db.friends[session.id] = [];
      if (!db.friends[fromId]) db.friends[fromId] = [];
      if (!db.friends[session.id].includes(fromId)) db.friends[session.id].push(fromId);
      if (!db.friends[fromId].includes(session.id)) db.friends[fromId].push(session.id);
      save(db);
    },

    declineFriendRequest(fromId) {
      const session = currentSession();
      if (!session) return;
      const db = getDB();
      db.requests[session.id] = (db.requests[session.id] || []).filter(id => id !== fromId);
      save(db);
    },

    removeFriend(friendId) {
      const session = currentSession();
      if (!session) return;
      const db = getDB();
      db.friends[session.id] = (db.friends[session.id] || []).filter(id => id !== friendId);
      db.friends[friendId] = (db.friends[friendId] || []).filter(id => id !== session.id);
      save(db);
    },

    getFriends() {
      const session = currentSession();
      if (!session) return [];
      const db = getDB();
      const ids = db.friends[session.id] || [];
      return ids.map(id => db.players[id]).filter(Boolean).map(p => ({
        id: p.id,
        displayName: p.displayName,
        avatarColor: p.avatarColor,
        status: p.status || 'offline',
        level: p.level,
        lastSeen: p.lastSeen,
      }));
    },

    getPendingRequests() {
      const session = currentSession();
      if (!session) return [];
      const db = getDB();
      const ids = db.requests[session.id] || [];
      return ids.map(id => db.players[id]).filter(Boolean).map(p => ({
        id: p.id,
        displayName: p.displayName,
        avatarColor: p.avatarColor,
      }));
    },

    // ── Activity Feed ────────────────────────────────────────────────────────

    getActivityFeed(limit = 20) {
      const db = getDB();
      return db.activity.slice(0, limit);
    },

    // ── Search ───────────────────────────────────────────────────────────────

    searchPlayers(query) {
      const db = getDB();
      const q = query.trim().toLowerCase();
      if (!q) return [];
      return Object.values(db.players)
        .filter(p => p.username.includes(q) || p.displayName.toLowerCase().includes(q))
        .slice(0, 10)
        .map(p => ({ id: p.id, displayName: p.displayName, username: p.username, avatarColor: p.avatarColor, level: p.level }));
    },

    // ── Helpers ───────────────────────────────────────────────────────────────

    getPlayer(id) {
      return getDB().players[id] || null;
    },

    timeAgo(ts) {
      const diff = Date.now() - ts;
      if (diff < 60000) return 'just now';
      if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
      if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
      return Math.floor(diff / 86400000) + 'd ago';
    },
  };

  window.NexusStore = NexusStore;
})();
