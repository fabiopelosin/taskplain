import type { TaskDoc } from "../domain/types";

export interface HierarchyIndex {
  parentById: Map<string, string>;
  childrenById: Map<string, TaskDoc[]>;
  orderIndex: Map<string, Map<string, number>>;
}

export interface HierarchyIssues {
  missingChildren: Array<{ parentId: string; childId: string }>;
  duplicateChildren: Array<{ parentId: string; childId: string }>;
  legacyOnlyChildren: Array<{ parentId: string; childId: string }>;
  conflictingParents: Array<{
    childId: string;
    declaredParentId: string;
    legacyParentId: string;
  }>;
}

export interface HierarchyBuildResult {
  index: HierarchyIndex;
  issues: HierarchyIssues;
}

export function buildHierarchyIndex(tasks: TaskDoc[]): HierarchyBuildResult {
  const byId = new Map<string, TaskDoc>();
  for (const doc of tasks) {
    byId.set(doc.meta.id, doc);
  }

  const parentById = new Map<string, string>();
  const childrenById = new Map<string, TaskDoc[]>();
  const orderIndex = new Map<string, Map<string, number>>();

  const issues: HierarchyIssues = {
    missingChildren: [],
    duplicateChildren: [],
    legacyOnlyChildren: [],
    conflictingParents: [],
  };

  const legacyParentRefs = new Map<string, string>();
  for (const doc of tasks) {
    if (doc.meta.parent) {
      legacyParentRefs.set(doc.meta.id, doc.meta.parent);
    }
  }

  const parentsWithExplicitChildren = new Set<string>();

  for (const doc of tasks) {
    const children = doc.meta.children;
    if (!children || children.length === 0) {
      continue;
    }
    parentsWithExplicitChildren.add(doc.meta.id);

    const seen = new Set<string>();
    const orderedDocs: TaskDoc[] = [];
    const orderMap = new Map<string, number>();

    for (const childId of children) {
      if (seen.has(childId)) {
        issues.duplicateChildren.push({ parentId: doc.meta.id, childId });
        continue;
      }
      seen.add(childId);

      const childDoc = byId.get(childId);
      if (!childDoc) {
        issues.missingChildren.push({ parentId: doc.meta.id, childId });
        continue;
      }

      const legacyParentId = legacyParentRefs.get(childId);
      if (legacyParentId && legacyParentId !== doc.meta.id) {
        issues.conflictingParents.push({
          childId,
          declaredParentId: doc.meta.id,
          legacyParentId,
        });
      }

      parentById.set(childId, doc.meta.id);
      orderMap.set(childId, orderedDocs.length);
      orderedDocs.push(childDoc);
    }

    childrenById.set(doc.meta.id, orderedDocs);
    orderIndex.set(doc.meta.id, orderMap);
  }

  for (const doc of tasks) {
    const legacyParentId = legacyParentRefs.get(doc.meta.id);
    if (!legacyParentId) {
      continue;
    }

    if (!parentById.has(doc.meta.id)) {
      if (parentsWithExplicitChildren.has(legacyParentId)) {
        issues.legacyOnlyChildren.push({
          parentId: legacyParentId,
          childId: doc.meta.id,
        });
      }

      parentById.set(doc.meta.id, legacyParentId);
      const list = childrenById.get(legacyParentId) ?? [];
      if (!list.some((child) => child.meta.id === doc.meta.id)) {
        const parentDoc = byId.get(legacyParentId);
        if (parentDoc) {
          list.push(doc);
          childrenById.set(legacyParentId, list);
        }
      }
    } else {
      const declaredParentId = parentById.get(doc.meta.id);
      if (declaredParentId && declaredParentId !== legacyParentId) {
        issues.conflictingParents.push({
          childId: doc.meta.id,
          declaredParentId,
          legacyParentId,
        });
      }
    }
  }

  return {
    index: {
      parentById,
      childrenById,
      orderIndex,
    },
    issues,
  };
}
