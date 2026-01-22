import Link from "next/link";

export default function Home() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-900">
      <main className="text-center">
        <h1 className="text-4xl font-bold text-white mb-4">Cloudy Road</h1>
        <p className="text-zinc-400 mb-8">
          Clear the clouds from your city map
        </p>
        <Link
          href="/dashboard"
          className="inline-block rounded-full bg-white px-6 py-3 text-zinc-900 font-medium hover:bg-zinc-200 transition-colors"
        >
          Go to Dashboard
        </Link>
      </main>
    </div>
  );
}
