import { Role } from "@prisma/client";
import { NextResponse, type NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

import { hasPermission, ROUTE_PERMISSIONS } from "@/lib/rbac";

const PUBLIC_PATHS = ["/login"];
const authSecret = process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET;

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.startsWith("/api/auth")
  ) {
    return NextResponse.next();
  }

  const isPublicPath = PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
  const token = await getToken({ req: request, secret: authSecret });
  const roleFromToken = token?.role;
  const passwordChangeRequired = token?.passwordChangeRequired === true;
  const hasValidRole =
    typeof roleFromToken === "string" &&
    Object.values(Role).includes(roleFromToken as Role);
  const isAuthenticated = Boolean(token?.sub && hasValidRole);

  if (!isAuthenticated && !isPublicPath) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (!isAuthenticated) {
    return NextResponse.next();
  }

  const role = roleFromToken as Role;

  if (passwordChangeRequired) {
    const onResetRoute = pathname === "/reset-password" || pathname.startsWith("/reset-password/");
    if (!onResetRoute) {
      return NextResponse.redirect(new URL("/reset-password", request.url));
    }
  } else if (pathname === "/reset-password" || pathname.startsWith("/reset-password/")) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  if (role === Role.SUPER_ADMIN) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/dashboard")) {
    const matchedRoute = ROUTE_PERMISSIONS.find((route) => route.pattern.test(pathname));
    if (matchedRoute && !hasPermission(role, matchedRoute.permission)) {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/login", "/reset-password", "/dashboard/:path*"],
};
