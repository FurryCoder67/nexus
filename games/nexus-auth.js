// =============================================================================
// NEXUS Auth — Supabase Authentication Module
// Handles sign-in/out, session management, and user profiles
// =============================================================================

(function() {
  'use strict';

  // Ensure Supabase is loaded
  if (typeof supabase === 'undefined') {
    console.error('[NexusAuth] Supabase not loaded. Include Supabase CDN before this script.');
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

  // Auth state
  let _currentUser = null;
  let _currentProfile = null;

  const NexusAuth = {
    
    // Get current user session
    async getUser() {
      const sb = getSupabase();
      const { data: { user } } = await sb.auth.getUser();
      _currentUser = user;
      
      if (user && !_currentProfile) {
        await this._loadProfile();
      }
      
      return user;
    },

    // Get current user profile
    getProfile() {
      return _currentProfile;
    },

    // Load user profile from database
    async _loadProfile() {
      if (!_currentUser) return null;
      
      const sb = getSupabase();
      const { data, error } = await sb
        .from('profiles')
        .select('*')
        .eq('id', _currentUser.id)
        .single();
      
      if (error) {
        console.error('[NexusAuth] Failed to load profile:', error);
        return null;
      }
      
      _currentProfile = data;
      return data;
    },

    // Check if user is authenticated, redirect to login if not
    async requireAuth() {
      const user = await this.getUser();
      
      if (!user) {
        const currentUrl = encodeURIComponent(window.location.href);
        window.location.href = `/login.html?returnTo=${currentUrl}`;
        return false;
      }
      
      return true;
    },

    // Sign in with email/password
    async signInWithEmail(email, password) {
      const sb = getSupabase();
      const { data, error } = await sb.auth.signInWithPassword({
        email,
        password
      });
      
      if (error) throw error;
      
      _currentUser = data.user;
      await this._loadProfile();
      
      return data;
    },

    // Sign up with email/password
    async signUpWithEmail(email, password, displayName) {
      const sb = getSupabase();
      const { data, error } = await sb.auth.signUp({
        email,
        password,
        options: {
          data: {
            display_name: displayName || 'Player'
          }
        }
      });
      
      if (error) throw error;
      return data;
    },

    // Sign in with OAuth provider (Google, Discord)
    async signInWithOAuth(provider) {
      const sb = getSupabase();
      const { data, error } = await sb.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: window.location.origin + '/login.html'
        }
      });
      
      if (error) throw error;
      return data;
    },

    // Sign in as guest (anonymous)
    async signInAsGuest() {
      const sb = getSupabase();
      const { data, error } = await sb.auth.signInAnonymously();
      
      if (error) throw error;
      
      _currentUser = data.user;
      await this._loadProfile();
      
      return data;
    },

    // Sign out
    async signOut() {
      const sb = getSupabase();
      const { error } = await sb.auth.signOut();
      
      if (error) throw error;
      
      _currentUser = null;
      _currentProfile = null;
      
      // Redirect to home page
      window.location.href = '/';
    },

    // Update user profile
    async updateProfile(updates) {
      if (!_currentUser) throw new Error('Not authenticated');
      
      const sb = getSupabase();
      const { data, error } = await sb
        .from('profiles')
        .update(updates)
        .eq('id', _currentUser.id)
        .select()
        .single();
      
      if (error) throw error;
      
      _currentProfile = data;
      return data;
    },

    // Listen for auth state changes
    onAuthStateChange(callback) {
      const sb = getSupabase();
      return sb.auth.onAuthStateChange(async (event, session) => {
        _currentUser = session?.user || null;
        
        if (_currentUser) {
          await this._loadProfile();
        } else {
          _currentProfile = null;
        }
        
        callback(event, session, _currentProfile);
      });
    },

    // Initialize auth state
    async init() {
      await this.getUser();
      
      // Set up auth state listener
      this.onAuthStateChange((event, session, profile) => {
        console.log('[NexusAuth] Auth state changed:', event, profile?.display_name);
      });
    }
  };

  // Auto-initialize when script loads
  document.addEventListener('DOMContentLoaded', () => {
    NexusAuth.init().catch(console.error);
  });

  // Export to global scope
  window.NexusAuth = NexusAuth;

})();