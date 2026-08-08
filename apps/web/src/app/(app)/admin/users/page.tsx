"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import {
  listAdminUsers,
  setUserAccess,
  type AdminUserAccess,
} from "@/lib/access-api";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const STATUS_STYLES: Record<AdminUserAccess["status"], string> = {
  pending: "border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-100",
  approved: "border-border bg-surface-alt text-muted",
  denied: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-200",
};

export default function AdminUsersPage() {
  const { isAdmin } = useAuth();
  const [users, setUsers] = useState<AdminUserAccess[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyUid, setBusyUid] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setUsers(await listAdminUsers());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load users");
    }
  }, []);

  useEffect(() => {
    if (isAdmin) void load();
  }, [isAdmin, load]);

  const { pending, rest } = useMemo(() => {
    const all = users ?? [];
    return {
      pending: all.filter((user) => user.status === "pending"),
      rest: all.filter((user) => user.status !== "pending"),
    };
  }, [users]);

  async function review(uid: string, status: "approved" | "denied") {
    setBusyUid(uid);
    try {
      await setUserAccess(uid, status);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update access");
    } finally {
      setBusyUid(null);
    }
  }

  if (!isAdmin) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
        <p className="text-sm text-muted">Admins only.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="text-xl font-semibold text-foreground">Users</h1>
      <p className="mt-1 text-sm text-muted">
        Approve who can sign in while LedgeIndex is invite-only.
      </p>

      {error ? (
        <p className="mt-4 text-sm text-red-600 dark:text-red-300">{error}</p>
      ) : null}

      {users === null && !error ? (
        <p className="mt-6 text-sm text-muted">Loading…</p>
      ) : null}

      {users !== null ? (
        <>
          <Section
            title={`Waiting for approval (${pending.length})`}
            users={pending}
            busyUid={busyUid}
            onReview={review}
            emptyLabel="No pending requests."
          />
          <Section
            title={`Everyone else (${rest.length})`}
            users={rest}
            busyUid={busyUid}
            onReview={review}
            emptyLabel="No other accounts yet."
          />
        </>
      ) : null}
    </div>
  );
}

function Section({
  title,
  users,
  busyUid,
  onReview,
  emptyLabel,
}: {
  title: string;
  users: AdminUserAccess[];
  busyUid: string | null;
  onReview: (uid: string, status: "approved" | "denied") => void;
  emptyLabel: string;
}) {
  return (
    <section className="mt-8">
      <h2 className="font-mono text-[0.625rem] font-semibold tracking-[0.12em] text-muted uppercase">
        {title}
      </h2>
      {users.length === 0 ? (
        <p className="mt-3 text-sm text-muted">{emptyLabel}</p>
      ) : (
        <ul className="mt-3 divide-y divide-border overflow-hidden rounded-xl border border-border bg-card-solid">
          {users.map((user) => (
            <li
              key={user.uid}
              className="flex flex-wrap items-center gap-3 px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">
                  {user.displayName ?? user.email ?? user.uid}
                </p>
                <p className="truncate text-xs text-muted">
                  {user.email ?? user.uid}
                  {user.role === "admin" ? " · admin" : ""}
                </p>
              </div>

              <span
                className={cn(
                  "shrink-0 rounded-md border px-2 py-0.5 font-mono text-[0.625rem] uppercase",
                  STATUS_STYLES[user.status],
                )}
              >
                {user.status}
              </span>

              <div className="flex shrink-0 gap-2">
                {user.status !== "approved" ? (
                  <Button
                    className="h-8 px-3 text-xs"
                    disabled={busyUid === user.uid}
                    onClick={() => onReview(user.uid, "approved")}
                  >
                    Approve
                  </Button>
                ) : null}
                {user.status !== "denied" && user.role !== "admin" ? (
                  <Button
                    variant="secondary"
                    className="h-8 px-3 text-xs"
                    disabled={busyUid === user.uid}
                    onClick={() => onReview(user.uid, "denied")}
                  >
                    Deny
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
