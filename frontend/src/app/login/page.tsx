"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { loginUser } from "@/lib/api";
import { saveToken } from "@/lib/auth";

export default function LoginPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      const result = await loginUser({ email, password });
      saveToken(result.token);
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-6">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md rounded-lg border border-slate-800 bg-slate-900 p-6"
      >
        <h1 className="text-2xl font-bold">Login</h1>

        <div className="mt-6 space-y-4">
          <input
            className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2"
            placeholder="Email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />

          <input
            className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2"
            placeholder="Password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>

        {error && <p className="mt-4 text-sm text-red-400">{error}</p>}

        <button
          disabled={isLoading}
          className="mt-6 w-full rounded-md bg-white px-4 py-2 font-medium text-slate-950 disabled:opacity-60"
        >
          {isLoading ? "Logging in..." : "Login"}
        </button>

        <p className="mt-4 text-sm text-slate-400">
          No account?{" "}
          <Link className="text-white underline" href="/register">
            Register
          </Link>
        </p>
      </form>
    </main>
  );
}