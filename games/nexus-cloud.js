// =============================================================================
// NEXUS Cloud — Supabase Realtime Multiplayer
// Drop-in replacement for nexus-mp.js with cloud rooms and real-time sync
// =============================================================================

(function() {
  'use strict';

  // Ensure dependencies are loaded
  if (typeof supabase === 'undefined') {
    console.error('[NexusCloud] Supabase not loaded. Include Supabase CDN before this script.');
    return;
  }

  if (typeof NexusAuth === 'undefined') {
    console.error('[NexusCloud] NexusAuth not loaded. Include nexus-auth.js before this script.');
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

  const NexusCloud = {
    // State
    currentRoom: null,
    currentGameId: null,
    isHost: false,
    players: new Map(),
    
    // Event listeners
    _channels: new Map(),
    _onPlayerJoin: null,
    _onPlayerLeave: null,
    
    // Realtime subscriptions
    _roomSubscription: null,
    _playersSubscription: null,
    _broadcastChannel: null,

    // List available rooms for a game
    async listRooms(gameId) {
      const sb = getSupabase();
      
      const { data, error } = await sb
        .from('game_rooms')
        .select(`
          *,
          host:profiles!game_rooms_host_id_fkey(display_name, avatar_url),
          room_players(count)
        `)
        .eq('game_id', gameId)
        .eq('status', 'waiting')
        .eq('is_public', true)
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      
      return data.map(room => ({
        id: room.id,
        name: room.room_name,
        host: room.host.display_name,
        hostAvatar: room.host.avatar_url,
        playerCount: room.room_players.length,
        maxPlayers: room.max_players,
        settings: room.settings,
        createdAt: room.created_at
      }));
    },

    // Create a new room
    async createRoom(gameId, roomName, maxPlayers = 4, settings = {}) {
      const user = await NexusAuth.getUser();
      if (!user) throw new Error('Must be authenticated to create room');
      
      const sb = getSupabase();
      
      // Create room
      const { data: room, error: roomError } = await sb
        .from('game_rooms')
        .insert({
          game_id: gameId,
          host_id: user.id,
          room_name: roomName,
          max_players: maxPlayers,
          settings: settings
        })
        .select()
        .single();
      
      if (roomError) throw roomError;
      
      // Add host as player
      const { error: playerError } = await sb
        .from('room_players')
        .insert({
          room_id: room.id,
          player_id: user.id,
          is_host: true,
          is_ready: true
        });
      
      if (playerError) throw playerError;
      
      // Set up room state
      this.currentRoom = room;
      this.currentGameId = gameId;
      this.isHost = true;
      
      // Load initial players
      await this._loadPlayers();
      
      // Set up realtime subscriptions
      await this._setupRealtimeSubscriptions();
      
      return {
        roomId: room.id,
        roomCode: room.id.split('-')[0].toUpperCase(), // Use first part of UUID as display code
        isHost: true
      };
    },

    // Join an existing room
    async joinRoom(roomId) {
      const user = await NexusAuth.getUser();
      if (!user) throw new Error('Must be authenticated to join room');
      
      const sb = getSupabase();
      
      // Get room info
      const { data: room, error: roomError } = await sb
        .from('game_rooms')
        .select('*')
        .eq('id', roomId)
        .single();
      
      if (roomError) throw roomError;
      if (!room) throw new Error('Room not found');
      if (room.status !== 'waiting') throw new Error('Room is not accepting players');
      
      // Check if room is full
      const { count } = await sb
        .from('room_players')
        .select('*', { count: 'exact', head: true })
        .eq('room_id', roomId);
      
      if (count >= room.max_players) {
        throw new Error('Room is full');
      }
      
      // Join room
      const { error: joinError } = await sb
        .from('room_players')
        .insert({
          room_id: roomId,
          player_id: user.id,
          is_host: false,
          is_ready: false
        });
      
      if (joinError) {
        if (joinError.code === '23505') { // Already in room
          console.log('[NexusCloud] Already in room, continuing...');
        } else {
          throw joinError;
        }
      }
      
      // Set up room state
      this.currentRoom = room;
      this.currentGameId = room.game_id;
      this.isHost = false;
      
      // Load initial players
      await this._loadPlayers();
      
      // Set up realtime subscriptions
      await this._setupRealtimeSubscriptions();
      
      return {
        roomId: room.id,
        roomCode: room.id.split('-')[0].toUpperCase(),
        isHost: false
      };
    },

    // Load players in current room
    async _loadPlayers() {
      if (!this.currentRoom) return;
      
      const sb = getSupabase();
      const { data, error } = await sb
        .from('room_players')
        .select(`
          *,
          profile:profiles(*)
        `)
        .eq('room_id', this.currentRoom.id);
      
      if (error) throw error;
      
      this.players.clear();
      data.forEach(player => {
        this.players.set(player.player_id, {
          id: player.player_id,
          name: player.profile.display_name,
          avatar: player.profile.avatar_url,
          isHost: player.is_host,
          isReady: player.is_ready,
          joinedAt: player.joined_at
        });
      });
    },

    // Set up realtime subscriptions for room updates
    async _setupRealtimeSubscriptions() {
      if (!this.currentRoom) return;
      
      const sb = getSupabase();
      
      // Subscribe to room updates
      this._roomSubscription = sb
        .channel(`room:${this.currentRoom.id}`)
        .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'game_rooms',
          filter: `id=eq.${this.currentRoom.id}`
        }, (payload) => {
          console.log('[NexusCloud] Room updated:', payload);
          if (payload.eventType === 'UPDATE') {
            this.currentRoom = { ...this.currentRoom, ...payload.new };
          }
        })
        .subscribe();
      
      // Subscribe to player changes
      this._playersSubscription = sb
        .channel(`players:${this.currentRoom.id}`)
        .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'room_players',
          filter: `room_id=eq.${this.currentRoom.id}`
        }, async (payload) => {
          console.log('[NexusCloud] Players updated:', payload);
          await this._loadPlayers();
          
          if (payload.eventType === 'INSERT' && this._onPlayerJoin) {
            const player = this.players.get(payload.new.player_id);
            if (player) this._onPlayerJoin(payload.new.player_id, player);
          } else if (payload.eventType === 'DELETE' && this._onPlayerLeave) {
            this._onPlayerLeave(payload.old.player_id, payload.old);
          }
        })
        .subscribe();
      
      // Set up broadcast channel for real-time messaging
      this._broadcastChannel = sb.channel(`broadcast:${this.currentRoom.id}`);
      this._broadcastChannel.subscribe();
    },

    // Send message to all players in room
    send(channel, data) {
      if (!this._broadcastChannel) {
        console.warn('[NexusCloud] Not connected to room');
        return;
      }
      
      this._broadcastChannel.send({
        type: 'broadcast',
        event: channel,
        payload: data
      });
    },

    // Listen for messages on a channel
    on(channel, callback) {
      if (!this._channels.has(channel)) {
        this._channels.set(channel, new Set());
      }
      this._channels.get(channel).add(callback);
      
      // Set up broadcast listener if not already done
      if (this._broadcastChannel) {
        this._broadcastChannel.on('broadcast', { event: channel }, (payload) => {
          const callbacks = this._channels.get(channel);
          if (callbacks) {
            callbacks.forEach(cb => cb(payload.payload));
          }
        });
      }
    },

    // Remove listener for a channel
    off(channel, callback = null) {
      if (!this._channels.has(channel)) return;
      
      if (callback) {
        this._channels.get(channel).delete(callback);
      } else {
        this._channels.get(channel).clear();
      }
    },

    // Set player join callback
    onPlayerJoin(callback) {
      this._onPlayerJoin = callback;
    },

    // Set player leave callback
    onPlayerLeave(callback) {
      this._onPlayerLeave = callback;
    },

    // Update player ready status
    async setReady(isReady) {
      const user = await NexusAuth.getUser();
      if (!user || !this.currentRoom) return;
      
      const sb = getSupabase();
      const { error } = await sb
        .from('room_players')
        .update({ is_ready: isReady })
        .eq('room_id', this.currentRoom.id)
        .eq('player_id', user.id);
      
      if (error) throw error;
    },

    // Start the game (host only)
    async startGame() {
      if (!this.isHost || !this.currentRoom) {
        throw new Error('Only host can start the game');
      }
      
      const sb = getSupabase();
      const { error } = await sb
        .from('game_rooms')
        .update({ status: 'playing' })
        .eq('id', this.currentRoom.id);
      
      if (error) throw error;
      
      this.currentRoom.status = 'playing';
    },

    // Leave current room
    async leave() {
      if (!this.currentRoom) return;
      
      const user = await NexusAuth.getUser();
      if (user) {
        const sb = getSupabase();
        await sb
          .from('room_players')
          .delete()
          .eq('room_id', this.currentRoom.id)
          .eq('player_id', user.id);
      }
      
      // Clean up subscriptions
      if (this._roomSubscription) {
        this._roomSubscription.unsubscribe();
        this._roomSubscription = null;
      }
      
      if (this._playersSubscription) {
        this._playersSubscription.unsubscribe();
        this._playersSubscription = null;
      }
      
      if (this._broadcastChannel) {
        this._broadcastChannel.unsubscribe();
        this._broadcastChannel = null;
      }
      
      // Reset state
      this.currentRoom = null;
      this.currentGameId = null;
      this.isHost = false;
      this.players.clear();
      this._channels.clear();
    },

    // Get current room info
    getRoomInfo() {
      return this.currentRoom;
    },

    // Check if all players are ready
    allPlayersReady() {
      for (const player of this.players.values()) {
        if (!player.isReady) return false;
      }
      return this.players.size > 0;
    }
  };

  // Export to global scope
  window.NexusCloud = NexusCloud;

})();