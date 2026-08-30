import type { DurableObject } from "@cloudflare/workers-types";

export class MerchantWS implements DurableObject {
  private scopes = new Map<WebSocket, string | undefined>();
  private state: DurableObjectState;

  constructor(ctx: DurableObjectState) {
    this.state = ctx;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/broadcast" && request.method === "POST") {
      const ev: { type: string; data?: unknown; scope?: string } = await request.json();
      this.broadcast(ev.type, ev.data, ev.scope);
      return new Response(null, { status: 200 });
    }

    const scope = url.searchParams.get("scope") ?? undefined;
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    this.state.acceptWebSocket(server);
    this.scopes.set(server, scope);

    server.addEventListener("close", () => {
      this.scopes.delete(server);
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  broadcast(type: string, data?: unknown, scope?: string) {
    const text = JSON.stringify({ type, data });
    for (const ws of this.state.getWebSockets()) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      const clientScope = this.scopes.get(ws);
      if (scope === undefined) {
        ws.send(text);
      } else if (scope === "admin" && clientScope === "admin") {
        ws.send(text);
      } else if (scope === "qr" && clientScope?.startsWith("qr:")) {
        ws.send(text);
      } else if (clientScope === scope) {
        ws.send(text);
      }
    }
  }
}