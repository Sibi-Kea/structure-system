export function verifyCronRequest(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return {
      ok: false as const,
      status: 500,
      message: "CRON_SECRET is not configured.",
    };
  }

  const authorization = request.headers.get("authorization");
  const bearerMatch = authorization?.match(/^Bearer\s+(.+)$/i);
  const bearerToken = bearerMatch?.[1]?.trim() ?? "";
  const headerToken = request.headers.get("x-cron-secret")?.trim() ?? "";
  const providedToken = bearerToken || headerToken;

  if (!providedToken || providedToken !== secret) {
    return {
      ok: false as const,
      status: 401,
      message: "Unauthorized cron request.",
    };
  }

  return { ok: true as const };
}

