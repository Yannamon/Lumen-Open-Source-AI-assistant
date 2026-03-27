import { NextRequest, NextResponse } from "next/server";

import { postAgentApprovalResult } from "@/lib/assistant-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const result = await postAgentApprovalResult(body);
  return NextResponse.json(result.body, {
    status: result.status,
    headers: { "Cache-Control": "no-store" },
  });
}
