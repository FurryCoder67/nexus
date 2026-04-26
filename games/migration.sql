-- =============================================================================
-- NEXUS Cloud Multiplayer — Database Migration
-- Run this SQL in your Supabase dashboard → SQL Editor
-- =============================================================================

-- Enable Row Level Security
ALTER DATABASE postgres SET "app.jwt_secret" TO 'your-jwt-secret';

-- Create profiles table
CREATE TABLE IF NOT EXISTS profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  avatar_url TEXT,
  xp INTEGER DEFAULT 0,
  level INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS on profiles
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Profiles policies
CREATE POLICY "Users can view all profiles" ON profiles FOR SELECT USING (true);
CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE USING (auth.uid() = id);

-- Create game_rooms table
CREATE TABLE IF NOT EXISTS game_rooms (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  game_id TEXT NOT NULL,
  host_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  room_name TEXT NOT NULL,
  status TEXT DEFAULT 'waiting' CHECK (status IN ('waiting', 'playing', 'finished')),
  max_players INTEGER DEFAULT 4,
  is_public BOOLEAN DEFAULT true,
  settings JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS on game_rooms
ALTER TABLE game_rooms ENABLE ROW LEVEL SECURITY;

-- Game rooms policies
CREATE POLICY "Anyone can view public rooms" ON game_rooms FOR SELECT USING (is_public = true);
CREATE POLICY "Host can manage their rooms" ON game_rooms FOR ALL USING (auth.uid() = host_id);

-- Create room_players table
CREATE TABLE IF NOT EXISTS room_players (
  room_id UUID REFERENCES game_rooms(id) ON DELETE CASCADE,
  player_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  is_host BOOLEAN DEFAULT false,
  is_ready BOOLEAN DEFAULT false,
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (room_id, player_id)
);

-- Enable RLS on room_players
ALTER TABLE room_players ENABLE ROW LEVEL SECURITY;

-- Room players policies
CREATE POLICY "Players can view room members" ON room_players FOR SELECT USING (true);
CREATE POLICY "Players can join/leave rooms" ON room_players FOR INSERT USING (auth.uid() = player_id);
CREATE POLICY "Players can update their own status" ON room_players FOR UPDATE USING (auth.uid() = player_id);
CREATE POLICY "Players can leave rooms" ON room_players FOR DELETE USING (auth.uid() = player_id);

-- Create game_stats table
CREATE TABLE IF NOT EXISTS game_stats (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  player_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  game_id TEXT NOT NULL,
  score INTEGER DEFAULT 0,
  won BOOLEAN DEFAULT false,
  playtime_seconds INTEGER DEFAULT 0,
  extra JSONB DEFAULT '{}',
  recorded_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS on game_stats
ALTER TABLE game_stats ENABLE ROW LEVEL SECURITY;

-- Game stats policies
CREATE POLICY "Anyone can view stats" ON game_stats FOR SELECT USING (true);
CREATE POLICY "Players can insert their own stats" ON game_stats FOR INSERT USING (auth.uid() = player_id);

-- Create leaderboards view
CREATE OR REPLACE VIEW leaderboards AS
SELECT 
  game_id,
  player_id,
  p.display_name,
  p.avatar_url,
  MAX(score) as best_score,
  COUNT(CASE WHEN won THEN 1 END) as total_wins,
  COUNT(*) as total_games,
  SUM(playtime_seconds) as total_playtime,
  ROW_NUMBER() OVER (PARTITION BY game_id ORDER BY MAX(score) DESC) as rank
FROM game_stats gs
JOIN profiles p ON gs.player_id = p.id
GROUP BY game_id, player_id, p.display_name, p.avatar_url
ORDER BY game_id, rank;

-- Create global leaderboard view
CREATE OR REPLACE VIEW global_leaderboard AS
SELECT 
  player_id,
  p.display_name,
  p.avatar_url,
  p.xp,
  p.level,
  COUNT(CASE WHEN won THEN 1 END) as total_wins,
  COUNT(*) as total_games,
  SUM(playtime_seconds) as total_playtime,
  ROW_NUMBER() OVER (ORDER BY p.xp DESC) as rank
FROM game_stats gs
JOIN profiles p ON gs.player_id = p.id
GROUP BY player_id, p.display_name, p.avatar_url, p.xp, p.level
ORDER BY rank;

-- Function to auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, username, display_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'username', 'Player' || substr(NEW.id::text, 1, 8)),
    COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.raw_user_meta_data->>'full_name', 'Player'),
    NEW.raw_user_meta_data->>'avatar_url'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to create profile on user signup
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Function to clean up finished rooms
CREATE OR REPLACE FUNCTION cleanup_finished_rooms()
RETURNS void AS $$
BEGIN
  DELETE FROM game_rooms 
  WHERE status = 'finished' 
  AND created_at < NOW() - INTERVAL '1 minute';
END;
$$ LANGUAGE plpgsql;

-- Enable Realtime for live updates
ALTER PUBLICATION supabase_realtime ADD TABLE game_rooms;
ALTER PUBLICATION supabase_realtime ADD TABLE room_players;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_game_rooms_game_id ON game_rooms(game_id);
CREATE INDEX IF NOT EXISTS idx_game_rooms_status ON game_rooms(status);
CREATE INDEX IF NOT EXISTS idx_game_stats_player_game ON game_stats(player_id, game_id);
CREATE INDEX IF NOT EXISTS idx_game_stats_score ON game_stats(game_id, score DESC);

-- Grant necessary permissions
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;

-- Success message
SELECT 'NEXUS Cloud Multiplayer database setup complete!' as message;