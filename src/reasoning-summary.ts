export function reasoningSummary(content: readonly unknown[]): string {
  const summaries: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object" || !("type" in block) || block.type !== "thinking" ||
        !("thinkingSignature" in block) || typeof block.thinkingSignature !== "string") continue;
    try {
      const details: unknown = JSON.parse(block.thinkingSignature);
      if (!Array.isArray(details)) continue;
      for (const detail of details) {
        if (detail && typeof detail === "object" && "type" in detail && detail.type === "reasoning.summary" &&
            "summary" in detail && typeof detail.summary === "string") summaries.push(detail.summary);
      }
    } catch { /* Other providers use opaque signatures. */ }
  }
  return summaries.join("\n");
}
