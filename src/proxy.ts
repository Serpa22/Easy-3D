import { NextResponse, type NextRequest } from "next/server";

/**
 * Comprobación optimista: sin cookie de sesión → al login.
 * La verificación real de la sesión se hace en servidor con `requireUser()`.
 */
const PUBLIC_PREFIXES = ["/login", "/setup", "/api/bridge", "/api/health"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return NextResponse.next();
  if (process.env.NODE_ENV !== "production" && pathname.startsWith("/dev")) return NextResponse.next();
  if (request.cookies.has("e3d_session")) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon|apple-icon|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|webp|ico|txt)$).*)"],
};
