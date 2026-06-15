import { redirect } from "next/navigation";
import { auth } from "@/auth";
import type { Session } from "next-auth";

/**
 * Page-level guard for Server Components. Redirects to /login if the visitor
 * is not an authenticated admin. Returns the session otherwise.
 */
export async function requireAdminPage(): Promise<Session> {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    redirect("/login");
  }
  return session;
}

/**
 * Route-handler guard. Returns the session, or throws a Response (401/403)
 * that the handler should let propagate. Usage:
 *   const session = await requireAdminApi();  // inside try/catch-free flow
 */
export async function requireAdminApi(): Promise<Session> {
  const session = await auth();
  if (!session?.user) {
    throw new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (session.user.role !== "admin") {
    throw new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }
  return session;
}
