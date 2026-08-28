export interface WSClient {
  send(data: string): void;
}

const wsScope = new Map<WSClient, string | undefined>();

export function matchesScope(scope: string | undefined, client: WSClient) {
  if (scope === undefined) return true;
  const clientScope = wsScope.get(client);
  if (scope === "admin") return clientScope === "admin";
  if (scope === "qr") return !!clientScope?.startsWith("qr:");
  return clientScope === scope;
}

export function onSubscribe(client: WSClient, scope?: string) {
  wsScope.set(client, scope);
}
export function onUnsubscribe(client: WSClient) {
  wsScope.delete(client);
}

export function broadcast(ev: {
  type: string;
  scope?: string;
  data?: unknown;
}) {
  let text: string;
  try {
    text = JSON.stringify(ev);
  } catch {
    text = JSON.stringify({ type: ev.type, data: null });
  }
  for (const client of wsScope.keys()) {
    if (matchesScope(ev.scope, client)) client.send(text);
  }
}
