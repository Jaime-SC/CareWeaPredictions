import { NextRequest, NextResponse } from "next/server";
import { env } from "./env";

export function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === "production";
}

/**
 * Bearer CRON_SECRET — required in production for mutation/cron routes.
 * Open in dev when CRON_SECRET is unset.
 */
export function authorizeBearerSecret(request: NextRequest): boolean {
  const secret = env.CRON_SECRET?.trim();
  if (!secret) return !isProductionRuntime();
  const auth = request.headers.get("authorization");
  return auth === `Bearer ${secret}`;
}

export function unauthorizedJson(): NextResponse {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

/** Guard POST/PUT/PATCH/DELETE on sensitive APIs. GET stays public unless wrapped. */
export function requireMutationAuth(request: NextRequest): NextResponse | null {
  if (authorizeBearerSecret(request)) return null;
  return unauthorizedJson();
}
