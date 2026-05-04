/**
 * BadgeShowcase.test.tsx — compound component pattern smoke test.
 *
 * Per SDD §6.1 + §6.2 BadgeShowcase.Item slot pattern.
 */

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BadgeShowcase } from "../src/BadgeShowcase.js";
import type { BadgeArtifact } from "../src/types.js";

const artifactA: BadgeArtifact = {
  artifact_id: "art-01",
  badge_spec: {
    slug: "first-mark",
    display_name: "First Mark",
    description: "First mark by the fire.",
  },
  image_uri: "https://example.invalid/badge-a.png",
  issued_at: "2026-05-04T00:00:00Z",
};

const artifactB: BadgeArtifact = {
  artifact_id: "art-02",
  badge_spec: {
    slug: "second-trace",
    display_name: "Second Trace",
    description: "Second mark on the steppe.",
  },
  image_uri: "https://example.invalid/badge-b.png",
  issued_at: "2026-05-04T01:00:00Z",
};

describe("BadgeShowcase", () => {
  it("renders root element without throwing", () => {
    const { container } = render(<BadgeShowcase />);
    expect(
      container.querySelector("[data-component='BadgeShowcase']"),
    ).not.toBeNull();
  });

  it("supports compound component pattern with Item children", () => {
    const { container } = render(
      <BadgeShowcase>
        <BadgeShowcase.Item artifact={artifactA} />
        <BadgeShowcase.Item artifact={artifactB} />
      </BadgeShowcase>,
    );
    const items = container.querySelectorAll(
      "[data-component='BadgeShowcaseItem']",
    );
    expect(items.length).toBe(2);
    expect(container.textContent).toContain("First Mark");
    expect(container.textContent).toContain("Second Trace");
  });

  it("accepts Image slot override on Item", () => {
    const { container } = render(
      <BadgeShowcase>
        <BadgeShowcase.Item
          artifact={artifactA}
          Image={({ artifact }) => (
            <span data-test="custom-image">{artifact.artifact_id}</span>
          )}
        />
      </BadgeShowcase>,
    );
    expect(container.querySelector("[data-test='custom-image']")).not.toBeNull();
  });

  it("passes className through without injecting a default", () => {
    const { container } = render(
      <BadgeShowcase className="consumer-grid">
        <BadgeShowcase.Item artifact={artifactA} className="consumer-tile" />
      </BadgeShowcase>,
    );
    const root = container.querySelector("[data-component='BadgeShowcase']");
    const item = container.querySelector(
      "[data-component='BadgeShowcaseItem']",
    );
    expect(root?.getAttribute("class")).toBe("consumer-grid");
    expect(item?.getAttribute("class")).toBe("consumer-tile");
  });
});
