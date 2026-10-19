import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/integrations/api/client";
import { useAuth } from "@/components/auth/AuthProvider";
import type { Library } from "@/integrations/api/types";

const KEY = ["libraries"];

/** The signed-in user's libraries and the actions on them. Signed-out visitors get an empty list. */
export function useLibraries() {
  const { user, openSignIn } = useAuth();
  const qc = useQueryClient();
  const query = useQuery({ queryKey: KEY, queryFn: () => apiClient.library.list(), enabled: !!user, staleTime: 60_000 });
  // Every call returns the updated list, so the cache is replaced instead of refetched.
  const set = (libs: Library[]) => qc.setQueryData(KEY, libs);

  const create = useMutation({ mutationFn: (v: { name: string; gseIds?: string[] }) => apiClient.library.create(v.name, v.gseIds ?? []), onSuccess: set });
  const rename = useMutation({ mutationFn: (v: { id: string; name: string }) => apiClient.library.rename(v.id, v.name), onSuccess: set });
  const remove = useMutation({ mutationFn: (id: string) => apiClient.library.remove(id), onSuccess: set });
  const add = useMutation({ mutationFn: (v: { id: string; gseIds: string[] }) => apiClient.library.add(v.id, v.gseIds), onSuccess: set });
  const removeItems = useMutation({ mutationFn: (v: { id: string; gseIds: string[] }) => apiClient.library.removeItems(v.id, v.gseIds), onSuccess: set });

  /** Run `fn` when signed in; otherwise open the sign-in dialog. */
  const requireSignIn = useCallback(
    (fn: () => void) => {
      if (user) fn();
      else openSignIn({ reason: "Sign in to keep a library of studies." });
    },
    [user, openSignIn],
  );

  return {
    signedIn: !!user,
    libraries: query.data ?? [],
    loading: query.isLoading && !!user,
    create,
    rename,
    remove,
    add,
    removeItems,
    requireSignIn,
  };
}
