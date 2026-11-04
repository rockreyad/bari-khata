import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createMcpApp } from "./handler.js";
import {
  challenge,
  McpError,
  MCP_SCOPES,
  sha256,
  type McpConfig,
} from "./common.js";
import type { Asset, Connection, McpStore, Principal } from "./store.js";
import type { OAuthClient } from "./oauth.js";
import { LedgerSchema } from "../../src/domain/model.js";
import { summarize } from "../../src/domain/ledger.js";

const origin = "https://bari.example";
const resource = `${origin}/api/mcp`;
const owner = "11111111-1111-4111-8111-111111111111";
const personal = `bkm_p_${"A".repeat(43)}`;
const userSession = "synthetic.header.signature-for-first-party-only";
const config: McpConfig = {
  origin,
  url: "https://database.example",
  serviceKey: "synthetic-test-server-key",
  anonKey: "synthetic-test-public-key",
  allowedOrigins: ["https://assistant.example"],
  enabled: true,
};
function ledgerFixture() {
  return LedgerSchema.parse({
    people: [{ id: "shop", name: "দোকান", kind: "shop" }],
    works: [{ id: "roof", name: "ছাদ" }],
  });
}
type Token = {
  connectionId: string;
  kind: "personal" | "access" | "refresh";
  clientId?: string;
  family?: string;
  used?: boolean;
  revoked?: boolean;
};
type Authorization = Record<string, unknown> & {
  requestId: string;
  clientId: string;
  redirectUri: string;
  scopes: string[];
  state: string;
  codeChallenge: string;
  resource: string;
  approved?: boolean;
};
type Code = {
  connectionId: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  resource: string;
  used?: boolean;
};
type Saved = {
  status: string;
  revision: number;
  updatedAt: string;
  result: Record<string, unknown>;
  digest: string;
};

class MemoryStore implements McpStore {
  connections = new Map<string, Connection>();
  tokens = new Map<string, Token>();
  snapshots = new Map<string, Principal["snapshot"]>();
  operations = new Map<string, Saved>();
  clients = new Map<string, OAuthClient>();
  authorizations = new Map<string, Authorization>();
  codes = new Map<string, Code>();
  assets = new Map<string, Asset & { connectionId: string }>();
  files = new Map<string, Uint8Array>();
  storageWrites: string[] = [];
  storageReads: string[] = [];
  calls: { action: string; data: Record<string, unknown> }[] = [];
  loseNextSaveResponse = false;
  constructor(scopes: string[] = [...MCP_SCOPES]) {
    const connection: Connection = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      ownerId: owner,
      name: "ব্যক্তিগত সহকারী",
      scopes,
      policy: {},
    };
    this.connections.set(connection.id, connection);
    this.tokens.set(sha256(personal), {
      connectionId: connection.id,
      kind: "personal",
    });
    this.snapshots.set(owner, {
      revision: 7,
      document: ledgerFixture(),
      updatedAt: "2026-11-02T10:00:00.000Z",
    });
  }
  private authenticate(data: Record<string, unknown>) {
    const token = this.tokens.get(String(data.tokenHash));
    if (
      !token ||
      token.revoked ||
      token.kind === "refresh" ||
      data.resource !== resource
    )
      throw new McpError("mcp_unauthorized", 401);
    const connection = this.connections.get(token.connectionId)!;
    if (connection.revoked) throw new McpError("mcp_unauthorized", 401);
    return {
      connection,
      snapshot: this.snapshots.get(connection.ownerId) ?? {
        revision: 0,
        document: null,
        updatedAt: null,
      },
    };
  }
  private operationKey(connectionId: string, key: unknown) {
    return `${connectionId}:${String(key)}`;
  }
  async call<T>(action: string, data: Record<string, unknown>): Promise<T> {
    this.calls.push({ action, data: structuredClone(data) });
    const result = await this.dispatch(action, data);
    return structuredClone(result) as T;
  }
  private async dispatch(
    action: string,
    data: Record<string, unknown>,
  ): Promise<unknown> {
    if (action === "rate_limit") return { allowed: true, retryAfter: 0 };
    if (action === "authenticate") return this.authenticate(data);
    if (action === "operation") {
      const principal = this.authenticate(data);
      return (
        this.operations.get(
          this.operationKey(principal.connection.id, data.requestKey),
        ) ?? null
      );
    }
    if (action === "list_audit") return { operations: [] };
    if (action === "find_duplicates") return { operations: [] };
    if (action === "asset") {
      const principal = this.authenticate(data);
      const asset = this.assets.get(String(data.id));
      if (!asset || asset.ownerId !== principal.connection.ownerId)
        throw new McpError("mcp_not_found", 404);
      return asset;
    }
    if (action === "finalize_upload") {
      const principal = this.authenticate(data);
      const asset = this.assets.get(String(data.id));
      if (
        !asset ||
        asset.ownerId !== principal.connection.ownerId ||
        asset.connectionId !== principal.connection.id
      )
        throw new McpError("mcp_not_found", 404);
      asset.status = "uploaded";
      asset.sha256 = String(data.sha256);
      return asset;
    }
    if (action === "save") {
      const principal = this.authenticate(data);
      const key = this.operationKey(principal.connection.id, data.requestKey);
      const previous = this.operations.get(key);
      if (previous) {
        if (previous.digest !== data.digest)
          throw new McpError("mcp_operation_mismatch", 409);
        return previous;
      }
      if (principal.snapshot.revision !== data.expectedRevision)
        return { status: "conflict", revision: principal.snapshot.revision };
      if (
        (data.requiredScopes as string[]).some(
          (scope) => !principal.connection.scopes.includes(scope),
        )
      )
        throw new McpError("mcp_scope_required", 403);
      const document = LedgerSchema.parse(data.document);
      const updatedAt = "2026-11-02T11:00:00.000Z";
      const revision = principal.snapshot.revision + 1;
      this.snapshots.set(principal.connection.ownerId, {
        document,
        revision,
        updatedAt,
      });
      const saved: Saved = {
        status: "saved",
        revision,
        updatedAt,
        result: data.result as Record<string, unknown>,
        digest: String(data.digest),
      };
      this.operations.set(key, saved);
      if (this.loseNextSaveResponse) {
        this.loseNextSaveResponse = false;
        throw new McpError("service_unavailable", 503);
      }
      return saved;
    }
    if (action === "create_connection") {
      const connection: Connection = {
        id: randomUUID(),
        ownerId: String(data.ownerId),
        name: String(data.name),
        scopes: data.scopes as string[],
        policy: data.policy as Connection["policy"],
      };
      this.connections.set(connection.id, connection);
      this.tokens.set(String(data.tokenHash), {
        connectionId: connection.id,
        kind: "personal",
      });
      return { connection, expiresAt: data.expiresAt };
    }
    if (action === "list_connections")
      return {
        connections: [...this.connections.values()].filter(
          (connection) => connection.ownerId === data.ownerId,
        ),
      };
    if (action === "register_client") {
      const client = {
        clientId: String(data.clientId),
        clientName: String(data.clientName),
        redirectUris: data.redirectUris as string[],
        tokenEndpointAuthMethod: String(data.tokenEndpointAuthMethod),
        clientSecretHash: data.clientSecretHash as string | null,
        scope: String(data.scope),
      };
      this.clients.set(client.clientId, client);
      return client;
    }
    if (action === "get_client")
      return this.clients.get(String(data.clientId)) ?? null;
    if (action === "begin_authorization") {
      const previous = [...this.authorizations.values()].find((request) =>
        ["clientId", "redirectUri", "codeChallenge", "resource", "state"].every(
          (key) => request[key] === data[key],
        ),
      );
      if (previous) {
        if (
          [...previous.scopes].sort().join(" ") !==
          [...(data.scopes as string[])].sort().join(" ")
        )
          throw new McpError("mcp_invalid_scope");
        return { requestId: previous.requestId };
      }
      this.authorizations.set(String(data.requestId), data as Authorization);
      return { requestId: data.requestId };
    }
    if (action === "authorization_details") {
      const request = this.authorizations.get(String(data.requestId));
      if (!request || request.approved)
        throw new McpError("mcp_not_found", 404);
      return {
        ...request,
        clientName: this.clients.get(request.clientId)!.clientName,
      };
    }
    if (action === "approve_authorization") {
      const request = this.authorizations.get(String(data.requestId));
      if (!request || request.approved) throw new McpError("mcp_invalid_grant");
      request.approved = true;
      const connection: Connection = {
        id: String(data.connectionId),
        ownerId: String(data.ownerId),
        name: String(data.name),
        scopes: data.scopes as string[],
        policy: data.policy as Connection["policy"],
        clientId: request.clientId,
      };
      this.connections.set(connection.id, connection);
      this.codes.set(String(data.codeHash), {
        connectionId: connection.id,
        clientId: request.clientId,
        redirectUri: request.redirectUri,
        codeChallenge: request.codeChallenge,
        resource: request.resource,
      });
      return {
        redirectUri: request.redirectUri,
        state: request.state,
        connectionId: connection.id,
      };
    }
    if (action === "exchange_code") {
      const code = this.codes.get(String(data.codeHash));
      if (
        !code ||
        code.used ||
        code.clientId !== data.clientId ||
        code.redirectUri !== data.redirectUri ||
        code.codeChallenge !== data.codeChallenge ||
        code.resource !== data.resource
      )
        throw new McpError("mcp_invalid_grant");
      code.used = true;
      const family = randomUUID();
      this.tokens.set(String(data.accessHash), {
        connectionId: code.connectionId,
        kind: "access",
        clientId: code.clientId,
        family,
      });
      this.tokens.set(String(data.refreshHash), {
        connectionId: code.connectionId,
        kind: "refresh",
        clientId: code.clientId,
        family,
      });
      return {
        scope: this.connections.get(code.connectionId)!.scopes.join(" "),
      };
    }
    if (action === "refresh") {
      const token = this.tokens.get(String(data.refreshHash));
      if (
        !token ||
        token.kind !== "refresh" ||
        token.clientId !== data.clientId ||
        data.resource !== resource
      )
        throw new McpError("mcp_invalid_grant");
      if (token.used || token.revoked) {
        for (const member of this.tokens.values())
          if (member.family === token.family) member.revoked = true;
        return { error: "invalid_grant" };
      }
      token.used = true;
      token.revoked = true;
      this.tokens.set(String(data.accessHash), {
        ...token,
        used: false,
        revoked: false,
        kind: "access",
      });
      this.tokens.set(String(data.newRefreshHash), {
        ...token,
        used: false,
        revoked: false,
        kind: "refresh",
      });
      return {
        scope: this.connections.get(token.connectionId)!.scopes.join(" "),
      };
    }
    if (action === "revoke_token") {
      const token = this.tokens.get(String(data.tokenHash));
      if (token && token.clientId === data.clientId)
        for (const member of this.tokens.values())
          if (
            member.connectionId === token.connectionId &&
            (!token.family || member.family === token.family)
          )
            member.revoked = true;
      return {};
    }
    throw new Error(`Unexpected fake-store action: ${action}`);
  }
  async user(token: string) {
    if (token !== userSession) throw new McpError("unauthorized", 401);
    return owner;
  }
  async uploadUrl(): Promise<string> {
    throw new Error("Unexpected upload");
  }
  async put(path: string, bytes: Uint8Array): Promise<void> {
    this.storageWrites.push(path);
    if (this.files.has(path)) throw new McpError("upload_conflict", 409);
    this.files.set(path, bytes.slice());
  }
  async download(path: string): Promise<Uint8Array> {
    this.storageReads.push(path);
    const bytes = this.files.get(path);
    if (!bytes) throw new McpError("file_not_found", 404);
    return bytes.slice();
  }
  async list(prefix: string): Promise<string[]> {
    return [...this.files.keys()]
      .filter((path) => path.startsWith(`${prefix}/`))
      .sort();
  }
  async remove(paths: string[]): Promise<void> {
    paths.forEach((path) => this.files.delete(path));
  }
}

function harness(scopes?: string[]) {
  const store = new MemoryStore(scopes);
  const app = createMcpApp(config, store);
  let requestId = 0;
  async function rpc(
    method: string,
    params: Record<string, unknown> = {},
    options: {
      token?: string | null;
      origin?: string;
      modern?: boolean;
      headers?: Record<string, string>;
    } = {},
  ) {
    const modern = options.modern ?? false;
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": modern ? "2026-07-28" : "2025-11-25",
      ...options.headers,
    };
    if (options.token !== null)
      headers.authorization = `Bearer ${options.token ?? personal}`;
    if (options.origin) headers.origin = options.origin;
    if (modern) {
      headers["mcp-method"] = method;
      if (method === "tools/call") headers["mcp-name"] = String(params.name);
    }
    const requestBody = {
      jsonrpc: "2.0",
      id: ++requestId,
      method,
      params: modern
        ? {
            ...params,
            _meta: {
              "io.modelcontextprotocol/protocolVersion": "2026-07-28",
              "io.modelcontextprotocol/clientCapabilities": {},
              "io.modelcontextprotocol/clientInfo": {
                name: "bari-integration-tests",
                version: "1",
              },
            },
          }
        : params,
    };
    const response = await app(
      new Request(resource, {
        method: "POST",
        headers,
        body: JSON.stringify(requestBody),
      }),
    );
    const text = await response.text();
    const body = response.headers
      .get("content-type")
      ?.includes("text/event-stream")
      ? text
          .split(/\r?\n/)
          .filter((line) => line.startsWith("data: "))
          .map((line) => JSON.parse(line.slice(6)))
          .find((message) => message.id === requestBody.id)
      : JSON.parse(text);
    return { response, body: body as Record<string, any> };
  }
  const tool = (
    name: string,
    args: Record<string, unknown> = {},
    options: Parameters<typeof rpc>[2] = {},
  ) => rpc("tools/call", { name, arguments: args }, options);
  return { store, app, rpc, tool };
}
const purchase = () => ({
  expected_revision: 7,
  idempotency_key: "invoice-1",
  command: {
    type: "create_purchase",
    date: "2026-11-02",
    person_id: "shop",
    work_id: "roof",
    lines: [{ label: "সিমেন্ট", cost_type: "material", amount_paisa: 6000000 }],
    payment_state: "partial",
    payment: { amount_paisa: 2000000, method: "cash" },
  },
});
function toolValue(body: Record<string, any>) {
  return (
    body.result?.structuredContent ?? body.result?.content?.structuredContent
  );
}
function receiptFixture(
  h: ReturnType<typeof harness>,
  status = "uploaded",
  connectionId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
) {
  const bytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);
  const id = randomUUID();
  const asset: Asset & { connectionId: string } = {
    id,
    ownerId: owner,
    connectionId,
    path: `${owner}/${id}`,
    name: "cement-bill.png",
    mime: "image/png",
    size: bytes.length,
    sha256: sha256(bytes),
    status,
  };
  h.store.assets.set(id, asset);
  h.store.files.set(
    status === "uploaded" ? asset.path : `${owner}/.mcp-staging/${id}`,
    bytes,
  );
  return { asset, bytes };
}
function ordinaryReceiptFixture(
  h: ReturnType<typeof harness>,
  id: string,
  fromRevision = false,
) {
  const bytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);
  const receipt = {
    id,
    name: "old-bill.png",
    mime: "image/png",
    size: bytes.length,
  };
  const core = {
    id: "ordinary-bill",
    kind: "expense",
    date: "2026-11-02",
    lines: [
      { id: "ordinary-line", workId: "roof", label: "সিমেন্ট", amount: 10000 },
    ],
    receipts: [receipt],
  };
  h.store.snapshots.get(owner)!.document = LedgerSchema.parse({
    ...ledgerFixture(),
    entries: [
      {
        ...core,
        receipts: fromRevision ? [] : [receipt],
        revisions: fromRevision
          ? [{ at: "2026-11-02T11:00:00.000Z", before: core }]
          : [],
      },
    ],
  });
  h.store.files.set(`${owner}/${id}`, bytes);
  return { receipt, bytes };
}
async function form(
  app: (request: Request) => Promise<Response>,
  action: string,
  input: Record<string, string>,
  headers: Record<string, string> = {},
) {
  const response = await app(
    new Request(`${origin}/api/mcp-auth/${action}`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        ...headers,
      },
      body: new URLSearchParams(input),
    }),
  );
  return { response, body: (await response.json()) as Record<string, any> };
}
async function beginAuthorization(
  h: ReturnType<typeof harness>,
  method: "none" | "client_secret_basic" = "none",
  omitRegistrationScope = false,
) {
  const response = await h.app(
    new Request(`${origin}/api/mcp-auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "My assistant",
        redirect_uris: ["https://assistant.example/callback"],
        token_endpoint_auth_method: method,
        scope: omitRegistrationScope ? undefined : "ledger:read entries:create",
      }),
    }),
  );
  expect(response.status).toBe(201);
  const client = (await response.json()) as {
    client_id: string;
    client_secret?: string;
    scope: string;
  };
  if (omitRegistrationScope)
    expect(client.scope.split(" ")).toEqual(
      expect.arrayContaining([...MCP_SCOPES]),
    );
  const verifier = "v".repeat(64);
  const url = new URL(`${origin}/api/mcp-auth/authorize`);
  url.search = new URLSearchParams({
    client_id: client.client_id,
    redirect_uri: "https://assistant.example/callback",
    response_type: "code",
    code_challenge_method: "S256",
    code_challenge: challenge(verifier),
    state: "client-state-1",
    resource,
    scope: "ledger:read entries:create",
  }).toString();
  const authorization = await h.app(new Request(url));
  expect(authorization.status).toBe(302);
  const requestId = new URL(
    authorization.headers.get("location")!,
  ).searchParams.get("request")!;
  return {
    ...client,
    verifier,
    authorizationUrl: url.href,
    requestId,
    redirectUri: "https://assistant.example/callback",
  };
}
async function approveAuthorization(
  h: ReturnType<typeof harness>,
  requestId: string,
  input: Record<string, unknown> = {},
) {
  return h.app(
    new Request(`${origin}/api/mcp-admin`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${userSession}`,
        origin,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        action: "approve_authorization",
        requestId,
        approve: true,
        ...input,
      }),
    }),
  );
}
async function authorize(
  h: ReturnType<typeof harness>,
  method: "none" | "client_secret_basic" = "none",
  omitRegistrationScope = false,
) {
  const pending = await beginAuthorization(h, method, omitRegistrationScope);
  const { requestId } = pending;
  const consent = await approveAuthorization(h, requestId);
  expect(consent.status).toBe(200);
  const approved = (await consent.json()) as { redirectUrl: string };
  const redirect = new URL(approved.redirectUrl);
  expect(redirect.searchParams.get("state")).toBe("client-state-1");
  return {
    ...pending,
    code: redirect.searchParams.get("code")!,
    redirectUri: "https://assistant.example/callback",
  };
}

describe("MCP HTTP security and protocol integration", () => {
  it("keeps two owners' entry identities and operation results separate", async () => {
    const h = harness();
    const secondOwner = "22222222-2222-4222-8222-222222222222";
    const secondToken = `bkm_p_${"B".repeat(43)}`;
    const connection: Connection = {
      id: randomUUID(),
      ownerId: secondOwner,
      name: "অন্য সহকারী",
      scopes: [...MCP_SCOPES],
      policy: {},
    };
    h.store.connections.set(connection.id, connection);
    h.store.tokens.set(sha256(secondToken), {
      connectionId: connection.id,
      kind: "personal",
    });
    h.store.snapshots.set(secondOwner, {
      revision: 7,
      document: ledgerFixture(),
      updatedAt: null,
    });
    const first = toolValue((await h.tool("apply_change", purchase())).body);
    const foreignEntry = await h.tool(
      "get_entry",
      { entry_id: first.entries[0].id },
      { token: secondToken },
    );
    expect(toolValue(foreignEntry.body)).toMatchObject({ error: "not_found" });
    const foreignOperation = await h.tool(
      "get_operation_status",
      { idempotency_key: "invoice-1" },
      { token: secondToken },
    );
    expect(toolValue(foreignOperation.body)).toMatchObject({ operation: null });
    expect(
      toolValue((await h.tool("get_summary", {}, { token: secondToken })).body)
        .current.cost_paisa,
    ).toBe(0);
    expect(h.store.snapshots.get(secondOwner)!.revision).toBe(7);
  });
  it("does not accept a delegated bearer or cross-origin caller on first-party grant management", async () => {
    const h = harness();
    const create = (token: string, requestOrigin: string) =>
      h.app(
        new Request(`${origin}/api/mcp-admin`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            origin: requestOrigin,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            action: "create_connection",
            name: "Injected",
            scopes: ["ledger:read", "entries:create"],
            ownerId: "another-owner",
          }),
        }),
      );
    expect((await create(personal, origin)).status).toBe(401);
    expect(
      (await create(userSession, "https://assistant.example")).status,
    ).toBe(403);
    expect(h.store.connections.size).toBe(1);
  });
  it("challenges unauthenticated requests and publishes bound authorization/resource discovery", async () => {
    const h = harness();
    const denied = await h.rpc(
      "tools/list",
      {},
      { token: null, origin: "https://assistant.example" },
    );
    expect(denied.response.status).toBe(401);
    expect(denied.response.headers.get("www-authenticate")).toContain(
      `${origin}/.well-known/oauth-protected-resource/api/mcp`,
    );
    for (const scope of [
      "ledger:read",
      "entries:create",
      "entities:write",
      "catalog:write",
      "receipts:read",
      "receipts:write",
    ])
      expect(denied.response.headers.get("www-authenticate")).toContain(scope);
    expect(denied.response.headers.get("access-control-allow-origin")).toBe(
      "https://assistant.example",
    );
    expect(
      denied.response.headers.get("access-control-expose-headers"),
    ).toContain("WWW-Authenticate");
    expect(h.store.calls.some((call) => call.action === "authenticate")).toBe(
      false,
    );
    const metadata = await h.app(
      new Request(`${origin}/.well-known/oauth-protected-resource/api/mcp`),
    );
    expect(await metadata.json()).toMatchObject({
      resource,
      authorization_servers: [origin],
    });
    const server = await h.app(
      new Request(`${origin}/.well-known/oauth-authorization-server`),
    );
    expect(await server.json()).toMatchObject({
      issuer: origin,
      code_challenge_methods_supported: ["S256"],
      token_endpoint: `${origin}/api/mcp-auth/token`,
    });
  });
  it("rejects ordinary user JWTs, refresh tokens, unknown opaque tokens and hostile origins before ledger access", async () => {
    const h = harness();
    for (const token of [
      userSession,
      `bkm_r_${"R".repeat(43)}`,
      `bkm_a_${"Z".repeat(43)}`,
    ]) {
      expect((await h.rpc("tools/list", {}, { token })).response.status).toBe(
        401,
      );
    }
    const before = h.store.calls.length;
    const denied = await h.rpc(
      "tools/list",
      {},
      { origin: "https://attacker.example" },
    );
    expect(denied.response.status).toBe(403);
    expect(denied.body).toMatchObject({ error: "invalid_origin" });
    expect(h.store.calls).toHaveLength(before);
    expect(
      (await h.app(new Request("https://attacker.example/api/mcp"))).status,
    ).toBe(403);
  });
  it("supports legacy initialize, tool discovery and typed financial writes with the actual SDK", async () => {
    const h = harness();
    const init = await h.rpc("initialize", {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "legacy-client", version: "1" },
    });
    expect(init.response.status).toBe(200);
    expect(init.body.result).toMatchObject({
      protocolVersion: "2025-11-25",
      serverInfo: { name: "bari-khata" },
    });
    const list = await h.rpc("tools/list");
    expect(
      list.body.result.tools.map((tool: { name: string }) => tool.name),
    ).toEqual(
      expect.arrayContaining([
        "get_summary",
        "apply_change",
        "get_operation_status",
        "create_receipt_upload",
      ]),
    );
    const saved = await h.tool("apply_change", purchase());
    expect(saved.response.status).toBe(200);
    expect(toolValue(saved.body)).toMatchObject({
      status: "committed",
      revision: 8,
      after: {
        cost_paisa: 6000000,
        paid_paisa: 2000000,
        payable_paisa: 4000000,
      },
    });
    expect(summarize(h.store.snapshots.get(owner)!.document!)).toMatchObject({
      cost: 6000000,
      paid: 2000000,
    });
    expect(saved.response.headers.get("cache-control")).toBe("no-store");
  });
  it("serves modern per-request envelopes and rejects body/header protocol mismatches", async () => {
    const h = harness();
    const list = await h.rpc("tools/list", {}, { modern: true });
    expect(list.response.status).toBe(200);
    expect(list.body.error).toBeUndefined();
    expect(JSON.stringify(list.body)).toContain("get_summary");
    const read = await h.tool("get_summary", {}, { modern: true });
    expect(read.response.status).toBe(200);
    expect(JSON.stringify(read.body)).toContain("current_snapshot");
    const mismatch = await h.rpc(
      "tools/list",
      {},
      { modern: true, headers: { "mcp-protocol-version": "2025-11-25" } },
    );
    expect(mismatch.response.status).toBe(400);
    expect(mismatch.body.error).toBeDefined();
  });
  it("denies unauthorized writes and owner injection without changing the snapshot", async () => {
    const h = harness(["ledger:read"]);
    const denied = await h.tool("apply_change", purchase());
    expect(denied.response.status).toBe(403);
    expect(denied.response.headers.get("www-authenticate")).toContain(
      'error="insufficient_scope"',
    );
    expect(denied.response.headers.get("www-authenticate")).toContain(
      "entries:create",
    );
    expect(denied.response.headers.get("www-authenticate")).toContain(
      "ledger:read",
    );
    expect(denied.response.headers.get("www-authenticate")).toContain(
      `${origin}/.well-known/oauth-protected-resource/api/mcp`,
    );
    expect(h.store.snapshots.get(owner)!.revision).toBe(7);
    const read = await h.tool("get_summary");
    expect(read.response.status).toBe(200);
    expect(toolValue(read.body).current.cost_paisa).toBe(0);
    const ownerInjected = await h.tool("get_summary", {
      owner_id: "another-owner",
    });
    expect(
      ownerInjected.body.result?.isError || ownerInjected.body.error,
    ).toBeTruthy();
    const commandInjected = await h.tool("apply_change", {
      ...purchase(),
      command: { ...purchase().command, owner_id: "another-owner" },
    });
    expect(
      commandInjected.body.result?.isError || commandInjected.body.error,
    ).toBeTruthy();
    expect(h.store.calls.filter((call) => call.action === "save")).toHaveLength(
      0,
    );
  });
  it("does not turn an invoice with unknown payment into cash paid or a payable balance", async () => {
    const h = harness();
    const result = await h.tool("apply_change", {
      ...purchase(),
      command: {
        ...purchase().command,
        payment_state: "unknown",
        payment: undefined,
      },
    });
    expect(result.body.result?.isError || result.body.error).toBeTruthy();
    expect(h.store.snapshots.get(owner)!.revision).toBe(7);
    expect(h.store.snapshots.get(owner)!.document!.entries).toEqual([]);
  });
  it("leaves no partial bill or payment when a later command in the batch fails", async () => {
    const h = harness();
    const first = purchase().command;
    const response = await h.tool("apply_batch", {
      expected_revision: 7,
      idempotency_key: "two-bills-atomic",
      commands: [first, { ...first, work_id: "unknown-work" }],
    });
    expect(response.body.result.isError).toBe(true);
    expect(toolValue(response.body)).toMatchObject({ error: "not_found" });
    expect(h.store.snapshots.get(owner)!.revision).toBe(7);
    expect(h.store.snapshots.get(owner)!.document!.entries).toEqual([]);
    expect(h.store.calls.filter((call) => call.action === "save")).toHaveLength(
      0,
    );
  });
  it("returns the same committed operation and entry identities on an exact retry", async () => {
    const h = harness();
    const first = toolValue((await h.tool("apply_change", purchase())).body);
    const retry = toolValue((await h.tool("apply_change", purchase())).body);
    expect(retry).toMatchObject({
      status: "committed",
      operation_id: first.operation_id,
      revision: first.revision,
      affected_ids: first.affected_ids,
      after: first.after,
    });
    expect(h.store.snapshots.get(owner)!.document!.entries).toHaveLength(2);
    const changed = await h.tool("apply_change", {
      ...purchase(),
      command: { ...purchase().command, note: "different payload" },
    });
    expect(toolValue(changed.body)).toMatchObject({
      error: "operation_payload_mismatch",
    });
    expect(h.store.snapshots.get(owner)!.revision).toBe(8);
  });
  it("recovers a commit whose response was lost without creating another bill", async () => {
    const h = harness();
    h.store.loseNextSaveResponse = true;
    const lost = await h.tool("apply_change", purchase());
    expect(lost.body.result.isError).toBe(true);
    expect(h.store.snapshots.get(owner)!.revision).toBe(8);
    const retry = toolValue((await h.tool("apply_change", purchase())).body);
    expect(retry).toMatchObject({
      status: "committed",
      revision: 8,
      after: { cost_paisa: 6000000, paid_paisa: 2000000 },
    });
    const status = toolValue(
      (await h.tool("get_operation_status", { idempotency_key: "invoice-1" }))
        .body,
    );
    expect(JSON.stringify(status)).toContain(retry.operation_id);
    expect(h.store.snapshots.get(owner)!.document!.entries).toHaveLength(2);
  });
  it("pins pagination to the snapshot revision and filters", async () => {
    const h = harness();
    await h.tool("apply_change", purchase());
    const first = toolValue((await h.tool("list_entries", { limit: 1 })).body);
    expect(first.items).toHaveLength(1);
    expect(first.next_cursor).toEqual(expect.any(String));
    const second = toolValue(
      (await h.tool("list_entries", { limit: 1, cursor: first.next_cursor }))
        .body,
    );
    expect(second.items).toHaveLength(1);
    expect(second.items[0].id).not.toBe(first.items[0].id);
    expect(second.next_cursor).toBeNull();
    const wrongFilter = toolValue(
      (
        await h.tool("list_entries", {
          limit: 1,
          cursor: first.next_cursor,
          person_id: "shop",
        })
      ).body,
    );
    expect(wrongFilter).toMatchObject({ error: "invalid_cursor" });
    h.store.snapshots.get(owner)!.revision++;
    const stale = toolValue(
      (await h.tool("list_entries", { limit: 1, cursor: first.next_cursor }))
        .body,
    );
    expect(stale).toMatchObject({ error: "revision_conflict" });
  });
});

describe("MCP receipt HTTP security", () => {
  it.each([
    "../victim/private-file",
    "..\\victim\\private-file",
    "folder/private-file",
    "%2e%2e%2fvictim%2fprivate-file",
    "%252e%252e%252fvictim%252fprivate-file",
    "https://other.example/private-file",
    "receipt?other=private-file",
    "receipt#private-file",
  ])(
    "rejects a caller-written receipt object path %s before storage access",
    async (id) => {
      const h = harness();
      ordinaryReceiptFixture(h, id);
      for (const name of ["get_receipt", "read_receipt_chunk"]) {
        const result = await h.tool(name, { receipt_id: id });
        expect(result.body.result.isError).toBe(true);
        expect(toolValue(result.body)).toMatchObject({
          error: "invalid_receipt",
        });
      }
      const response = await h.app(
        new Request(
          `${origin}/api/mcp-file?${new URLSearchParams({ receipt: id })}`,
          {
            headers: { authorization: `Bearer ${personal}` },
          },
        ),
      );
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid_receipt" });
      expect(h.store.storageReads).toEqual([]);
      expect(h.store.calls.some(({ action }) => action === "asset")).toBe(
        false,
      );
    },
  );
  it.each([false, true])(
    "keeps safe ordinary receipt IDs readable, including revision receipts: %s",
    async (fromRevision) => {
      const h = harness();
      const id = "old_bill-2026_01";
      const { receipt, bytes } = ordinaryReceiptFixture(h, id, fromRevision);
      const metadata = toolValue(
        (await h.tool("get_receipt", { receipt_id: id })).body,
      );
      expect(metadata.receipt).toMatchObject({
        ...receipt,
        path: `${owner}/${id}`,
        immutable: false,
      });
      const chunk = toolValue(
        (await h.tool("read_receipt_chunk", { receipt_id: id })).body,
      );
      expect(Buffer.from(chunk.data, "base64")).toEqual(Buffer.from(bytes));
      const response = await h.app(
        new Request(`${origin}/api/mcp-file?receipt=${id}`, {
          headers: { authorization: `Bearer ${personal}` },
        }),
      );
      expect(response.status).toBe(200);
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
      expect(
        h.store.storageReads.every((path) => path === `${owner}/${id}`),
      ).toBe(true);
    },
  );
  it("rejects inconsistent MCP receipt ownership metadata before storage access", async () => {
    const h = harness();
    const { asset } = receiptFixture(h);
    h.store.assets.get(asset.id)!.path = `other-owner/${asset.id}`;
    const result = await h.tool("read_receipt_chunk", { receipt_id: asset.id });
    expect(result.body.result.isError).toBe(true);
    expect(toolValue(result.body)).toMatchObject({
      error: "file_integrity_error",
    });
    expect(h.store.storageReads).toEqual([]);
  });
  it("rejects another connection's pending upload before writing chunks or final bytes", async () => {
    const h = harness();
    const { asset, bytes } = receiptFixture(h, "pending", randomUUID());
    const chunk = await h.tool("upload_receipt_chunk", {
      upload_id: asset.id,
      index: 0,
      data: Buffer.from(bytes).toString("base64"),
    });
    expect(chunk.body.result.isError).toBe(true);
    expect(h.store.storageWrites).toEqual([]);
    const finalize = await h.tool("finalize_receipt_upload", {
      upload_id: asset.id,
    });
    expect(finalize.body.result.isError).toBe(true);
    expect(h.store.storageWrites).toEqual([]);
    expect(h.store.assets.get(asset.id)!.status).toBe("pending");
    expect(h.store.files.has(asset.path)).toBe(false);
  });
  it("checks a receipt's digest before returning base64 chunks", async () => {
    const h = harness();
    const { asset, bytes } = receiptFixture(h);
    const corrupt = bytes.slice();
    corrupt[corrupt.length - 1] = 99;
    h.store.files.set(asset.path, corrupt);
    const result = await h.tool("read_receipt_chunk", {
      receipt_id: asset.id,
      offset: 0,
    });
    expect(result.body.result.isError).toBe(true);
    expect(toolValue(result.body)).toMatchObject({
      error: "file_integrity_error",
    });
    expect(toolValue(result.body).data).toBeUndefined();
  });
  it("allows authenticated receipt downloads from a configured browser origin", async () => {
    const h = harness();
    const { asset, bytes } = receiptFixture(h);
    const response = await h.app(
      new Request(`${origin}/api/mcp-file?receipt=${asset.id}`, {
        headers: {
          authorization: `Bearer ${personal}`,
          origin: "https://assistant.example",
        },
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "https://assistant.example",
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
  });
});

describe("MCP OAuth HTTP lifecycle", () => {
  it("reuses one consent request for concurrent visits to the same OAuth flow and approves it once", async () => {
    const h = harness();
    const pending = await beginAuthorization(h);
    const visits = await Promise.all(
      Array.from({ length: 3 }, () =>
        h.app(new Request(pending.authorizationUrl)),
      ),
    );
    const location = `${origin}/mcp/consent?request=${pending.requestId}`;
    expect(visits.map((response) => response.headers.get("location"))).toEqual([
      location,
      location,
      location,
    ]);
    expect(h.store.authorizations.size).toBe(1);

    const approvals = await Promise.all([
      approveAuthorization(h, pending.requestId, { scopes: ["ledger:read"] }),
      approveAuthorization(h, pending.requestId, { scopes: ["ledger:read"] }),
    ]);
    expect(approvals.map((response) => response.status).sort()).toEqual([
      200, 400,
    ]);
    expect(h.store.connections.size).toBe(2);
    expect(h.store.codes.size).toBe(1);
    const approved = await approvals.find((response) => response.ok)!.json();
    const code = new URL(approved.redirectUrl).searchParams.get("code")!;
    const input = {
      grant_type: "authorization_code",
      client_id: pending.client_id,
      code,
      redirect_uri: pending.redirectUri,
      code_verifier: pending.verifier,
      resource,
    };
    const exchanged = await form(h.app, "token", input);
    expect(exchanged.body.scope).toBe("ledger:read");

    expect(
      (await h.app(new Request(pending.authorizationUrl))).headers.get(
        "location",
      ),
    ).toBe(location);
    expect(
      (
        await approveAuthorization(h, pending.requestId, {
          scopes: ["ledger:read", "entries:create"],
        })
      ).ok,
    ).toBe(false);
    expect((await form(h.app, "token", input)).body).toMatchObject({
      error: "invalid_grant",
    });
    expect(h.store.authorizations.size).toBe(1);
    expect(h.store.connections.size).toBe(2);
    expect(h.store.codes.size).toBe(1);
    expect(
      [...h.store.connections.values()].find(
        (connection) => connection.clientId === pending.client_id,
      )!.scopes,
    ).toEqual(["ledger:read"]);
  });
  it("does not widen an existing OAuth flow's scopes or combine separate grants by client name", async () => {
    const h = harness();
    const first = await beginAuthorization(h, "none", true);
    const altered = new URL(first.authorizationUrl);
    altered.searchParams.set(
      "scope",
      "ledger:read entries:create entities:write",
    );
    const rejected = await h.app(new Request(altered));
    expect(await rejected.json()).toMatchObject({ error: "invalid_scope" });
    expect(h.store.authorizations.size).toBe(1);

    const second = await beginAuthorization(h, "none", true);
    expect(second.client_id).not.toBe(first.client_id);
    expect(second.requestId).not.toBe(first.requestId);
    expect(h.store.authorizations.size).toBe(2);
    expect((await approveAuthorization(h, first.requestId)).ok).toBe(true);
    expect((await approveAuthorization(h, second.requestId)).ok).toBe(true);
    expect(h.store.connections.size).toBe(3);
  });
  it("permits a default registered client to request write access, while granting only the owner's approved scopes", async () => {
    const h = harness();
    const authorized = await authorize(h, "none", true);
    const accepted = await form(h.app, "token", {
      grant_type: "authorization_code",
      client_id: authorized.client_id,
      code: authorized.code,
      redirect_uri: authorized.redirectUri,
      code_verifier: authorized.verifier,
      resource,
    });
    expect(accepted.response.status).toBe(200);
    expect(accepted.body.scope.split(" ").sort()).toEqual([
      "entries:create",
      "ledger:read",
    ]);
    const saved = await h.tool("apply_change", purchase(), {
      token: accepted.body.access_token,
    });
    expect(saved.response.status).toBe(200);
    expect(toolValue(saved.body)).toMatchObject({
      status: "committed",
      revision: 8,
      after: {
        cost_paisa: 6000000,
        paid_paisa: 2000000,
        payable_paisa: 4000000,
      },
    });
    const receipt = await h.tool(
      "get_receipt",
      { receipt_id: "private-receipt" },
      { token: accepted.body.access_token },
    );
    expect(receipt.response.status).toBe(403);
    const header = receipt.response.headers.get("www-authenticate");
    expect(header).toContain('error="insufficient_scope"');
    for (const scope of ["ledger:read", "entries:create", "receipts:read"])
      expect(header).toContain(scope);
  });
  it("returns invalid_scope for unknown scope names at registration and authorization", async () => {
    const h = harness();
    const invalid = await h.app(
      new Request(`${origin}/api/mcp-auth/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          redirect_uris: ["https://assistant.example/callback"],
          scope: "ledger:read ledger:delete",
        }),
      }),
    );
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ error: "invalid_scope" });
    const registered = await h.app(
      new Request(`${origin}/api/mcp-auth/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          redirect_uris: ["https://assistant.example/callback"],
        }),
      }),
    );
    const client = (await registered.json()) as { client_id: string };
    const url = new URL(`${origin}/api/mcp-auth/authorize`);
    url.search = new URLSearchParams({
      client_id: client.client_id,
      redirect_uri: "https://assistant.example/callback",
      response_type: "code",
      code_challenge_method: "S256",
      code_challenge: challenge("v".repeat(64)),
      scope: "ledger:read ledger:delete",
    }).toString();
    const denied = await h.app(new Request(url));
    expect(denied.status).toBe(400);
    expect(await denied.json()).toMatchObject({ error: "invalid_scope" });
    expect(h.store.authorizations.size).toBe(0);
  });
  it("returns a controlled OAuth error for an unknown client before requesting consent", async () => {
    const h = harness();
    const url = new URL(`${origin}/api/mcp-auth/authorize`);
    url.search = new URLSearchParams({
      client_id: "unknown-client-id",
      redirect_uri: "https://assistant.example/callback",
      response_type: "code",
      code_challenge_method: "S256",
      code_challenge: challenge("v".repeat(64)),
    }).toString();
    const response = await h.app(new Request(url));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_client" });
    expect(h.store.authorizations.size).toBe(0);
  });
  it("requires a registered exact redirect and S256 before creating a consent request", async () => {
    const h = harness();
    const registration = await h.app(
      new Request(`${origin}/api/mcp-auth/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          redirect_uris: ["https://assistant.example/callback"],
        }),
      }),
    );
    const client = (await registration.json()) as { client_id: string };
    const url = new URL(`${origin}/api/mcp-auth/authorize`);
    url.search = new URLSearchParams({
      client_id: client.client_id,
      redirect_uri: "https://attacker.example/callback",
      response_type: "code",
      code_challenge_method: "S256",
      code_challenge: challenge("v".repeat(64)),
    }).toString();
    expect((await h.app(new Request(url))).status).toBe(400);
    url.searchParams.set("redirect_uri", "https://assistant.example/callback");
    url.searchParams.set("code_challenge_method", "plain");
    expect((await h.app(new Request(url))).status).toBe(400);
    expect(h.store.authorizations.size).toBe(0);
  });
  it("binds code exchange to PKCE, redirect, client and resource and consumes a code once", async () => {
    const h = harness();
    const authorized = await authorize(h);
    const input = {
      grant_type: "authorization_code",
      client_id: authorized.client_id,
      code: authorized.code,
      redirect_uri: authorized.redirectUri,
      code_verifier: authorized.verifier,
      resource,
    };
    expect(
      (await form(h.app, "token", { ...input, code_verifier: "x".repeat(64) }))
        .body,
    ).toMatchObject({ error: "invalid_grant" });
    expect(
      (
        await form(h.app, "token", {
          ...input,
          redirect_uri: "https://attacker.example/callback",
        })
      ).body,
    ).toMatchObject({ error: "invalid_grant" });
    expect(
      (
        await form(h.app, "token", {
          ...input,
          resource: "https://another.example/mcp",
        })
      ).body,
    ).toMatchObject({ error: "invalid_target" });
    const accepted = await form(h.app, "token", input);
    expect(accepted.response.status).toBe(200);
    expect(accepted.body.access_token).toMatch(/^bkm_a_/);
    expect(accepted.body.refresh_token).toMatch(/^bkm_r_/);
    expect(
      (await h.rpc("tools/list", {}, { token: accepted.body.access_token }))
        .response.status,
    ).toBe(200);
    expect(
      (await h.rpc("tools/list", {}, { token: accepted.body.refresh_token }))
        .response.status,
    ).toBe(401);
    expect((await form(h.app, "token", input)).body).toMatchObject({
      error: "invalid_grant",
    });
  });
  it("authenticates a confidential client before exchange and rotates/revokes a replayed refresh family", async () => {
    const h = harness();
    const authorized = await authorize(h, "client_secret_basic");
    const input = {
      grant_type: "authorization_code",
      code: authorized.code,
      redirect_uri: authorized.redirectUri,
      code_verifier: authorized.verifier,
      resource,
    };
    expect(
      (
        await form(h.app, "token", {
          ...input,
          client_id: authorized.client_id,
        })
      ).body,
    ).toMatchObject({ error: "invalid_client" });
    const header = {
      authorization: `Basic ${Buffer.from(`${authorized.client_id}:${authorized.client_secret}`).toString("base64")}`,
    };
    const wrongSecret = {
      authorization: `Basic ${Buffer.from(`${authorized.client_id}:wrong-client-secret`).toString("base64")}`,
    };
    expect((await form(h.app, "token", input, wrongSecret)).body).toMatchObject(
      { error: "invalid_client" },
    );
    const accepted = await form(h.app, "token", input, header);
    expect(accepted.response.status).toBe(200);
    const refresh = {
      grant_type: "refresh_token",
      refresh_token: accepted.body.refresh_token,
      resource,
    };
    const rotated = await form(h.app, "token", refresh, header);
    expect(rotated.response.status).toBe(200);
    expect(rotated.body.refresh_token).not.toBe(accepted.body.refresh_token);
    expect(
      (await h.rpc("tools/list", {}, { token: rotated.body.access_token }))
        .response.status,
    ).toBe(200);
    expect((await form(h.app, "token", refresh, header)).body).toMatchObject({
      error: "invalid_grant",
    });
    expect(
      (await h.rpc("tools/list", {}, { token: rotated.body.access_token }))
        .response.status,
    ).toBe(401);
  });
});
