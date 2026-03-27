import { db } from "@/lib/db";
import { recalculateMonthlyLtv } from "@/lib/services/ltv";
import { generateOperationalNotifications } from "@/lib/services/notifications";

type AutomationChurchResult = {
  churchId: string;
  churchName: string;
  success: boolean;
  result?: Record<string, unknown>;
  error?: string;
};

type AutomationRunSummary = {
  ranAt: string;
  targetChurchCount: number;
  successCount: number;
  failureCount: number;
  churches: AutomationChurchResult[];
};

async function getTargetChurches(targetChurchId?: string) {
  return db.church.findMany({
    where: {
      isActive: true,
      ...(targetChurchId ? { id: targetChurchId } : {}),
    },
    select: { id: true, name: true },
    orderBy: { createdAt: "asc" },
  });
}

export async function runNotificationsAutomation(targetChurchId?: string): Promise<AutomationRunSummary> {
  const churches = await getTargetChurches(targetChurchId);
  const results: AutomationChurchResult[] = [];

  for (const church of churches) {
    try {
      const result = await generateOperationalNotifications(church.id);
      results.push({
        churchId: church.id,
        churchName: church.name,
        success: true,
        result,
      });
    } catch (error) {
      results.push({
        churchId: church.id,
        churchName: church.name,
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  const successCount = results.filter((item) => item.success).length;
  return {
    ranAt: new Date().toISOString(),
    targetChurchCount: churches.length,
    successCount,
    failureCount: results.length - successCount,
    churches: results,
  };
}

export async function runMonthlyLtvAutomation(targetChurchId?: string): Promise<AutomationRunSummary> {
  const churches = await getTargetChurches(targetChurchId);
  const results: AutomationChurchResult[] = [];

  for (const church of churches) {
    try {
      const result = await recalculateMonthlyLtv(church.id);
      results.push({
        churchId: church.id,
        churchName: church.name,
        success: true,
        result,
      });
    } catch (error) {
      results.push({
        churchId: church.id,
        churchName: church.name,
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  const successCount = results.filter((item) => item.success).length;
  return {
    ranAt: new Date().toISOString(),
    targetChurchCount: churches.length,
    successCount,
    failureCount: results.length - successCount,
    churches: results,
  };
}

