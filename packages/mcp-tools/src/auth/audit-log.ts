/**
 * MCP audit log (T2.13 · D23 · DEV-ONLY).
 *
 * Append-only structured log of every authorization decision. The dev
 * default writes to `.run/mcp-audit.jsonl`; production worlds plug in
 * their own append-only sink (Splunk · Datadog · Loki · etc) via the
 * canonical {@link AuditLogSink} interface.
 *
 * One record per request — written AFTER the validator returns, regardless
 * of outcome (success OR rejection). The `outcome` field captures the
 * verdict; downstream analytics filter by `outcome` to find abuse / drift.
 */
import type { IdentityId, MCPToolPermission, WorldId } from "@0xhoneyjar/quests-protocol";

export interface AuditLogRecord {
  readonly ts: string;
  readonly caller: IdentityId | "unknown";
  readonly world: WorldId | "global" | "unknown";
  readonly tool: MCPToolPermission | string;
  readonly args_hash: string;
  readonly outcome:
    | "ok"
    | "token_invalid"
    | "token_expired"
    | "scope_denied"
    | "permission_denied"
    | "rate_limited"
    | "replay_detected"
    | "adapter_error";
  readonly latency_ms: number;
  readonly request_id?: string;
}

/**
 * Canonical sink interface. Production worlds implement this against
 * their log infrastructure. Implementations MUST be:
 *   - Append-only (no update / delete)
 *   - Non-blocking from the validator's perspective (best-effort)
 *   - Schema-stable: never drop fields silently
 */
export interface AuditLogSink {
  readonly append: (record: AuditLogRecord) => void;
  readonly flush?: () => Promise<void>;
}

/**
 * In-memory audit log sink (DEV-ONLY). Holds records in memory and exposes
 * them for test inspection. Production plugs in a file/network sink.
 *
 * Note: this implementation does NOT match the production interface for the
 * .run/mcp-audit.jsonl file sink — that's a separate "production interface
 * stub" the SDD calls for in D23. The stub is `appendOnlyJsonlSinkSpec`
 * below (interface only; the runtime is the consumer's responsibility).
 */
export interface InMemoryAuditLogConfig {
  readonly capacity?: number;
}

export interface InMemoryAuditLogSinkHandle {
  readonly sink: AuditLogSink;
  readonly records: () => ReadonlyArray<AuditLogRecord>;
  readonly clear: () => void;
}

export const makeInMemoryAuditLogSink = (
  config: InMemoryAuditLogConfig = {},
): InMemoryAuditLogSinkHandle => {
  const capacity = config.capacity ?? 10_000;
  const records: AuditLogRecord[] = [];
  return {
    sink: {
      append: (record) => {
        records.push(record);
        if (records.length > capacity) {
          records.splice(0, records.length - capacity);
        }
      },
    },
    records: () => records.slice(),
    clear: () => {
      records.length = 0;
    },
  };
};

/**
 * Production sink contract — opaque interface placeholder, written here so
 * worlds know what shape to plug in (D23 production interface stub). The
 * concrete implementation (.run/mcp-audit.jsonl writer · log4j-style sink ·
 * Splunk client) lives in each world's deployment.
 */
export interface AppendOnlyJsonlSinkSpec {
  readonly description: "append-only JSONL sink — never updates or deletes records";
  readonly append: (record: AuditLogRecord) => Promise<void>;
  readonly close: () => Promise<void>;
}

export const appendOnlyJsonlSinkSpec: AppendOnlyJsonlSinkSpec = {
  description: "append-only JSONL sink — never updates or deletes records",
  append: async () => {
    throw new Error(
      "appendOnlyJsonlSinkSpec is a contract stub — worlds MUST provide a concrete sink",
    );
  },
  close: async () => {
    /* no-op */
  },
};
