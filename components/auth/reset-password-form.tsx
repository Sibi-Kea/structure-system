"use client";

import { KeyRound } from "lucide-react";
import { signOut } from "next-auth/react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { completePasswordResetAction } from "@/app/reset-password/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function ResetPasswordForm() {
  const [isPending, startTransition] = useTransition();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();

        const formData = new FormData();
        formData.set("password", password);
        formData.set("confirmPassword", confirmPassword);

        startTransition(async () => {
          const result = await completePasswordResetAction(formData);
          if (!result.success) {
            toast.error(result.message);
            return;
          }

          toast.success(result.message);
          await signOut({ callbackUrl: "/login" });
        });
      }}
    >
      <div className="space-y-1.5">
        <label htmlFor="password" className="text-sm font-medium text-slate-700">
          New password
        </label>
        <Input
          id="password"
          type="password"
          autoComplete="new-password"
          minLength={12}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="confirmPassword" className="text-sm font-medium text-slate-700">
          Confirm new password
        </label>
        <Input
          id="confirmPassword"
          type="password"
          autoComplete="new-password"
          minLength={12}
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          required
        />
      </div>

      <Button type="submit" fullWidth disabled={isPending}>
        <KeyRound className="mr-2 h-4 w-4" />
        {isPending ? "Updating..." : "Update password"}
      </Button>
      <p className="text-xs text-slate-500">Minimum length: 12 characters.</p>
    </form>
  );
}
