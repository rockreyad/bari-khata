import { z } from "zod";
import { getCloudSession } from "../../data/sync";
import { getActiveOwner } from "../../data/database";

export const assistantScopes = [
  "ledger:read",
  "entries:create",
  "entries:update",
  "entries:void_restore",
  "entities:write",
  "contracts:write",
  "catalog:write",
  "receipts:read",
  "receipts:write",
] as const;
export type AssistantScope = (typeof assistantScopes)[number];
export const scopeLabels: Record<AssistantScope, string> = {
  "ledger:read": "হিসাব খোঁজা ও দেখা",
  "entries:create": "নতুন হিসাব রাখা",
  "entries:update": "আগের হিসাব সংশোধন",
  "entries:void_restore": "হিসাব বাতিল ও ফিরিয়ে আনা",
  "entities:write": "ব্যক্তি ও কাজের খাতা সাজানো",
  "contracts:write": "কাজের চুক্তি রাখা ও বদলানো",
  "catalog:write": "মালের নাম ও ধরন সাজানো",
  "receipts:read": "ভাউচার দেখা",
  "receipts:write": "ভাউচার যোগ করা",
};
export const dailyScopes: AssistantScope[] = [
  "ledger:read",
  "entries:create",
  "entities:write",
  "catalog:write",
  "receipts:read",
  "receipts:write",
];
const PolicySchema = z
  .object({
    confirmationRequired: z.boolean().optional(),
    maxAmountPaisa: z.number().int().nonnegative().nullable().optional(),
    maxDailyAmountPaisa: z.number().int().nonnegative().nullable().optional(),
    maxDailyOperations: z.number().int().positive().nullable().optional(),
  })
  .passthrough();
export type AssistantPolicy = z.infer<typeof PolicySchema>;
const ConnectionSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    scopes: z.array(z.string()),
    policy: PolicySchema.default({}),
    createdAt: z.string().nullable().optional(),
    created_at: z.string().nullable().optional(),
    revokedAt: z.string().nullable().optional(),
    revoked_at: z.string().nullable().optional(),
    lastUsedAt: z.string().nullable().optional(),
    last_used_at: z.string().nullable().optional(),
    expiresAt: z.string().nullable().optional(),
  })
  .passthrough();
export type AssistantConnection = z.infer<typeof ConnectionSchema>;
const EndpointSchema = z
  .string()
  .url()
  .refine((value) => {
    const url = new URL(value);
    return (
      !url.username &&
      !url.password &&
      (url.protocol === "https:" ||
        (url.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
    );
  });
const ConnectionsSchema = z.object({
  connections: z.array(ConnectionSchema).default([]),
  endpoint: EndpointSchema.optional(),
  available: z.boolean().default(true),
});
const CreatedSchema = z.object({
  connection: ConnectionSchema,
  token: z.string().min(1).max(8192),
  endpoint: EndpointSchema,
});
const ProposalSchema = z
  .object({
    id: z.string().min(1),
    status: z.string().default("awaiting_approval"),
    summary: z.string().optional(),
    command: z.record(z.string(), z.unknown()).optional(),
    commands: z.array(z.record(z.string(), z.unknown())).optional(),
    actorName: z.string().optional(),
    expiresAt: z.string().nullable().optional(),
    result: z
      .object({
        before: z
          .record(
            z.string(),
            z
              .number()
              .int()
              .min(-Number.MAX_SAFE_INTEGER)
              .max(Number.MAX_SAFE_INTEGER),
          )
          .optional(),
        after: z
          .record(
            z.string(),
            z
              .number()
              .int()
              .min(-Number.MAX_SAFE_INTEGER)
              .max(Number.MAX_SAFE_INTEGER),
          )
          .optional(),
      })
      .passthrough()
      .optional(),
    createdAt: z.string().nullable().optional(),
    created_at: z.string().nullable().optional(),
  })
  .passthrough();
export type AssistantProposal = z.infer<typeof ProposalSchema>;
export function proposalCommands(proposal: AssistantProposal) {
  return proposal.commands ?? (proposal.command ? [proposal.command] : []);
}
export function canReviewProposal(proposal: AssistantProposal) {
  const commands = proposalCommands(proposal);
  return (
    commands.length > 0 &&
    commands.every(
      (command) => typeof command.type === "string" && Boolean(command.type),
    )
  );
}
const ProposalsSchema = z.object({ proposals: z.array(ProposalSchema) });
const AuthorizationSchema = z.object({
  authorization: z.object({
    requestId: z.string().min(1),
    clientName: z.string().min(1),
    redirectUri: EndpointSchema,
    scopes: z.array(z.enum(assistantScopes)).min(1),
  }),
});
export type AssistantAuthorization = z.infer<
  typeof AuthorizationSchema
>["authorization"];

async function request<T>(
  ownerId: string,
  schema: z.ZodType<T>,
  query?: Record<string, string>,
  body?: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<T> {
  const session = await getCloudSession();
  if (!session || session.user.id !== ownerId || getActiveOwner() !== ownerId)
    throw new Error("sign_in_required");
  const suffix = query ? `?${new URLSearchParams(query)}` : "";
  const response = await fetch(`/api/mcp-admin${suffix}`, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
    credentials: "same-origin",
    signal,
  });
  if (getActiveOwner() !== ownerId) throw new Error("account_changed");
  const result: unknown = await response.json().catch(() => null);
  if (getActiveOwner() !== ownerId) throw new Error("account_changed");
  if (!response.ok) {
    const error = z.object({ error: z.string() }).safeParse(result);
    throw new Error(error.success ? error.data.error : "assistant_unavailable");
  }
  const parsed = schema.safeParse(result);
  if (!parsed.success) throw new Error("assistant_invalid_response");
  return parsed.data;
}

export const loadAssistantConnections = (owner: string, signal?: AbortSignal) =>
  request(
    owner,
    ConnectionsSchema,
    { resource: "connections" },
    undefined,
    signal,
  );
export const loadAssistantProposals = (owner: string, signal?: AbortSignal) =>
  request(owner, ProposalsSchema, { resource: "proposals" }, undefined, signal);
export const createAssistantConnection = (
  owner: string,
  input: { name: string; scopes: AssistantScope[]; policy: AssistantPolicy },
) =>
  request(owner, CreatedSchema, undefined, {
    action: "create_connection",
    ...input,
  });
export const revokeAssistantConnection = (
  owner: string,
  connectionId: string,
) =>
  request(owner, z.unknown(), undefined, {
    action: "revoke_connection",
    connectionId,
  });
export const approveAssistantProposal = (
  owner: string,
  id: string,
  approve: boolean,
) =>
  request(owner, z.unknown(), undefined, {
    action: "approve_proposal",
    id,
    approve,
  });
export const loadAssistantAuthorization = (
  owner: string,
  requestId: string,
  signal?: AbortSignal,
) =>
  request(
    owner,
    AuthorizationSchema,
    { resource: "authorization", request: requestId },
    undefined,
    signal,
  );
export const approveAssistantAuthorization = (
  owner: string,
  input: {
    requestId: string;
    approve: boolean;
    name: string;
    scopes: AssistantScope[];
    policy: AssistantPolicy;
  },
) =>
  request(owner, z.object({ redirectUrl: EndpointSchema }), undefined, {
    action: "approve_authorization",
    ...input,
  });

export function assistantConfiguration(endpoint: string, token: string) {
  return JSON.stringify(
    {
      mcpServers: {
        "bari-khata": {
          url: endpoint,
          headers: { Authorization: `Bearer ${token}` },
        },
      },
    },
    null,
    2,
  );
}

export function assistantInstallCommand(endpoint: string) {
  const safeUrl = EndpointSchema.parse(endpoint).replaceAll("'", "'\\''");
  return `codex mcp add bari-khata --url '${safeUrl}'\ncodex mcp login bari-khata`;
}

export const assistantErrors: Record<string, string> = {
  unauthorized: "আবার লগইন করে চেষ্টা করুন।",
  service_unavailable:
    "সহকারীর সংযোগ এখন পাওয়া যাচ্ছে না। একটু পরে চেষ্টা করুন।",
  mcp_proposal_expired: "এই প্রস্তাবের সময় শেষ। সহকারীকে আবার দেখতে বলুন।",
  mcp_authorization_expired: "এই অনুরোধের সময় শেষ। সহকারী থেকে আবার সংযোগ দিন।",
  mcp_not_found: "এই সংযোগ বা প্রস্তাব পাওয়া যায়নি। তালিকাটি আবার খুলুন।",
  sign_in_required: "আবার লগইন করে চেষ্টা করুন।",
  authentication_required: "আবার লগইন করে চেষ্টা করুন।",
  account_changed: "অ্যাকাউন্ট বদলেছে। নিজের খাতা আবার খুলুন।",
  assistant_unavailable:
    "সহকারীর সংযোগ এখন পাওয়া যাচ্ছে না। একটু পরে চেষ্টা করুন।",
  mcp_unavailable: "সহকারীর সংযোগ এখন চালু নেই। একটু পরে চেষ্টা করুন।",
  assistant_invalid_response:
    "সংযোগের তথ্য ঠিকমতো পাওয়া যায়নি। আবার চেষ্টা করুন।",
  request_expired: "এই অনুরোধের সময় শেষ। সহকারী থেকে আবার সংযোগ দিন।",
  authorization_expired: "এই অনুরোধের সময় শেষ। সহকারী থেকে আবার সংযোগ দিন।",
  approval_expired: "এই প্রস্তাবের সময় শেষ। সহকারীকে আবার দেখতে বলুন।",
  revision_conflict: "খাতার হিসাব বদলেছে। সহকারীকে নতুন করে দেখে নিতে বলুন।",
  rate_limited: "অনেকবার চেষ্টা হয়েছে। একটু পরে আবার চেষ্টা করুন।",
  invalid_amount: "টাকার সীমায় সঠিক অঙ্ক লিখুন।",
};
