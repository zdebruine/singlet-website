import { useState, useEffect, useCallback, useRef } from "react";
import type { User, Session } from "@supabase/supabase-js";

const hasAuthConfig = Boolean(
  import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
);

export const useAuth = () => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(hasAuthConfig);
  const signOutRef = useRef<(() => Promise<void>) | null>(null);

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;

    if (!hasAuthConfig) {
      setLoading(false);
      return;
    }

    const initializeAuth = async () => {
      try {
        const { supabase } = await import("@/integrations/supabase/client");
        if (!active) return;

        signOutRef.current = async () => {
          await supabase.auth.signOut();
        };

        const {
          data: { subscription },
        } = supabase.auth.onAuthStateChange((_event, nextSession) => {
          if (!active) return;
          setSession(nextSession);
          setUser(nextSession?.user ?? null);
          setLoading(false);
        });

        unsubscribe = () => subscription.unsubscribe();

        const {
          data: { session: initialSession },
        } = await supabase.auth.getSession();

        if (!active) return;
        setSession(initialSession);
        setUser(initialSession?.user ?? null);
      } catch (error) {
        console.error("Auth initialization failed.", error);
        if (!active) return;
        setSession(null);
        setUser(null);
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void initializeAuth();

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  const signOut = useCallback(async () => {
    await signOutRef.current?.();
  }, []);

  return { user, session, loading, signOut, isConfigured: hasAuthConfig };
};
