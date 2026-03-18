import { NextRequest, NextResponse } from "next/server";

import { getConfigResult, postConfigResult } from "@/lib/assistant-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const result = getConfigResult();
  return NextResponse.json(result.body, {
    status: result.status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const result = await postConfigResult(body);
  return NextResponse.json(result.body, {
    status: result.status,
    headers: { "Cache-Control": "no-store" },
  });
}
