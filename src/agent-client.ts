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

  async prompt(sessionId: string | null, prompt: string, model: string): Promise<{ sessionId: string; text: string }> {
    return this.post("/sessions/prompt", { sessionId, prompt, model });
  }
}
