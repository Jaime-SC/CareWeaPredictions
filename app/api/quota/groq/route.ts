import { NextResponse } from "next/server";
import { getGroqQuota, isGroqConfigured } from "@/lib/groq-quota";
import { errorMessage, jsonError } from "@/lib/api-response";
import { chileDateString } from "@/lib/utils";

/**
 * GET /api/quota/groq
 * Local counter of AI Judge chat.completions calls (Chile civil day).
 * Limit from GROQ_DAILY_LIMIT (default 14400).
 */
export async function GET() {
  try {
    const quota = await getGroqQuota(chileDateString());
    return NextResponse.json({
      success: true,
      ...quota,
      label: quota.configured
        ? `Groq: ${quota.used} / ${quota.limit} · ${quota.remaining} restantes`
        : "Groq: no configurado",
    });
  } catch (error) {
    console.error("[api/quota/groq]", error);
    return jsonError(
      errorMessage(error, "No se pudo leer la cuota de Groq."),
      500,
      { configured: isGroqConfigured() }
    );
  }
}
