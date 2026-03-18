"use client";

import { useEffect } from "react";

import { initAssistantUi } from "@/lib/assistant-ui";

export default function AssistantBootstrap() {
  useEffect(() => {
    initAssistantUi();
  }, []);

  return null;
}
