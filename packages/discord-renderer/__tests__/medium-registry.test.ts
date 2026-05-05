/**
 * medium-registry.test.ts — cycle R Sprint 3 acceptance.
 *
 * Verifies discord-renderer consumes @0xhoneyjar/medium-registry as the
 * typed source-of-truth for Discord interaction capabilities.
 *
 * Per SDD §5.7 + cycle R sprint 3 R3.5 + R3.6.
 */

import { describe, expect, it } from "vitest";
import {
  medium,
  hasCapability,
  DISCORD_INTERACTION_DESCRIPTOR,
} from "../src/index.js";

describe("discord-renderer · medium-registry consumption (cycle R sprint 3)", () => {
  it("re-exports DISCORD_INTERACTION_DESCRIPTOR from medium-registry", () => {
    expect(DISCORD_INTERACTION_DESCRIPTOR).toBeDefined();
    expect(DISCORD_INTERACTION_DESCRIPTOR._tag).toBe("discord-interaction");
  });

  it("medium === DISCORD_INTERACTION_DESCRIPTOR (interaction-context)", () => {
    expect(medium).toBe(DISCORD_INTERACTION_DESCRIPTOR);
    expect(medium._tag).toBe("discord-interaction");
  });

  it("medium has all capabilities the renderer relies on", () => {
    // The startup assertion in index.ts checks these on module load. This
    // test re-asserts at the unit level to lock the contract.
    expect(hasCapability(medium, "text")).toBe(true);
    expect(hasCapability(medium, "embed")).toBe(true);
    expect(hasCapability(medium, "attachment")).toBe(true);
    expect(hasCapability(medium, "customEmoji")).toBe(true);
    expect(hasCapability(medium, "sticker")).toBe(true);
    expect(hasCapability(medium, "slashCommand")).toBe(true);
    expect(hasCapability(medium, "modal")).toBe(true);
    expect(hasCapability(medium, "button")).toBe(true);
    expect(hasCapability(medium, "ephemeral")).toBe(true);
    expect(hasCapability(medium, "mention")).toBe(true);
    expect(hasCapability(medium, "thread")).toBe(true);
  });

  it("medium does NOT advertise Telegram-specific capabilities", () => {
    expect(hasCapability(medium, "stickerSet")).toBe(false);
    expect(hasCapability(medium, "inlineKeyboard")).toBe(false);
  });

  it("medium does NOT advertise CLI-specific capabilities", () => {
    expect(hasCapability(medium, "ansi")).toBe(false);
  });
});
