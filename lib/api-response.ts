import { NextResponse } from "next/server";

export type ApiErrorBody = {
  success: false;
  error: string;
};

export function jsonError(
  error: string,
  status = 500,
  extra?: Record<string, unknown>,
  init?: ResponseInit
) {
  return NextResponse.json(
    { success: false as const, error, ...extra },
    { status, ...init }
  );
}

export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
