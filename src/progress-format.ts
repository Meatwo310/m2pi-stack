import type { Settings } from "./config.js";

export type ProgressEntry =
  | { kind: "model"; requested: string; actual: string | null }
  | { kind: "thought"; text: string; summary: string }
  | { kind: "tool"; id: string; name: string; status: "running" | "done" | "error" };

function escapeValue(value: string): string {
  return value.replace(/[\\*_~`>|\[\]()#]/g, "\\$&").replace(/\r\n?/g, "\n");
}

function substitute(template: string, values: Record<string, string>): string {
  return template.replace(/\$\{(model|thought|tool|status)\}/g, (_, key: string) => values[key] ?? "");
}

function entryContent(settings: Settings, entry: ProgressEntry): string {
  if (entry.kind === "model") {
    if (settings.model_display === "off") return "";
    const requested = entry.requested.slice(entry.requested.indexOf(":") + 1);
    const route = settings.model_display === "route" && entry.actual && entry.actual !== entry.requested
      ? ` → ${entry.actual}` : "";
    return substitute(settings.model_template, { model: escapeValue(requested + route) });
  }
  if (entry.kind === "thought") {
    const thought = settings.reasoning_display === "summary"
      ? entry.summary || (settings.reasoning_summary_fallback === "text" ? entry.text : "")
      : settings.reasoning_display === "text" ? entry.text : "";
    if (!thought.trim()) return "";
    return substitute(settings.reasoning_template, { thought: escapeValue(thought.replace(/\s+/g, " ").trim()) });
  }
  if (settings.tool_display === "off") return "";
  const status = entry.status === "running" ? "実行中" : entry.status === "error" ? "失敗" : "完了";
  return substitute(settings.tool_template, { tool: escapeValue(entry.name), status });
}

export function progressPages(settings: Settings, entries: readonly ProgressEntry[]): string[] {
  const lines = entries.map((entry) => entryContent(settings, entry)).filter(Boolean).map((line) =>
    line.length > 600 ? `${line.slice(0, 599)}…` : line);
  const pages: string[] = [];
  let page = "";
  for (const line of lines) {
    if (page && page.length + line.length + 1 > 1900) {
      pages.push(page);
      page = "";
    }
    page = page ? `${page}\n${line}` : line;
  }
  if (page) pages.push(page);
  return pages;
}

export function textPages(text: string): string[] {
  if (!text) return [];
  const pages: string[] = [];
  for (let offset = 0; offset < text.length; offset += 1900) pages.push(text.slice(offset, offset + 1900));
  return pages;
}
