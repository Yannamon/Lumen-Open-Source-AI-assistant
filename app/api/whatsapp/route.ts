import { NextRequest, NextResponse } from "next/server";

import { postWhatsAppWebhookResult } from "@/lib/assistant-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return new NextResponse(
    "POST Twilio WhatsApp webhooks to this endpoint to talk to the assistant.",
    {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "text/plain; charset=utf-8",
      },
    }
  );
}

export async function POST(request: NextRequest) {
  const formData = await request.formData().catch(() => new FormData());
  const fields: Record<string, string | string[]> = {};

  formData.forEach((value, key) => {
    const normalizedValue = typeof value === "string" ? value : value.name || "";
    const existingValue = fields[key];

    if (existingValue === undefined) {
      fields[key] = normalizedValue;
      return;
    }

    fields[key] = Array.isArray(existingValue)
      ? [...existingValue, normalizedValue]
      : [existingValue, normalizedValue];
  });

  const result = await postWhatsAppWebhookResult({
    requestUrl: request.url,
    signature: request.headers.get("x-twilio-signature") || "",
    fields,
  });

  return new NextResponse(result.body.xml, {
    status: result.status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/xml; charset=utf-8",
    },
  });
}
