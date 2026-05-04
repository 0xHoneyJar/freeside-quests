/**
 * BadgeShowcase — badge artifact rendering, layout-only.
 *
 * Compound component pattern (per Radix / Headless UI shape):
 *   <BadgeShowcase>
 *     <BadgeShowcase.Item artifact={a} />
 *     <BadgeShowcase.Item artifact={b} />
 *   </BadgeShowcase>
 *
 * Per SDD §6.2 BadgeShowcase.Item slot pattern. Per PRD D2: ZERO CSS.
 */

import type { ComponentType, ReactNode } from "react";
import type { BadgeArtifact } from "./types.js";

export interface BadgeShowcaseProps {
  readonly className?: string;
  readonly children?: ReactNode;
}

export interface BadgeShowcaseItemProps {
  readonly artifact: BadgeArtifact;
  readonly className?: string;
  readonly Image?: ComponentType<{ readonly artifact: BadgeArtifact }>;
  readonly Caption?: ComponentType<{ readonly artifact: BadgeArtifact }>;
}

const DefaultImage: ComponentType<{ readonly artifact: BadgeArtifact }> = ({
  artifact,
}) => (
  <img
    src={artifact.image_uri}
    alt={artifact.badge_spec.display_name}
    data-slot="image"
  />
);

const DefaultCaption: ComponentType<{ readonly artifact: BadgeArtifact }> = ({
  artifact,
}) => <span data-slot="caption">{artifact.badge_spec.display_name}</span>;

const Item = ({
  artifact,
  className,
  Image = DefaultImage,
  Caption = DefaultCaption,
}: BadgeShowcaseItemProps): ReactNode => {
  const classProps = className === undefined ? {} : { className };
  return (
    <li {...classProps} data-component="BadgeShowcaseItem">
      <Image artifact={artifact} />
      <Caption artifact={artifact} />
    </li>
  );
};

const BadgeShowcaseRoot = ({
  className,
  children,
}: BadgeShowcaseProps): ReactNode => {
  const classProps = className === undefined ? {} : { className };
  return (
    <ul {...classProps} data-component="BadgeShowcase">
      {children}
    </ul>
  );
};

export const BadgeShowcase: typeof BadgeShowcaseRoot & {
  readonly Item: typeof Item;
} = Object.assign(BadgeShowcaseRoot, { Item });
