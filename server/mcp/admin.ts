import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  McpError,
  Policy,
  Scopes,
  bearer,
  json,
  readJson,
  requestGuard,
  secret,
  sha256,
  type McpConfig,
} from "./common.js";
import type { McpStore } from "./store.js";
import { limited } from "./oauth.js";

export async function adminHandler(
  request: Request,
  config: McpConfig,
  store: McpStore,
) {
  requestGuard(request, config, true);
  const ownerId = await store.user(bearer(request));
  await limited(store, `admin:${ownerId}`, 60);
  const url = new URL(request.url),
    endpoint = `${config.origin}/api/mcp`;
  if (request.method === "GET") {
    const resource = url.searchParams.get("resource") ?? "connections";
    if (resource === "connections")
      return json({
        ...(await store.call<Record<string, unknown>>("list_connections", {
          ownerId,
        })),
        endpoint,
        available: true,
      });
    if (resource === "proposals") {
      const { proposals } = await store.call<{
        proposals: Record<string, unknown>[];
      }>("list_proposals", { ownerId });
      return json({
        proposals: proposals.map((proposal) => {
          const source = proposal.source as
            { commands?: Record<string, unknown>[] } | undefined;
          const { document: _document, ...safe } = proposal;
          return {
            ...safe,
            commands: source?.commands ?? [],
            ...(source?.commands?.length === 1
              ? { command: source.commands[0] }
              : {}),
          };
        }),
        endpoint,
      });
    }
    if (resource === "authorization") {
      const requestId = z
        .string()
        .uuid()
        .parse(url.searchParams.get("request"));
      return json({
        authorization: await store.call("authorization_details", {
          ownerId,
          requestId,
        }),
      });
    }
    throw new McpError("not_found", 404);
  }
  if (request.method !== "POST") throw new McpError("method_not_allowed", 405);
  const body = z
    .record(z.string(), z.unknown())
    .parse(await readJson(request, 24 * 1024));
  if (body.action === "create_connection") {
    const name = z.string().trim().min(1).max(120).parse(body.name),
      scopes = Scopes.parse(body.scopes),
      policy = Object.fromEntries(
        Object.entries(Policy.parse(body.policy ?? {})).filter(
          ([, value]) => value !== null,
        ),
      );
    const token = secret("bkm_p_"),
      expiresAt = new Date(Date.now() + 90 * 86400000).toISOString();
    const { connection } = await store.call<{
      connection: Record<string, unknown>;
    }>("create_connection", {
      ownerId,
      name,
      scopes,
      policy,
      tokenHash: sha256(token),
      expiresAt,
      resource: endpoint,
    });
    return json({ connection, token, endpoint, expiresAt }, 201);
  }
  if (body.action === "revoke_connection") {
    const connectionId = z.string().uuid().parse(body.connectionId);
    await store.call("revoke_connection", { ownerId, connectionId });
    return json({ revoked: true });
  }
  if (body.action === "approve_proposal") {
    const id = z.string().uuid().parse(body.id),
      approve = z.boolean().parse(body.approve);
    return json(await store.call("approve_proposal", { ownerId, id, approve }));
  }
  if (body.action === "approve_authorization") {
    const requestId = z.string().uuid().parse(body.requestId),
      approve = z.boolean().parse(body.approve);
    const details = await store.call<{
      redirectUri: string;
      state: string;
      clientName: string;
      scopes: string[];
    }>("authorization_details", { ownerId, requestId });
    const code = secret("bkm_c_");
    if (!approve) {
      await store.call("deny_authorization", { ownerId, requestId });
      const redirect = new URL(details.redirectUri);
      redirect.searchParams.set("error", "access_denied");
      if (details.state) redirect.searchParams.set("state", details.state);
      return json({ redirectUrl: redirect.href });
    }
    const scopes = Scopes.parse(body.scopes ?? details.scopes);
    if (scopes.some((scope) => !details.scopes.includes(scope)))
      throw new McpError("invalid_scope");
    const policy = Object.fromEntries(
        Object.entries(Policy.parse(body.policy ?? {})).filter(
          ([, value]) => value !== null,
        ),
      ),
      name = z
        .string()
        .trim()
        .min(1)
        .max(120)
        .parse(body.name ?? details.clientName);
    const approved = await store.call<{ redirectUri: string; state: string }>(
      "approve_authorization",
      {
        ownerId,
        requestId,
        name,
        scopes,
        policy,
        codeHash: sha256(code),
        connectionId: randomUUID(),
      },
    );
    const redirect = new URL(approved.redirectUri);
    redirect.searchParams.set("code", code);
    if (approved.state) redirect.searchParams.set("state", approved.state);
    return json({ redirectUrl: redirect.href });
  }
  throw new McpError("invalid_request");
}
