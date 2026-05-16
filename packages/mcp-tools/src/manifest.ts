import { Schema } from "effect";

/**
 * MCP manifest schema (T2.10 · FR-9).
 *
 * Validates packages/mcp-tools/manifest.json at load time. World gateways
 * consuming the manifest re-validate to catch shape drift (e.g., a stale
 * checked-in manifest after upstream tool spec rotation).
 */
export const MCPToolEntry = Schema.Struct({
  name: Schema.String.pipe(
    Schema.pattern(/^[a-z][a-z0-9-]{1,63}$/),
    Schema.minLength(1),
    Schema.maxLength(64),
  ),
  spec: Schema.String.pipe(
    Schema.pattern(/^\.\/tools\/[a-z0-9-]+\.json$/),
  ),
  description: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(512)),
  read_only: Schema.Literal(true),
});

export type MCPToolEntry = Schema.Schema.Type<typeof MCPToolEntry>;

export const MCPAuthSection = Schema.Struct({
  scheme: Schema.Literal("bearer-token"),
  discovery: Schema.String.pipe(
    Schema.pattern(/^https?:\/\/[^\s]+$/),
    Schema.minLength(1),
    Schema.maxLength(512),
  ),
});

export const MCPManifest = Schema.Struct({
  $schema: Schema.Literal("https://schemas.freeside.thj/mcp-manifest/v1.0.0"),
  name: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(128)),
  version: Schema.String.pipe(Schema.pattern(/^\d+\.\d+\.\d+(-[a-z0-9.]+)?$/)),
  description: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(1024)),
  transport: Schema.Literal("stdio"),
  auth: MCPAuthSection,
  tools: Schema.Array(MCPToolEntry).pipe(
    Schema.minItems(1),
    Schema.maxItems(20),
  ),
});

export type MCPManifest = Schema.Schema.Type<typeof MCPManifest>;

/**
 * Validates the supplied manifest object. Returns the decoded shape on
 * success; throws ParseError otherwise. Designed for compile-time-loaded
 * manifest.json + runtime validation in gateways.
 */
export const validateMCPManifest = (raw: unknown): MCPManifest =>
  Schema.decodeUnknownSync(MCPManifest)(raw);
