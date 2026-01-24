"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import type { User } from "@supabase/supabase-js";

export default function AuthButton() {
  const [user, setUser] = useState<User | null>(null);
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [showEmailInput, setShowEmailInput] = useState(false);

  useEffect(() => {
    if (!supabase) return;

    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
    });

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleSignIn = async () => {
    if (!supabase) return;
    if (!email) {
      setMessage("Please enter your email");
      return;
    }

    setLoading(true);
    setMessage(null);

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: window.location.origin + "/dashboard",
      },
    });

    setLoading(false);

    if (error) {
      setMessage(error.message);
    } else {
      setMessage("Check your email for the magic link!");
      setShowEmailInput(false);
    }
  };

  const handleSignOut = async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    setUser(null);
  };

  if (!supabase) {
    return null;
  }

  if (user) {
    return (
      <div className="absolute right-4 top-4 z-20 flex items-center gap-3 rounded-lg bg-zinc-800/90 px-4 py-2 text-sm backdrop-blur">
        <span className="text-zinc-300">{user.email}</span>
        <button
          onClick={handleSignOut}
          className="rounded bg-zinc-700 px-3 py-1 text-zinc-200 transition hover:bg-zinc-600"
        >
          Sign out
        </button>
      </div>
    );
  }

  if (showEmailInput) {
    return (
      <div className="absolute right-4 top-4 z-20 flex flex-col gap-2 rounded-lg bg-zinc-800/90 p-4 backdrop-blur">
        <input
          type="email"
          placeholder="your@email.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSignIn()}
          className="rounded bg-zinc-700 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-green-500"
          autoFocus
        />
        <div className="flex gap-2">
          <button
            onClick={handleSignIn}
            disabled={loading}
            className="flex-1 rounded bg-green-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-green-500 disabled:opacity-50"
          >
            {loading ? "Sending..." : "Send Magic Link"}
          </button>
          <button
            onClick={() => setShowEmailInput(false)}
            className="rounded bg-zinc-700 px-3 py-2 text-sm text-zinc-300 transition hover:bg-zinc-600"
          >
            Cancel
          </button>
        </div>
        {message && (
          <p className="text-xs text-zinc-400">{message}</p>
        )}
      </div>
    );
  }

  return (
    <button
      onClick={() => setShowEmailInput(true)}
      className="absolute right-4 top-4 z-20 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white shadow-lg transition hover:bg-green-500"
    >
      Sign in to save progress
    </button>
  );
}
