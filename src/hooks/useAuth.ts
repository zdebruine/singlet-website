/**
 * useAuth.ts — v0.9.0 open-access stub.
 *
 * Auth is disabled for v0.9.0 (no Supabase). This hook always returns
 * user=null / session=null / loading=false. The Auth page and ProtectedRoute
 * remain in the tree but are inert.
 */

export const useAuth = () => {
  return {
    user: null,
    session: null,
    loading: false,
    signOut: async () => {},
    isConfigured: false,
  };
};
