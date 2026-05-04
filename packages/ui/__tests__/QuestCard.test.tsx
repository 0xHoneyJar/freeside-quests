/**
 * QuestCard.test.tsx — renders without throw + accepts slots.
 *
 * Per SDD §6.1 ___tests__ shape. Per PRD D2 anti-pattern guard:
 *   - asserts default render path works
 *   - asserts slot overrides compose cleanly
 *   - does NOT assert any visual chrome (no className checks beyond pass-through)
 */

import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QuestCard } from "../src/QuestCard.js";
import type { Quest } from "../src/types.js";

const fixture: Quest = {
  quest_id: "q-01",
  slug: "hello-steppe",
  title: "Hello, steppe.",
  prompt: "Mark the fire so the next traveler can find it.",
  badge_spec: {
    slug: "first-mark",
    display_name: "First Mark",
    description: "You stood by the fire and made it visible.",
  },
};

describe("QuestCard", () => {
  it("renders without throwing using default slots", () => {
    const { container } = render(<QuestCard quest={fixture} />);
    expect(container.querySelector("[data-component='QuestCard']")).not.toBeNull();
    expect(container.textContent).toContain("Hello, steppe.");
    expect(container.textContent).toContain("First Mark");
  });

  it("accepts Title slot override", () => {
    const { container } = render(
      <QuestCard
        quest={fixture}
        Title={({ quest }) => <h1 data-test="custom-title">{quest.title}</h1>}
      />,
    );
    expect(container.querySelector("[data-test='custom-title']")).not.toBeNull();
  });

  it("propagates onAccept to Actions slot", () => {
    const onAccept = vi.fn();
    const { container } = render(
      <QuestCard quest={fixture} onAccept={onAccept} />,
    );
    const button = container.querySelector(
      "[data-action='accept']",
    ) as HTMLButtonElement | null;
    expect(button).not.toBeNull();
    button?.click();
    expect(onAccept).toHaveBeenCalledOnce();
  });

  it("passes className through without injecting a default", () => {
    const { container } = render(
      <QuestCard quest={fixture} className="consumer-skin" />,
    );
    const article = container.querySelector("[data-component='QuestCard']");
    expect(article?.getAttribute("class")).toBe("consumer-skin");
  });

  it("does NOT inject a class when className is omitted", () => {
    const { container } = render(<QuestCard quest={fixture} />);
    const article = container.querySelector("[data-component='QuestCard']");
    // Anti-pattern guard: no default class shipped.
    expect(article?.getAttribute("class")).toBeNull();
  });
});
