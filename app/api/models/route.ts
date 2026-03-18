import { NextResponse } from "next/server";

import { getModelsResult } from "@/lib/assistant-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const result = await getModelsResult();
  return NextResponse.json(result.body, {
    status: result.status,
    headers: { "Cache-Control": "no-store" },
  });
}
