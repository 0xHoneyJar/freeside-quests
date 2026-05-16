/**
 * @0xhoneyjar/freeside-activities-mcp-tools — MCP tool surface for the
 * activities substrate.
 *
 * Exposed:
 *   - manifest validator (T2.10)
 *   - bearer-token validator + jti replay tracker (T2.11)
 *   - rate limiter interface + in-memory dev impl (T2.12)
 *   - audit log sink interface + in-memory dev impl (T2.13)
 *   - cursor sign + verify pipeline (T2.14)
 *   - TIER-1 raffle threshold policy (T2.15)
 */

// Manifest
export {
  MCPAuthSection,
  MCPManifest,
  MCPToolEntry,
  validateMCPManifest,
} from "./manifest.js";

// Auth — bearer-token
export {
  acceptAllSignatureVerifier,
  makeInMemoryJTIReplayTracker,
  makeKeyProviderSignatureVerifier,
  PermissionDenied,
  ReplayDetected,
  TokenExpired,
  TokenNotYetValid,
  TokenSchemaInvalid,
  TokenSignatureInvalid,
  validateBearerToken,
  WorldScopeDenied,
  type BearerTokenError,
  type InMemoryJTIReplayTrackerConfig,
  type JTIReplayTracker,
  type SignatureVerifier,
  type ValidateInput,
  type ValidateSuccess,
  type ValidatorConfig,
} from "./auth/bearer-token.js";

// Auth — KeyProviderPort fixture (sprint-2 review C2 · IMP-005)
export {
  makeInMemoryKeyProvider,
  type InMemoryKeyProviderConfig,
} from "./auth/in-memory-key-provider.js";

// Auth — rate limit
export {
  makeInMemoryRateLimiter,
  RateLimitExceeded,
  type InMemoryRateLimiterConfig,
  type RateLimiter,
  type RateLimitResult,
} from "./auth/rate-limit.js";

// Auth — audit log
export {
  appendOnlyJsonlSinkSpec,
  makeInMemoryAuditLogSink,
  type AppendOnlyJsonlSinkSpec,
  type AuditLogRecord,
  type AuditLogSink,
  type InMemoryAuditLogConfig,
  type InMemoryAuditLogSinkHandle,
} from "./auth/audit-log.js";

// Pagination
export {
  decodeCursor,
  encodeCursor,
  makeInMemoryCursorSigner,
  paginatedResponse,
  signCursor,
  SigningKeyUnavailable,
  verifyCursor,
  type CursorPipelineError,
  type CursorSigner,
  type VerifyCursorConfig,
} from "./pagination/cursor.js";

// Raffle threshold
export {
  classifyRaffleTier,
  HIGH_VALUE_REWARD_CLASSES,
  isAboveTier1Threshold,
  RaffleTierViolation,
  TIER_1_REWARD_COUNT_THRESHOLD,
  type RaffleTier,
  type RaffleTierEval,
  type RewardClass,
} from "./raffle-threshold.js";
