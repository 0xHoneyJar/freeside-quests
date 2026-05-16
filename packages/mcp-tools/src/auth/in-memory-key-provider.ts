/**
 * In-memory KeyProviderPort (TEST FIXTURE · sprint-2 review C2).
 *
 * Implements the protocol's `KeyProviderPort` interface against a static
 * map of kid → KeyState. Lets tests exercise the rotation states
 * (active · grace · revoked) without standing up a real Vault / KMS.
 *
 * NOT for production. Worlds inject their own KeyProviderPort
 * (probably backed by JWKS discovery against the issuer's
 * `/.well-known/freeside-mcp-jwks` endpoint).
 */
import { Effect } from "effect";

import {
  type KeyProviderError,
  type KeyProviderPort,
  KeyProviderUnavailable,
  type KeyState,
  KeyExpired,
  KeyRevoked,
  KidNotFound,
} from "@0xhoneyjar/quests-protocol";

export interface InMemoryKeyProviderConfig {
  readonly keys: ReadonlyArray<KeyState>;
  readonly resolverId?: string;
  /** When supplied, every `resolveKey` call fails with KeyProviderUnavailable. */
  readonly forceUnavailable?: string;
  /**
   * If true, expired/revoked keys returned by their state become hard
   * failures (KeyExpired / KeyRevoked errors). If false, they're returned
   * as KeyState — useful for testing grace-window edge cases where the
   * caller wants to verify status separately. Default: true (fail closed).
   */
  readonly failClosedOnNonActive?: boolean;
}

export const makeInMemoryKeyProvider = (
  config: InMemoryKeyProviderConfig,
): KeyProviderPort => {
  const resolverId = config.resolverId ?? "in-memory:key-provider";
  const failClosed = config.failClosedOnNonActive ?? true;
  const byKid = new Map<string, KeyState>();
  for (const k of config.keys) byKid.set(k.kid, k);

  return {
    resolveKey: (kid: string) =>
      Effect.gen(function* () {
        if (config.forceUnavailable !== undefined) {
          return yield* Effect.fail(
            new KeyProviderUnavailable({
              resolver_id: resolverId,
              reason: config.forceUnavailable,
            }),
          );
        }
        const state = byKid.get(kid);
        if (state === undefined) {
          return yield* Effect.fail(new KidNotFound({ kid }));
        }
        if (failClosed) {
          if (state.state === "revoked") {
            return yield* Effect.fail(
              new KeyRevoked({ kid, revoked_at: state.state_since }),
            );
          }
          // Hard-expired check
          if (Date.parse(state.expires_at) <= Date.now()) {
            return yield* Effect.fail(
              new KeyExpired({ kid, expired_at: state.expires_at }),
            );
          }
        }
        return state;
      }) as Effect.Effect<KeyState, KeyProviderError>,

    listActiveKids: () =>
      Effect.succeed(
        Array.from(byKid.values()).filter(
          (k) => k.state === "active" || k.state === "grace",
        ) as ReadonlyArray<KeyState>,
      ),
  };
};
