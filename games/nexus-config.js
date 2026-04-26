// =============================================================================
// NEXUS — Cloud Multiplayer Config
// Supabase-powered cloud backend with persistent accounts and real-time sync
// =============================================================================

// Supabase Configuration
// Replace these with your actual Supabase project credentials
window.NEXUS_SUPABASE_URL = 'https://your-project-ref.supabase.co';
window.NEXUS_SUPABASE_ANON_KEY = 'your-anon-key-here';

// Legacy config for backward compatibility
window.NEXUS_PLAYER_NAME = localStorage.getItem('nexus_playername') || 'Sorcerer';

// Game configuration
window.NEXUS_GAMES = {
  'hunters': { name: 'HUNTERS', path: 'games/jujutsuhunters/hunters.html' },
  'cursed-arena': { name: 'Cursed Arena', path: 'games/cursed-arena/index.html' },
  'domain-defender': { name: 'Domain Defender', path: 'games/domain-defender/index.html' },
  'grade-trials': { name: 'Grade Trials', path: 'games/grade-trials/index.html' },
  'spirit-chase': { name: 'Spirit Chase', path: 'games/spirit-chase/index.html' },
  'culling-colony': { name: 'Culling Colony', path: 'games/culling-colony/index.html' }
};