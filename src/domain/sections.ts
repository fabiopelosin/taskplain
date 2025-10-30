export const SECTION_ID_TO_HEADING = {
  overview: "## Overview",
  acceptance_criteria: "## Acceptance Criteria",
  delivery_plan: "## Technical Approach",
  post_implementation_insights: "## Post-Implementation Insights",
} as const;

export type SectionId = keyof typeof SECTION_ID_TO_HEADING;

export function resolveSectionHeading(id: SectionId): string {
  return SECTION_ID_TO_HEADING[id];
}

export function isSectionId(value: string): value is SectionId {
  return value in SECTION_ID_TO_HEADING;
}

export const orderedSectionIds: SectionId[] = Object.keys(SECTION_ID_TO_HEADING) as SectionId[];
