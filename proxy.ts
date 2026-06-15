import { NextResponse, type NextRequest } from "next/server";

// Next 16 renamed `middleware` → `proxy` (Node runtime by default).
// This is an OPTIMISTIC redirect only: if there's no auth session cookie at
// all, bounce the dashboard root to /login without rendering. Real enforcement
// lives in the page guard (requireAdminPage) and the admin route handlers.
export const config = {
  matcher: ["/"],
};

export default function proxy(request: NextRequest) {
  const hasSession =
    request.cookies.has("authjs.session-token") ||
    request.cookies.has("__Secure-authjs.session-token");

  if (!hasSession) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}
