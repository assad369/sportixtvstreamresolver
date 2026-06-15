import { requireAdminPage } from "@/lib/auth-guard";
import Dashboard from "@/components/Dashboard";
import SignOutButton from "@/components/SignOutButton";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await requireAdminPage();

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-10 sm:py-14">
      <header className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white sm:text-3xl">
            M3U8 Stream Resolver
          </h1>
          <p className="mt-1 text-sm text-white/50">
            Signed in as {session.user.email}
          </p>
        </div>
        <SignOutButton />
      </header>

      <Dashboard />
    </main>
  );
}
