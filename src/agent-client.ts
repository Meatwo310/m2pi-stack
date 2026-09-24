export type PromptProgress =
  | { type: "model"; model: string }
  | { type: "thinking"; id: string; messageId: number; delta: string }
  | { type: "thinking_end"; id: string; messageId: number; content: string }
  | { type: "summary"; id: string; messageId: number; text: string }
  | { type: "text_start"; id: string; messageId: number }
  | { type: "text_delta"; id: string; messageId: number; delta: string }
  | { type: "text_end"; id: string; messageId: number; content: string }
  | { type: "tool"; id: string; name: string; status: "running" | "done" | "error" };
type PromptResult = { sessionId: string; text: string; model: string };
type PromptEvent = PromptProgress | ({ type: "done" } & PromptResult) | { type: "error"; error: string };

export class AgentClient {
  constructor(private readonly baseUrl: string) {}

  private async post<T>(path: string, input: Record<string, unknown>): Promise<T> {
    const response = await fetch(new URL(path, this.baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    const body = await response.json() as { error?: string } & T;
    if (!response.ok) throw new Error(body.error ?? `agent HTTP ${response.status}`);
    return body;
  }

  async exists(sessionId: string): Promise<boolean> {
    return (await this.post<{ exists: boolean }>("/sessions/exists", { sessionId })).exists;
  }

  async prompt(sessionId: string | null, prompt: string, model: string, onProgress: (event: PromptProgress) => Promise<void>): Promise<PromptResult> {
    const response = await fetch(new URL("/sessions/prompt", this.baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId, prompt, model }),
    });
    if (!response.ok) {
      const body = await response.json() as { error?: string };
      throw new Error(body.error ?? `agent HTTP ${response.status}`);
    }
    if (!response.body) throw new Error("agent の応答ストリームがありません");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let result: PromptResult | undefined;
    const consume = async (line: string): Promise<void> => {
      if (!line) return;
      const event = JSON.parse(line) as PromptEvent;
      if (event.type === "error") throw new Error(event.error);
      if (event.type === "done") result = { sessionId: event.sessionId, text: event.text, model: event.model };
      else await onProgress(event);
    };
    try {
      for (;;) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        let boundary: number;
        while ((boundary = buffer.indexOf("\n")) >= 0) {
          await consume(buffer.slice(0, boundary));
          buffer = buffer.slice(boundary + 1);
        }
        if (done) break;
      }
      await consume(buffer);
    } finally {
      reader.releaseLock();
    }
    if (!result) throw new Error("agent の応答が完了しませんでした");
    return result;
  }
}
