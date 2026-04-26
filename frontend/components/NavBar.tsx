"use client";

import Link from "next/link";
import { useAuth, UserButton } from "@clerk/nextjs";

export default function NavBar() {
  const { isSignedIn, isLoaded } = useAuth();

  return (
    <nav className="border-b px-6 py-3 flex items-center gap-6 bg-white">
      <Link href="/" className="font-semibold text-sm">Resume Co-Pilot</Link>

      {isLoaded && isSignedIn && (
        <>
          <Link href="/onboard?step=upload" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            Upload
          </Link>
          <Link href="/graph" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            Versions
          </Link>
          <Link href="/queue" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            Queue
          </Link>
          <Link href="/tailor?jd_hash=0ab50c269d3809395e2911459f3e8fa5736ed2f167177a964b5d3dc7e2b79ef1" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            Tailor Studio
          </Link>
        </>
      )}

      <div className="ml-auto flex items-center gap-3">
        {isLoaded && !isSignedIn && (
          <>
            <Link
              href="/sign-in"
              className="text-sm text-gray-600 hover:text-gray-900 transition-colors"
            >
              Sign in
            </Link>
            <Link
              href="/sign-up"
              className="text-sm bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 transition-colors font-medium"
            >
              Get started
            </Link>
          </>
        )}
        {isLoaded && isSignedIn && (
          <UserButton />
        )}
      </div>
    </nav>
  );
}
