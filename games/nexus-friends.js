// =============================================================================
// NEXUS Friends — Friend System Module
// Handles friend requests, acceptance, and friend lists
// =============================================================================

(function () {
    'use strict';

    if (typeof supabase === 'undefined') {
        console.error('[NexusFriends] Supabase not loaded.');
        return;
    }

    if (typeof NexusAuth === 'undefined') {
        console.error('[NexusFriends] NexusAuth not loaded.');
        return;
    }

    let _supabase = null;

    function getSupabase() {
        if (!_supabase) {
            if (!window.NEXUS_SUPABASE_URL || !window.NEXUS_SUPABASE_ANON_KEY) {
                throw new Error('Supabase credentials not configured');
            }
            _supabase = supabase.createClient(
                window.NEXUS_SUPABASE_URL,
                window.NEXUS_SUPABASE_ANON_KEY
            );
        }
        return _supabase;
    }

    const NexusFriends = {

        // Send friend request
        async sendFriendRequest(friendId) {
            const user = await NexusAuth.getUser();
            if (!user) throw new Error('Must be authenticated');

            if (user.id === friendId) {
                throw new Error('Cannot send friend request to yourself');
            }

            const sb = getSupabase();

            // Check if friendship already exists
            const { data: existing } = await sb
                .from('friends')
                .select('*')
                .or(`and(user_id.eq.${user.id},friend_id.eq.${friendId}),and(user_id.eq.${friendId},friend_id.eq.${user.id})`)
                .single();

            if (existing) {
                if (existing.status === 'accepted') {
                    throw new Error('Already friends');
                } else if (existing.status === 'pending') {
                    throw new Error('Friend request already sent');
                } else if (existing.status === 'blocked') {
                    throw new Error('Cannot send friend request');
                }
            }

            // Create friend request
            const { data, error } = await sb
                .from('friends')
                .insert({
                    user_id: user.id,
                    friend_id: friendId,
                    status: 'pending'
                })
                .select()
                .single();

            if (error) throw error;
            return data;
        },

        // Accept friend request
        async acceptFriendRequest(friendshipId) {
            const user = await NexusAuth.getUser();
            if (!user) throw new Error('Must be authenticated');

            const sb = getSupabase();

            const { data, error } = await sb
                .from('friends')
                .update({ status: 'accepted' })
                .eq('id', friendshipId)
                .eq('friend_id', user.id)
                .select()
                .single();

            if (error) throw error;
            return data;
        },

        // Reject/remove friend request
        async rejectFriendRequest(friendshipId) {
            const user = await NexusAuth.getUser();
            if (!user) throw new Error('Must be authenticated');

            const sb = getSupabase();

            const { error } = await sb
                .from('friends')
                .delete()
                .eq('id', friendshipId)
                .eq('friend_id', user.id);

            if (error) throw error;
        },

        // Remove friend
        async removeFriend(friendshipId) {
            const user = await NexusAuth.getUser();
            if (!user) throw new Error('Must be authenticated');

            const sb = getSupabase();

            const { error } = await sb
                .from('friends')
                .delete()
                .eq('id', friendshipId)
                .or(`user_id.eq.${user.id},friend_id.eq.${user.id}`);

            if (error) throw error;
        },

        // Get friend list
        async getFriends() {
            const user = await NexusAuth.getUser();
            if (!user) return [];

            const sb = getSupabase();

            const { data, error } = await sb
                .from('friends')
                .select(`
          id,
          status,
          created_at,
          user:profiles!friends_user_id_fkey(id, display_name, avatar_url, xp, level),
          friend:profiles!friends_friend_id_fkey(id, display_name, avatar_url, xp, level)
        `)
                .or(`user_id.eq.${user.id},friend_id.eq.${user.id}`)
                .eq('status', 'accepted');

            if (error) throw error;

            // Map to friend objects
            return data.map(friendship => {
                const isSender = friendship.user.id === user.id;
                const friend = isSender ? friendship.friend : friendship.user;
                return {
                    friendshipId: friendship.id,
                    id: friend.id,
                    displayName: friend.display_name,
                    avatarUrl: friend.avatar_url,
                    xp: friend.xp,
                    level: friend.level,
                    status: 'online', // TODO: implement presence
                    createdAt: friendship.created_at
                };
            });
        },

        // Get pending friend requests (received)
        async getPendingRequests() {
            const user = await NexusAuth.getUser();
            if (!user) return [];

            const sb = getSupabase();

            const { data, error } = await sb
                .from('friends')
                .select(`
          id,
          created_at,
          user:profiles!friends_user_id_fkey(id, display_name, avatar_url, xp, level)
        `)
                .eq('friend_id', user.id)
                .eq('status', 'pending');

            if (error) throw error;

            return data.map(request => ({
                friendshipId: request.id,
                id: request.user.id,
                displayName: request.user.display_name,
                avatarUrl: request.user.avatar_url,
                xp: request.user.xp,
                level: request.user.level,
                createdAt: request.created_at
            }));
        },

        // Get sent friend requests
        async getSentRequests() {
            const user = await NexusAuth.getUser();
            if (!user) return [];

            const sb = getSupabase();

            const { data, error } = await sb
                .from('friends')
                .select(`
          id,
          created_at,
          friend:profiles!friends_friend_id_fkey(id, display_name, avatar_url, xp, level)
        `)
                .eq('user_id', user.id)
                .eq('status', 'pending');

            if (error) throw error;

            return data.map(request => ({
                friendshipId: request.id,
                id: request.friend.id,
                displayName: request.friend.display_name,
                avatarUrl: request.friend.avatar_url,
                xp: request.friend.xp,
                level: request.friend.level,
                createdAt: request.created_at
            }));
        },

        // Search for players to add as friends
        async searchPlayers(query, limit = 10) {
            const user = await NexusAuth.getUser();
            if (!user) return [];

            const sb = getSupabase();

            const { data, error } = await sb
                .from('profiles')
                .select('id, username, display_name, avatar_url, xp, level')
                .neq('id', user.id)
                .or(`username.ilike.%${query}%,display_name.ilike.%${query}%`)
                .order('xp', { ascending: false })
                .limit(limit);

            if (error) throw error;

            // Check friendship status for each player
            const playerIds = data.map(p => p.id);
            const { data: friendships } = await sb
                .from('friends')
                .select('user_id, friend_id, status')
                .or(`and(user_id.eq.${user.id},friend_id.in.(${playerIds.join(',')})),and(user_id.in.(${playerIds.join(',')}),friend_id.eq.${user.id})`);

            return data.map(player => {
                const friendship = friendships?.find(f =>
                    (f.user_id === user.id && f.friend_id === player.id) ||
                    (f.user_id === player.id && f.friend_id === user.id)
                );

                return {
                    id: player.id,
                    username: player.username,
                    displayName: player.display_name,
                    avatarUrl: player.avatar_url,
                    xp: player.xp,
                    level: player.level,
                    friendshipStatus: friendship ? friendship.status : null,
                    isSender: friendship ? friendship.user_id === user.id : false
                };
            });
        },

        // Get online friends (with presence)
        async getOnlineFriends() {
            const friends = await this.getFriends();
            // TODO: Implement real presence tracking
            // For now, randomly mark some as online for demo
            return friends.map(friend => ({
                ...friend,
                isOnline: Math.random() > 0.5,
                currentGame: Math.random() > 0.7 ? 'HUNTERS' : null
            }));
        }
    };

    window.NexusFriends = NexusFriends;

})();
