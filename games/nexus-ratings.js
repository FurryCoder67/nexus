// =============================================================================
// NEXUS Ratings — Game Rating System
// Handles game ratings and reviews from real players
// =============================================================================

(function () {
    'use strict';

    if (typeof supabase === 'undefined') {
        console.error('[NexusRatings] Supabase not loaded.');
        return;
    }

    if (typeof NexusAuth === 'undefined') {
        console.error('[NexusRatings] NexusAuth not loaded.');
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

    const NexusRatings = {

        // Rate a game
        async rateGame(gameId, rating, review = null) {
            const user = await NexusAuth.getUser();
            if (!user) throw new Error('Must be authenticated to rate games');

            if (rating < 1 || rating > 5) {
                throw new Error('Rating must be between 1 and 5');
            }

            const sb = getSupabase();

            // Upsert rating (insert or update if exists)
            const { data, error } = await sb
                .from('game_ratings')
                .upsert({
                    player_id: user.id,
                    game_id: gameId,
                    rating: rating,
                    review: review,
                    updated_at: new Date().toISOString()
                }, {
                    onConflict: 'player_id,game_id'
                })
                .select()
                .single();

            if (error) throw error;
            return data;
        },

        // Get user's rating for a game
        async getMyRating(gameId) {
            const user = await NexusAuth.getUser();
            if (!user) return null;

            const sb = getSupabase();

            const { data, error } = await sb
                .from('game_ratings')
                .select('*')
                .eq('player_id', user.id)
                .eq('game_id', gameId)
                .single();

            if (error && error.code !== 'PGRST116') throw error;
            return data;
        },

        // Get average rating for a game
        async getGameRating(gameId) {
            const sb = getSupabase();

            const { data, error } = await sb
                .from('game_ratings_summary')
                .select('*')
                .eq('game_id', gameId)
                .single();

            if (error && error.code !== 'PGRST116') {
                // No ratings yet
                return {
                    gameId,
                    totalRatings: 0,
                    averageRating: 0,
                    distribution: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 }
                };
            }

            if (!data) {
                return {
                    gameId,
                    totalRatings: 0,
                    averageRating: 0,
                    distribution: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 }
                };
            }

            return {
                gameId,
                totalRatings: data.total_ratings,
                averageRating: parseFloat(data.average_rating).toFixed(1),
                distribution: {
                    5: data.five_star,
                    4: data.four_star,
                    3: data.three_star,
                    2: data.two_star,
                    1: data.one_star
                }
            };
        },

        // Get all ratings for all games
        async getAllGameRatings() {
            const sb = getSupabase();

            const { data, error } = await sb
                .from('game_ratings_summary')
                .select('*');

            if (error) throw error;

            const ratings = {};
            data.forEach(game => {
                ratings[game.game_id] = {
                    totalRatings: game.total_ratings,
                    averageRating: parseFloat(game.average_rating).toFixed(1),
                    distribution: {
                        5: game.five_star,
                        4: game.four_star,
                        3: game.three_star,
                        2: game.two_star,
                        1: game.one_star
                    }
                };
            });

            return ratings;
        },

        // Get recent reviews for a game
        async getGameReviews(gameId, limit = 10) {
            const sb = getSupabase();

            const { data, error } = await sb
                .from('game_ratings')
                .select(`
          *,
          profile:profiles(display_name, avatar_url, level)
        `)
                .eq('game_id', gameId)
                .not('review', 'is', null)
                .order('updated_at', { ascending: false })
                .limit(limit);

            if (error) throw error;

            return data.map(review => ({
                id: review.id,
                playerId: review.player_id,
                playerName: review.profile.display_name,
                playerAvatar: review.profile.avatar_url,
                playerLevel: review.profile.level,
                rating: review.rating,
                review: review.review,
                createdAt: review.created_at,
                updatedAt: review.updated_at
            }));
        },

        // Delete user's rating
        async deleteRating(gameId) {
            const user = await NexusAuth.getUser();
            if (!user) throw new Error('Must be authenticated');

            const sb = getSupabase();

            const { error } = await sb
                .from('game_ratings')
                .delete()
                .eq('player_id', user.id)
                .eq('game_id', gameId);

            if (error) throw error;
        }
    };

    window.NexusRatings = NexusRatings;

})();
