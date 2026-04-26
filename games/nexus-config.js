// =============================================================================
// NEXUS — Multiplayer Config
// Uses PeerJS WebRTC — zero setup, works instantly, no accounts needed.
// =============================================================================

// Your display name (saved across sessions)
window.NEXUS_PLAYER_NAME = localStorage.getItem('nexus_playername') || 'Sorcerer';

// Optional: Hunters WebSocket server (Railway free tier)
// Deploy games/jujutsuhunters/multiplayer/server.js to Railway, paste URL here:
// window.NEXUS_HUNTERS_WS = 'wss://your-hunters-server.railway.app';
