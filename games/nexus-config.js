// =============================================================================
// NEXUS — Firebase Configuration
// =============================================================================
// To enable multiplayer across all games:
//
//  1. Go to https://console.firebase.google.com (free Google account)
//  2. Click "Add project" → name it anything → Continue
//  3. Left sidebar → Build → Realtime Database → Create Database
//  4. Choose a region → Start in TEST MODE → Enable
//  5. Copy the URL shown (e.g. https://my-project-default-rtdb.firebaseio.com)
//  6. Paste it below as NEXUS_FB_URL
//
// That's it. No server, no billing, no code to deploy.
// Free tier: 1 GB storage, 10 GB/month transfer, 100 simultaneous connections.
// =============================================================================

window.NEXUS_FB_URL = 'https://YOUR-PROJECT-default-rtdb.firebaseio.com';

// Optional: your display name default
window.NEXUS_PLAYER_NAME = localStorage.getItem('nexus_playername') || 'Sorcerer';
