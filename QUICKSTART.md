# 🚀 NEXUS Quick Start Guide

Get your NEXUS gaming platform up and running in 15 minutes!

## Prerequisites

- A Supabase account (free tier is perfect)
- A code editor
- A web browser

## Step 1: Create Supabase Project (5 minutes)

1. Go to [supabase.com](https://supabase.com) and sign in
2. Click **"New Project"**
3. Fill in:
   - **Name**: `nexus-gaming`
   - **Database Password**: Choose a strong password (save it!)
   - **Region**: Choose closest to you
4. Click **"Create new project"**
5. Wait for project to be created (~2 minutes)

## Step 2: Set Up Database (3 minutes)

1. In your Supabase dashboard, click **"SQL Editor"** in the left sidebar
2. Click **"New query"**
3. Open `games/migration.sql` from this project
4. Copy ALL the SQL code
5. Paste it into the Supabase SQL Editor
6. Click **"Run"** (bottom right)
7. You should see: `"NEXUS Cloud Multiplayer database setup complete!"`

✅ Your database is now ready with all tables, views, and security policies!

## Step 3: Configure Authentication (3 minutes)

### Enable Email/Password (Already enabled by default)
- Go to **Authentication** → **Providers**
- Email provider should already be enabled ✅

### Optional: Enable Google OAuth
1. Go to **Authentication** → **Providers** → **Google**
2. Toggle **"Enable Sign in with Google"**
3. For testing, you can use Supabase's development credentials
4. For production, follow the Google OAuth setup in SETUP.md

### Optional: Enable Discord OAuth
1. Go to **Authentication** → **Providers** → **Discord**
2. Toggle **"Enable Sign in with Discord"**
3. For testing, you can use Supabase's development credentials
4. For production, follow the Discord OAuth setup in SETUP.md

## Step 4: Get Your Credentials (1 minute)

1. In Supabase dashboard, click **"Settings"** (gear icon) in left sidebar
2. Click **"API"**
3. Copy these two values:
   - **Project URL** (looks like: `https://xxxxx.supabase.co`)
   - **anon public** key (long string starting with `eyJ...`)

## Step 5: Configure NEXUS (1 minute)

1. Open `games/nexus-config.js` in your code editor
2. Replace the placeholder values:

```javascript
window.NEXUS_SUPABASE_URL = 'https://your-project-ref.supabase.co';
window.NEXUS_SUPABASE_ANON_KEY = 'your-anon-key-here';
```

With your actual values:

```javascript
window.NEXUS_SUPABASE_URL = 'https://xxxxx.supabase.co';
window.NEXUS_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...';
```

3. Save the file

## Step 6: Run Locally (2 minutes)

### Option A: Using Python
```bash
python -m http.server 8000
```

### Option B: Using Node.js
```bash
npx serve
```

### Option C: Using VS Code
1. Install "Live Server" extension
2. Right-click `index.html`
3. Click "Open with Live Server"

## Step 7: Test It Out! (2 minutes)

1. Open your browser to `http://localhost:8000` (or whatever port you're using)
2. Click **"Sign In"** in the top right
3. Create an account with email/password or use OAuth
4. You should be redirected back to the main page
5. Your username initial should appear in the top right
6. Try playing a game:
   - Click on **"Technique Duel"** or **"Energy Clicker"**
   - Play the game
   - Your stats will be saved automatically!
7. Check the leaderboard - you should see yourself there!
8. Try the friends system:
   - Click the Friends icon in the sidebar
   - Search for players (you'll need another account to test)

## 🎉 You're Done!

Your NEXUS platform is now fully functional with:
- ✅ Real authentication
- ✅ Cloud database
- ✅ Stats tracking
- ✅ Leaderboards
- ✅ Friends system
- ✅ Rating system

## Next Steps

### Deploy to Production

**Vercel (Recommended)**
```bash
npm install -g vercel
vercel deploy
```

**Netlify**
```bash
npm install -g netlify-cli
netlify deploy
```

**GitHub Pages**
1. Push to GitHub
2. Go to repository Settings → Pages
3. Select branch and deploy

### Add More Games

1. Create a new folder in `games/`
2. Create `index.html` with your game
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
  score: finalScore,
  won: didWin,
  playtime_seconds: playtime
});
```
5. Add rating UI:
```javascript
await NexusRatings.rateGame('your-game-id', rating);
```
6. Add to `nexus-config.js` NEXUS_GAMES
7. Add game card to `index.html`

### Customize Styling

All colors are defined in CSS variables:
```css
:root {
  --bg: #06040f;
  --accent: #7c3aed;
  --accent2: #06b6d4;
  /* etc. */
}
```

Change these to customize the entire platform!

## Troubleshooting

### "Invalid credentials" error
- Double-check your Supabase URL and anon key
- Make sure there are no extra spaces
- Verify you copied the **anon public** key, not the service role key

### OAuth not working
- For testing, use Supabase's development credentials
- For production, set up OAuth apps properly
- Check redirect URLs match exactly

### Leaderboard is empty
- Play some games first to generate data
- Check browser console for errors
- Verify database migration ran successfully

### Stats not saving
- Make sure you're signed in
- Check browser console for errors
- Verify `game_stats` table exists in Supabase

## Need Help?

1. Check `SETUP.md` for detailed instructions
2. Check `README.md` for full documentation
3. Check `IMPLEMENTATION_SUMMARY.md` for technical details
4. Check browser console for error messages
5. Check Supabase dashboard for database issues

## 🎮 Have Fun!

You now have a complete gaming platform with real authentication, social features, and cloud database. Start building your games and let players compete!

---

**NEXUS** - Where cursed energy meets cloud gaming ⚡🎮
