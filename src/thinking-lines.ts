export function appendThinkingLines(pending: string, delta: string): { lines: string[]; pending: string } {
  const parts = (pending + delta).split(/\r\n|\r|\n/);
  const tail = parts.pop()!;
  return { lines: parts.filter((line) => line.trim()), pending: tail };
}

export function completedThinkingLines(content: string): string[] {
  return content.split(/\r\n|\r|\n/).filter((line) => line.trim());
}
