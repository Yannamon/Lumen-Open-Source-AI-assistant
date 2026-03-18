import { NextRequest, NextResponse } from "next/server";

import { postMediaTranscriptionResult } from "@/lib/assistant-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const formData = await request.formData().catch(() => new FormData());
  const result = await postMediaTranscriptionResult(formData);
  return NextResponse.json(result.body, {
    status: result.status,
    headers: { "Cache-Control": "no-store" },
  });
}
