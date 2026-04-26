# NEXUS Cloud Multiplayer Setup Guide

This guide will help you set up the cloud multiplayer system for NEXUS games using Supabase.

## Prerequisites

- A free Supabase account (https://supabase.com)
- Basic understanding of web development

## Step 1: Create Supabase Project

1. Go to https://supabase.com and sign up/sign in
2. Click "New Project"
3. Choose your organization
4. Enter project name: "nexus-multiplayer"
5. Enter a secure database password
6. Choose a region close to your users
7. Click "Create new project"

## Step 2: Configure Authentication

1. In your Supabase dashboard, go to **Authentication** → **Providers**
2. Enable the providers you want:

### Google OAuth (Recommended)
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing one
3. Enable Google+ API
4. Go to **Credentials** → **Create Credentials** → **OAuth 2.0 Client IDs**
5. Set application type to "Web application"
6. Add authorized redirect URIs:
   - `https://your-project-ref.supabase.co/auth/v1/callback`
7. Copy Client ID and Client Secret
8. In Supabase, paste them into Google provider settings

### Discord OAuth (Optional)
1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create new application
3. Go to **OAuth2** section
4. Copy Client ID and Client Secret
5. Add redirect URL: `https://your-project-ref.supabase.co/auth/v1/callback`
6. In Supabase, paste them into Discord provider settings

### Email/Password
- Already enabled by default
- No additional configuration needed

## Step 3: Set Up Database

1. In Supabase dashboard, go to **SQL Editor**
2. Copy the contents of `games/migration.sql`
3. Paste into the SQL editor
4. Click **Run** to execute the migration
5. Verify tables were created in **Database** → **Tables**

## Step 4: Configure NEXUS

1. In Supabase dashboard, go to **Settings** → **API**
2. Copy your **Project URL** and **anon public** key
3. Open `games/nexus-config.js`
4. Replace the placeholder values:

```javascript
window.NEXUS_SUPABASE_URL = 'https://your-project-ref.supabase.co';
window.NEXUS_SUPABASE_ANON_KEY = 'your-anon-key-here';
```

## Step 5: Enable Realtime (Optional)

For real-time multiplayer features:

1. Go to **Database** → **Replication**
2. Enable replication for these tables:
   - `game_rooms`
   - `room_players`

## Step 6: Test the Setup

1. Open `login.html` in your browser
2. Try signing in with your configured providers
3. Create a test room in any game
4. Verify data appears in Supabase dashboard

## Security Notes

- Never commit your actual Supabase credentials to version control
- Use environment variables in production
- Review Row Level Security (RLS) policies in the database
- Consider rate limiting for production use

## Troubleshooting

### "Invalid credentials" error
- Double-check your Supabase URL and anon key
- Ensure the keys are correctly pasted without extra spaces

### OAuth not working
- Verify redirect URLs match exactly
- Check that OAuth apps are properly configured
- Ensure OAuth providers are enabled in Supabase

### Database errors
- Verify the migration SQL ran successfully
- Check that RLS policies are properly set up
- Ensure tables exist in the database

### Multiplayer connection issues
- Check browser console for errors
- Verify user is authenticated before joining rooms
- Ensure Realtime is enabled for the necessary tables

## Production Deployment

For production deployment:

1. Set up a custom domain
2. Configure proper CORS settings
3. Set up monitoring and logging
4. Consider using Supabase Edge Functions for complex logic
5. Implement proper error handling and user feedback

## Support

If you encounter issues:

1. Check the browser console for error messages
2. Verify your Supabase configuration
3. Test with a fresh Supabase project
4. Check Supabase documentation for the latest API changes

## Features Included

✅ User authentication (Google, Discord, Email, Guest)  
✅ Real-time multiplayer rooms  
✅ Player statistics and leaderboards  
✅ Cross-game progression system  
✅ Persistent user profiles  
✅ Game statistics tracking  
✅ Activity feeds  
✅ Responsive design  

The system is designed to be serverless and scales automatically with Supabase's infrastructure.