# NEXUS — Cursed Gaming Platform

A comprehensive cloud-powered gaming platform featuring real authentication, friends system, game ratings, leaderboards, and multiplayer capabilities.

## 🎮 Features

### Authentication
- **Google OAuth** - One-click sign-in with Google
- **Discord OAuth** - Gaming-focused authentication
- **Email/Password** - Traditional account creation
- **Guest Mode** - Anonymous play (upgradeable later)

### Social Features
- **Friends System** - Send, accept, and manage friend requests
- **Real Friends List** - See your actual friends, not fake bots
- **Friend Search** - Find players by username or display name
- **Online Status** - See which friends are online

### Game Features
- **Real Ratings** - Players rate games 1-5 stars, stored in database
- **Game Reviews** - Write and read reviews from other players
- **Real Leaderboards** - Actual player rankings, no fake data
- **Stats Tracking** - Track scores, wins, playtime across all games
- **XP & Leveling** - Global progression system
- **Cloud Multiplayer** - Real-time multiplayer rooms (coming soon to all games)

### Games Included
1. **HUNTERS** - JJK-themed FPS with cursed techniques
2. **Cursed Arena** - Arena combat game
3. **Domain Defender** - Tower defense with domains
4. **Grade Trials** - Rhythm-based combat
5. **Spirit Chase** - Horror survival
6. **Culling Colony** - Battle royale
7. **Technique Duel** - Quick rock-paper-scissors style duels
8. **Sorcerer's Path** - RPG adventure
9. **Binding Vow** - Strategy game
10. **Infinite Void** - Domain puzzle game
11. **Reverse Cursed** - Healing tactical game
12. **Sorcerer Quiz** - Trivia game

## 🚀 Quick Start

### Prerequisites
- A Supabase account (free tier works great)
- A web server or local development environment

### Setup Steps

1. **Create Supabase Project**
   - Go to [supabase.com](https://supabase.com)
   - Create a new project
   - Note your project URL and anon key

2. **Run Database Migration**
   - Open Supabase dashboard → SQL Editor
   - Copy contents of `games/migration.sql`
   - Run the SQL to create all tables

3. **Configure OAuth Providers** (Optional but recommended)
   
   **For Google:**
   - Go to [Google Cloud Console](https://console.cloud.google.com/)
   - Create OAuth 2.0 credentials
   - Add redirect URI: `https://your-project.supabase.co/auth/v1/callback`
   - Add credentials to Supabase → Authentication → Providers → Google
   
   **For Discord:**
   - Go to [Discord Developer Portal](https://discord.com/developers/applications)
   - Create new application
   - Add redirect URI: `https://your-project.supabase.co/auth/v1/callback`
   - Add credentials to Supabase → Authentication → Providers → Discord

4. **Update Configuration**
   - Open `games/nexus-config.js`
   - Replace `NEXUS_SUPABASE_URL` with your project URL
   - Replace `NEXUS_SUPABASE_ANON_KEY` with your anon key

5. **Deploy or Run Locally**
   - Deploy to any static hosting (Vercel, Netlify, GitHub Pages, etc.)
   - Or run locally with any web server

## 📁 Project Structure

```
nexus/
├── index.html                 # Main platform page
├── login.html                 # Authentication page
├── friends.html               # Friend management
├── profile.html               # User profile
├── multiplayer-lobby.html     # Multiplayer lobby
├── games/
│   ├── nexus-config.js        # Supabase configuration
│   ├── nexus-auth.js          # Authentication module
│   ├── nexus-db.js            # Database operations
│   ├── nexus-cloud.js         # Multiplayer system
│   ├── nexus-friends.js       # Friends system
│   ├── nexus-ratings.js       # Rating system
│   ├── migration.sql          # Database schema
│   ├── jujutsuhunters/        # HUNTERS game
│   ├── technique-duel/        # Technique Duel game
│   └── [other games]/
├── SETUP.md                   # Detailed setup guide
├── IMPLEMENTATION_SUMMARY.md  # Technical documentation
└── README.md                  # This file
```

## 🎯 How It Works

### Authentication Flow
1. User clicks "Sign In" → redirected to `login.html`
2. User chooses OAuth provider or email/password
3. Supabase handles authentication
4. User redirected back with session token
5. Profile automatically created in database

### Friends System
1. Search for players by name
2. Send friend request → stored in `friends` table with status "pending"
3. Recipient sees request in Friends page
4. Accept → status changes to "accepted"
5. Both users see each other in friends list

### Rating System
1. Play a game
2. Rate 1-5 stars → stored in `game_ratings` table
3. Average calculated via SQL view
4. Ratings displayed on game cards

### Leaderboard System
1. Game ends → stats saved to `game_stats` table
2. XP calculated and added to profile
3. Leaderboard view aggregates data
4. Rankings updated in real-time

## 🔧 Customization

### Adding a New Game

1. Create game folder in `games/`
2. Create `index.html` with game code
3. Include Nexus modules:
   ```html
   <script src="/games/nexus-config.js"></script>
   <script src="/games/nexus-auth.js"></script>
   <script src="/games/nexus-db.js"></script>
   <script src="/games/nexus-ratings.js"></script>
   ```
4. Save stats on game end:
   ```javascript
   await NexusDB.saveStats('your-game-id', {
     score: playerScore,
     won: didWin,
     playtime_seconds: playtime
   });
   ```
5. Add rating UI:
   ```javascript
   await NexusRatings.rateGame('your-game-id', rating);
   ```
6. Add game to `nexus-config.js` NEXUS_GAMES object
7. Add game card to `index.html`

### Styling
- Main colors defined in CSS variables in each HTML file
- Theme: Dark background with purple/cyan accents
- Modify `:root` variables to change color scheme

## 📊 Database Schema

### Core Tables
- **profiles** - User accounts with XP and level
- **friends** - Friend relationships
- **game_ratings** - Player ratings for games
- **game_stats** - Individual game sessions
- **game_rooms** - Multiplayer rooms
- **room_players** - Players in rooms

### Views
- **leaderboards** - Per-game rankings
- **global_leaderboard** - Cross-game rankings
- **game_ratings_summary** - Average ratings per game

## 🔒 Security

- Row Level Security (RLS) enabled on all tables
- Users can only modify their own data
- OAuth tokens handled securely by Supabase
- No sensitive data in client code
- Input validation on all forms

## 🚀 Deployment

### Vercel
```bash
vercel deploy
```

### Netlify
```bash
netlify deploy
```

### GitHub Pages
1. Push to GitHub
2. Enable Pages in repository settings
3. Deploy from main branch

## 📝 Environment Variables

For production, consider using environment variables:
- `NEXUS_SUPABASE_URL` - Your Supabase project URL
- `NEXUS_SUPABASE_ANON_KEY` - Your Supabase anon key

## 🐛 Troubleshooting

### "Invalid credentials" error
- Check that Supabase URL and key are correct
- Ensure no extra spaces in config

### OAuth not working
- Verify redirect URLs match exactly
- Check OAuth app is enabled in Supabase
- Ensure OAuth credentials are correct

### Leaderboard empty
- Play some games to generate data
- Check browser console for errors
- Verify database migration ran successfully

### Friends not loading
- Ensure user is authenticated
- Check browser console for errors
- Verify friends table exists in database

## 📚 Documentation

- **SETUP.md** - Detailed setup instructions
- **IMPLEMENTATION_SUMMARY.md** - Technical architecture
- **Supabase Docs** - [supabase.com/docs](https://supabase.com/docs)

## 🎮 Play Now

1. Set up your Supabase project
2. Configure the credentials
3. Deploy or run locally
4. Visit the site and sign in
5. Start playing and competing!

## 🤝 Contributing

This is a demonstration project showing how to build a complete gaming platform with:
- Real authentication
- Social features (friends)
- User-generated content (ratings)
- Real-time features (multiplayer)
- Cloud database (Supabase)

Feel free to fork and customize for your own projects!

## 📄 License

This project is open source and available for educational purposes.

## 🎉 Credits

Built with:
- [Supabase](https://supabase.com) - Backend and authentication
- Vanilla JavaScript - No frameworks needed
- CSS3 - Modern styling with gradients and animations
- HTML5 Canvas - For particle effects

---

**NEXUS** - Where cursed energy meets cloud gaming 🎮⚡
