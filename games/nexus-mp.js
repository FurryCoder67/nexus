// =============================================================================
// NEXUS Multiplayer — PeerJS WebRTC (zero config, works instantly)
// Uses PeerJS free public broker for signaling, then direct P2P data channels.
// No Firebase, no server, no setup required.
//
// API (same as before so game scripts don't change):
//   NexusMP.init(gameId, name)    → Promise<{roomCode, isHost}>  — host a room
//   NexusMP.join(gameId, code, name) → Promise<{roomCode, isHost}> — join room
//   NexusMP.send(channel, data)   → broadcast to all peers
//   NexusMP.on(channel, cb)       → listen for messages on channel
//   NexusMP.off(channel)          → remove listener
//   NexusMP.myId                  → local peer ID
//   NexusMP.roomCode              → 6-char room code
//   NexusMP.isHost                → true if you created the room
//   NexusMP.players               → Map<peerId, {name, ...}>
//   NexusMP.onPlayerJoin(cb)      → cb(id, playerData)
//   NexusMP.onPlayerLeave(cb)     → cb(id, playerData)
//   NexusMP.leave()               → disconnect
// =============================================================================

(function () {
  'use strict';

  // ── PeerJS CDN (loaded on demand) ────────────────────────────────────────────
  const PEERJS_CDN = 'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js';

  function loadPeerJS() {
    return new Promise((resolve, reject) => {
      if (window.Peer) { resolve(); return; }
      const s = document.createElement('script');
      s.src = PEERJS_CDN;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Failed to load PeerJS'));
      document.head.appendChild(s);
    });
  }

  // ── Utilities ────────────────────────────────────────────────────────────────

  function genCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let c = '';
    for (let i = 0; i < 6; i++) c += chars[Math.floor(Math.random() * chars.length)];
    return c;
  }

  // PeerJS peer IDs must be URL-safe. We encode room code + role into the host's
  // peer ID so joiners can connect directly without a separate signaling step.
  // Host peer ID format: "nexus-{gameId}-{roomCode}"
  // This means the joiner only needs the room code to find the host.
  function hostPeerId(gameId, code) {
    return `nexus-${gameId}-${code}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  }

  // ── NexusMP ──────────────────────────────────────────────────────────────────

  const NexusMP = {
    myId: null,
    roomCode: null,
    isHost: false,
    players: new Map(),   // peerId → {name, id, ...}
    _peer: null,
    _conns: new Map(),    // peerId → DataConnection
    _channels: new Map(), // channel → Set<callback>
    _onJoin: null,
    _onLeave: null,
    _gameId: null,
    _myName: 'Player',

    // ── Host a room ────────────────────────────────────────────────────────────
    async init(gameId, displayName) {
      await loadPeerJS();
      this._gameId = gameId;
      this._myName = displayName || 'Player';
      this.isHost = true;
      this.roomCode = genCode();
      const pid = hostPeerId(gameId, this.roomCode);

      return new Promise((resolve, reject) => {
        const peer = new Peer(pid, { debug: 0 });
        this._peer = peer;

        peer.on('open', (id) => {
          this.myId = id;
          this.players.set(id, { id, name: this._myName, isHost: true });
          console.log('[NexusMP] Hosting room', this.roomCode, 'as', id);

          // Accept incoming connections from joiners
          peer.on('connection', (conn) => {
            this._setupConn(conn);
          });

          resolve({ roomCode: this.roomCode, isHost: true });
        });

        peer.on('error', (err) => {
          // If peer ID is taken (room code collision), generate a new one
          if (err.type === 'unavailable-id') {
            this.roomCode = genCode();
            peer.destroy();
            this.init(gameId, displayName).then(resolve).catch(reject);
          } else {
            console.error('[NexusMP] Peer error:', err);
            reject(err);
          }
        });
      });
    },

    // ── Join a room ────────────────────────────────────────────────────────────
    async join(gameId, code, displayName) {
      await loadPeerJS();
      this._gameId = gameId;
      this._myName = displayName || 'Player';
      this.isHost = false;
      this.roomCode = code.toUpperCase().trim();
      const targetId = hostPeerId(gameId, this.roomCode);

      return new Promise((resolve, reject) => {
        // Joiner gets a random peer ID
        const peer = new Peer({ debug: 0 });
        this._peer = peer;

        peer.on('open', (myId) => {
          this.myId = myId;
          this.players.set(myId, { id: myId, name: this._myName, isHost: false });

          const conn = peer.connect(targetId, {
            reliable: true,
            metadata: { name: this._myName, id: myId },
          });

          const timeout = setTimeout(() => {
            reject(new Error('Room not found or host offline'));
          }, 8000);

          conn.on('open', () => {
            clearTimeout(timeout);
            this._setupConn(conn);
            // Send our identity to host
            conn.send({ _sys: 'hello', name: this._myName, id: myId });
            console.log('[NexusMP] Joined room', this.roomCode);
            resolve({ roomCode: this.roomCode, isHost: false });
          });

          conn.on('error', (err) => {
            clearTimeout(timeout);
            reject(new Error('Could not connect: ' + err.message));
          });
        });

        peer.on('error', (err) => {
          reject(new Error('Peer error: ' + err.message));
        });
      });
    },

    // ── Wire up a DataConnection ───────────────────────────────────────────────
    _setupConn(conn) {
      const peerId = conn.peer;
      this._conns.set(peerId, conn);

      conn.on('open', () => {
        // If we're the host, send the new peer our identity + existing player list
        if (this.isHost) {
          conn.send({ _sys: 'hello', name: this._myName, id: this.myId });
          // Send existing players to the new joiner
          const existing = [];
          this.players.forEach((p, id) => {
            if (id !== peerId) existing.push(p);
          });
          if (existing.length) conn.send({ _sys: 'roster', players: existing });
        }
      });

      conn.on('data', (msg) => {
        if (!msg) return;

        // System messages
        if (msg._sys === 'hello') {
          const pData = { id: msg.id || peerId, name: msg.name || 'Player' };
          this.players.set(peerId, pData);
          if (this._onJoin) this._onJoin(peerId, pData);
          // Host relays the join to all other peers
          if (this.isHost) {
            this._conns.forEach((c, cid) => {
              if (cid !== peerId && c.open) {
                c.send({ _sys: 'peer-joined', player: pData });
              }
            });
          }
          return;
        }

        if (msg._sys === 'roster') {
          // Joiner receives existing player list from host
          if (msg.players) {
            msg.players.forEach(p => {
              this.players.set(p.id, p);
              if (this._onJoin) this._onJoin(p.id, p);
            });
          }
          return;
        }

        if (msg._sys === 'peer-joined') {
          // Relayed join notification (non-host peers)
          const p = msg.player;
          if (p && !this.players.has(p.id)) {
            this.players.set(p.id, p);
            if (this._onJoin) this._onJoin(p.id, p);
          }
          return;
        }

        if (msg._sys === 'peer-left') {
          const leftId = msg.id;
          const p = this.players.get(leftId);
          this.players.delete(leftId);
          if (this._onLeave) this._onLeave(leftId, p);
          return;
        }

        // Game messages — dispatch to channel listeners
        if (msg._ch) {
          const cbs = this._channels.get(msg._ch);
          if (cbs) cbs.forEach(cb => { try { cb(msg._data, peerId); } catch(_) {} });
        }
      });

      conn.on('close', () => {
        this._conns.delete(peerId);
        const p = this.players.get(peerId);
        this.players.delete(peerId);
        if (this._onLeave) this._onLeave(peerId, p);
        // Host notifies remaining peers
        if (this.isHost) {
          this._conns.forEach((c) => {
            if (c.open) c.send({ _sys: 'peer-left', id: peerId });
          });
        }
      });

      conn.on('error', (err) => {
        console.warn('[NexusMP] Connection error:', err);
      });
    },

    // ── Send a game message to all peers ──────────────────────────────────────
    send(channel, data) {
      const msg = { _ch: channel, _data: data };
      this._conns.forEach((conn) => {
        if (conn.open) {
          try { conn.send(msg); } catch(_) {}
        }
      });
    },

    // ── Also fire locally so host sees its own sends ──────────────────────────
    sendAndReceive(channel, data) {
      this.send(channel, data);
      const cbs = this._channels.get(channel);
      if (cbs) cbs.forEach(cb => { try { cb(data, this.myId); } catch(_) {} });
    },

    // ── Subscribe to a channel ────────────────────────────────────────────────
    on(channel, cb) {
      if (!this._channels.has(channel)) this._channels.set(channel, new Set());
      this._channels.get(channel).add(cb);
    },

    off(channel, cb) {
      if (!this._channels.has(channel)) return;
      if (cb) this._channels.get(channel).delete(cb);
      else this._channels.delete(channel);
    },

    // ── Callbacks ─────────────────────────────────────────────────────────────
    onPlayerJoin(cb) { this._onJoin = cb; },
    onPlayerLeave(cb) { this._onLeave = cb; },

    // ── Snapshot helper (P2P has no server state — returns local cache) ────────
    async getState(channel) {
      return this._lastState ? this._lastState[channel] : null;
    },

    // ── Disconnect ────────────────────────────────────────────────────────────
    leave() {
      if (this._peer) {
        // Notify peers we're leaving
        this._conns.forEach((conn) => {
          if (conn.open) {
            try { conn.send({ _sys: 'peer-left', id: this.myId }); } catch(_) {}
          }
        });
        this._peer.destroy();
        this._peer = null;
      }
      this._conns.clear();
      this._channels.clear();
      this.players.clear();
      this.myId = null;
      this.roomCode = null;
      this.isHost = false;
    },
  };

  window.NexusMP = NexusMP;
  console.log('[NexusMP] Ready — PeerJS WebRTC multiplayer loaded');
})();
