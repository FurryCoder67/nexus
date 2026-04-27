// =============================================================================
// NEXUS Database — Stats, Profiles, and Leaderboards
// Handles game statistics, player profiles, and leaderboard queries
// =============================================================================

(function () {
  'use strict';

  // Ensure dependencies are loaded
  if (typeof supabase === 'undefined') {
    console.error('[NexusDB] Supabase not loaded. Include Supabase CDN before this script.');
    return;
  }

  if (typeof NexusAuth === 'undefined') {
    console.error('[NexusDB] NexusAuth not loaded. Include nexus-auth.js before this script.');
    return;
  }

  // Initialize Supabase client
  let _supabase = null;

  function getSupabase() {
    if (!_supabase) {
      if (!window.NEXUS_SUPABASE_URL || !window.NEXUS_SUPABASE_ANON_KEY) {
        throw new Error('Supabase credentials not configured in nexus-config.js');
      }
      _supabase = supabase.createClient(
        window.NEXUS_SUPABASE_URL,
        window.NEXUS_SUPABASE_ANON_KEY
      );
    }
    return _supabase;
  }

  const NexusDB = {

    // Save game statistics
    async saveStats(gameId, stats) {
      const user = await NexusAuth.getUser();
      if (!user) throw new Error('Must be authenticated to save stats');

      const sb = getSupabase();

      // Prepare stats data
      const statsData = {
        player_id: user.id,
        game_id: gameId,
        score: stats.score || 0,
        won: stats.won || false,
        playtime_seconds: stats.playtime_seconds || 0,
        extra: stats.extra || {}
      };

      // Insert stats
      const { data, error } = await sb
        .from('game_stats')
        .insert(statsData)
        .select()
        .single();

      if (error) throw error;

      // Update player XP based on performance
      await this._updatePlayerXP(user.id, stats);

      return data;
    },

    // Update player XP and level
    async _updatePlayerXP(playerId, stats) {
      const sb = getSupabase();

      // Calculate XP gain
      let xpGain = Math.floor(stats.score / 10); // Base XP from score
      if (stats.won) xpGain += 100; // Bonus for winning
      xpGain += Math.floor(stats.playtime_seconds / 60) * 5; // Time bonus

      // Get current profile
      const { data: profile, error: profileError } = await sb
        .from('profiles')
        .select('xp, level')
        .eq('id', playerId)
        .single();

      if (profileError) throw profileError;

      const newXP = profile.xp + xpGain;
      const newLevel = Math.floor(Math.sqrt(newXP / 100)) + 1; // Level formula

      // Update profile
      const { error: updateError } = await sb
        .from('profiles')
        .update({
          xp: newXP,
          level: newLevel
        })
        .eq('id', playerId);

      if (updateError) throw updateError;

      return { xpGain, newXP, newLevel };
    },

    // Get leaderboard for a specific game
    async getLeaderboard(gameId, limit = 10) {
      const sb = getSupabase();

      if (!gameId) {
        return this.getGlobalLeaderboard(limit);
      }

      const { data, error } = await sb
        .from('leaderboards')
        .select('*')
        .eq('game_id', gameId)
        .order('rank', { ascending: true })
        .limit(limit);

      if (error) throw error;

      if (!data || data.length === 0) {
        return [];
      }

      return data.map((entry, index) => ({
        rank: entry.rank || index + 1,
        playerId: entry.player_id,
        displayName: entry.display_name,
        avatarUrl: entry.avatar_url,
        bestScore: entry.best_score,
        totalWins: entry.total_wins,
        totalGames: entry.total_games,
        totalPlaytime: entry.total_playtime,
        winRate: entry.total_games > 0 ? (entry.total_wins / entry.total_games * 100).toFixed(1) : '0.0'
      }));
    },

    // Get global leaderboard
    async getGlobalLeaderboard(limit = 10) {
      const sb = getSupabase();

      const { data, error } = await sb
        .from('global_leaderboard')
        .select('*')
        .order('rank', { ascending: true })
        .limit(limit);

      if (error) throw error;

      return data.map((entry, index) => ({
        rank: entry.rank || index + 1,
        playerId: entry.player_id,
        displayName: entry.display_name,
        avatarUrl: entry.avatar_url,
        xp: entry.xp,
        level: entry.level,
        totalWins: entry.total_wins,
        totalGames: entry.total_games,
        totalPlaytime: entry.total_playtime,
        winRate: entry.total_games > 0 ? (entry.total_wins / entry.total_games * 100).toFixed(1) : '0.0'
      }));
    },

    // Get player's stats for a specific game
    async getMyStats(gameId) {
      const user = await NexusAuth.getUser();
      if (!user) return null;

      const sb = getSupabase();

      const { data, error } = await sb
        .from('game_stats')
        .select('*')
        .eq('player_id', user.id)
        .eq('game_id', gameId)
        .order('recorded_at', { ascending: false });

      if (error) throw error;

      if (data.length === 0) {
        return {
          gamesPlayed: 0,
          bestScore: 0,
          totalWins: 0,
          totalPlaytime: 0,
          averageScore: 0,
          winRate: 0,
          recentGames: []
        };
      }

      const totalGames = data.length;
      const totalWins = data.filter(game => game.won).length;
      const bestScore = Math.max(...data.map(game => game.score));
      const totalPlaytime = data.reduce((sum, game) => sum + game.playtime_seconds, 0);
      const averageScore = data.reduce((sum, game) => sum + game.score, 0) / totalGames;

      return {
        gamesPlayed: totalGames,
        bestScore,
        totalWins,
        totalPlaytime,
        averageScore: Math.round(averageScore),
        winRate: ((totalWins / totalGames) * 100).toFixed(1),
        recentGames: data.slice(0, 5).map(game => ({
          score: game.score,
          won: game.won,
          playTime: game.playtime_seconds,
          recordedAt: game.recorded_at,
          extra: game.extra
        }))
      };
    },

    // Get current user's profile
    async getProfile() {
      const user = await NexusAuth.getUser();
      if (!user) return null;

      return NexusAuth.getProfile();
    },

    // Update user profile
    async updateProfile(updates) {
      return await NexusAuth.updateProfile(updates);
    },

    // Get player activity feed
    async getActivityFeed(limit = 20) {
      const sb = getSupabase();

      const { data, error } = await sb
        .from('game_stats')
        .select(`
          *,
          profile:profiles(display_name, avatar_url)
        `)
        .order('recorded_at', { ascending: false })
        .limit(limit);

      if (error) throw error;

      return data.map(activity => ({
        id: activity.id,
        playerId: activity.player_id,
        playerName: activity.profile.display_name,
        playerAvatar: activity.profile.avatar_url,
        gameId: activity.game_id,
        gameName: window.NEXUS_GAMES?.[activity.game_id]?.name || activity.game_id,
        score: activity.score,
        won: activity.won,
        playtime: activity.playtime_seconds,
        recordedAt: activity.recorded_at,
        extra: activity.extra
      }));
    },

    // Get game statistics summary
    async getGameStats(gameId) {
      const sb = getSupabase();

      const { data, error } = await sb
        .from('game_stats')
        .select('*')
        .eq('game_id', gameId);

      if (error) throw error;

      if (data.length === 0) {
        return {
          totalGames: 0,
          totalPlayers: 0,
          averageScore: 0,
          highestScore: 0,
          totalPlaytime: 0
        };
      }

      const uniquePlayers = new Set(data.map(game => game.player_id)).size;
      const totalGames = data.length;
      const averageScore = data.reduce((sum, game) => sum + game.score, 0) / totalGames;
      const highestScore = Math.max(...data.map(game => game.score));
      const totalPlaytime = data.reduce((sum, game) => sum + game.playtime_seconds, 0);

      return {
        totalGames,
        totalPlayers: uniquePlayers,
        averageScore: Math.round(averageScore),
        highestScore,
        totalPlaytime
      };
    },

    // Search players
    async searchPlayers(query, limit = 10) {
      const sb = getSupabase();

      const { data, error } = await sb
        .from('profiles')
        .select('id, username, display_name, avatar_url, xp, level')
        .or(`username.ilike.%${query}%,display_name.ilike.%${query}%`)
        .order('xp', { ascending: false })
        .limit(limit);

      if (error) throw error;

      return data;
    },

    // Get trending games
    async getTrendingGames() {
      const sb = getSupabase();

      // Get games played in the last 24 hours
      const { data, error } = await sb
        .from('game_stats')
        .select('game_id')
        .gte('recorded_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

      if (error) throw error;

      // Count games by game_id
      const gameCounts = {};
      data.forEach(stat => {
        gameCounts[stat.game_id] = (gameCounts[stat.game_id] || 0) + 1;
      });

      // Sort by popularity
      const trending = Object.entries(gameCounts)
        .sort(([, a], [, b]) => b - a)
        .map(([gameId, count]) => ({
          gameId,
          name: window.NEXUS_GAMES?.[gameId]?.name || gameId,
          playCount: count
        }));

      return trending;
    }
  };

  // Export to global scope
  window.NexusDB = NexusDB;

})();