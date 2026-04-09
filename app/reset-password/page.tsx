import { ShieldCheck } from "lucide-react";
import { redirect } from "next/navigation";

import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { Card } from "@/components/ui/card";
import { requireAuth } from "@/lib/tenant";

export default async function ResetPasswordPage() {
  const session = await requireAuth();
  if (!session.user.passwordChangeRequired) {
    redirect("/dashboard");
  }

  return (
    <main className="page-enter flex min-h-screen items-center justify-center px-4 py-10">
      <Card className="w-full max-w-md rounded-3xl p-8 md:p-10">
        <div className="mb-6 flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-sky-700" />
          <p className="text-sm font-medium text-slate-600">Security Update Required</p>
        </div>
        <h1 className="text-2xl font-semibold text-slate-900">Reset your temporary password</h1>
        <p className="mt-2 text-sm text-slate-500">
          Your account was provisioned with a temporary password. Set a new one to continue.
        </p>
        <div className="mt-8">
          <ResetPasswordForm />
        </div>
      </Card>
    </main>
  );
}
