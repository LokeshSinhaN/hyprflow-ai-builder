import { createContext, useContext } from "react";
import type { User, Session } from "@supabase/supabase-js";

// Completely auth-free dev implementation of auth context.
// No calls to Supabase auth; the app always sees a "Dev User" as an approved admin.

interface AuthContextType {
  user: User | null;
  session: Session | null;
  userProfile: any | null;
  isApproved: boolean;
  isAdmin: boolean;
  signIn: (email: string, password: string) => Promise<{ error: any }>;
  signUp: (email: string, password: string, fullName: string) => Promise<{ error: any }>;
  signOut: () => Promise<void>;
  loading: boolean;
}

// Minimal stub user just to satisfy components that expect a User object.
const devUser: User = {
  id: "00000000-0000-0000-0000-000000000000",
  email: "dev@example.com",
  app_metadata: {},
  user_metadata: {},
  aud: "dev",
  created_at: new Date().toISOString(),
  last_sign_in_at: new Date().toISOString(),
  role: "authenticated",
  updated_at: new Date().toISOString(),
  factors: [],
} as unknown as User;

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const value: AuthContextType = {
    user: devUser,
    session: null,
    userProfile: {
      id: devUser.id,
      full_name: "Dev User",
      email: devUser.email,
      approved: true,
      is_admin: true,
    },
    isApproved: true,
    isAdmin: true,
    loading: false,
    // No-op auth methods for dev: they always succeed and do nothing.
    async signIn() {
      return { error: null };
    },
    async signUp() {
      return { error: null };
    },
    async signOut() {
      return;
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
