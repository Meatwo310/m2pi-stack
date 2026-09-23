export function splitDiscordMessage(text, limit = 1900) {
  const value = String(text ?? "").trim();
  if (!value) return [];
  if (limit < 1) throw new Error("limit must be positive");

  const chunks = [];
  let rest = value;
  while (rest.length > limit) {
    const window = rest.slice(0, limit + 1);
    let cut = Math.max(window.lastIndexOf("\n\n"), window.lastIndexOf("\n"));
    if (cut < Math.floor(limit / 2)) cut = window.lastIndexOf(" ");
    if (cut < Math.floor(limit / 2)) cut = limit;
    chunks.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest) chunks.push(rest);
  return chunks;
}
