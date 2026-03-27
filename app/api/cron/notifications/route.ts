import { NextResponse } from "next/server";

import { verifyCronRequest } from "@/lib/cron";
import { runNotificationsAutomation } from "@/lib/services/automation";

export async function GET(request: Request) {
  const auth = verifyCronRequest(request);
  if (!auth.ok) {
    return NextResponse.json({ message: auth.message }, { status: auth.status });
  }

  const url = new URL(request.url);
  const churchId = url.searchParams.get("churchId")?.trim() || undefined;
  const result = await runNotificationsAutomation(churchId);

  return NextResponse.json({
    ok: result.failureCount === 0,
    job: "notifications",
    ...result,
  });
}

