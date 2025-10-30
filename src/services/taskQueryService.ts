import {
  type Ambiguity,
  type Executor,
  type Isolation,
  type Size,
  type State,
  stateOrder,
  type TaskDoc,
} from "../domain/types";
import { buildHierarchyIndex } from "./hierarchy";
import {
  buildRankingContext,
  compareTasks,
  getRootEpicId,
  isTaskReady,
  type TaskRankingContext,
} from "./taskRanking";

export interface TaskListFilters {
  state?: State;
  priority?: TaskDoc["meta"]["priority"];
  parent?: string;
  search?: string;
  label?: string;
  size?: Size[];
  ambiguity?: Ambiguity[];
  executor?: Executor[];
  isolation?: Isolation[];
  blocked?: boolean;
  openStatesOnly?: boolean;
}

export interface TaskListItem {
  id: string;
  title: string;
  kind: TaskDoc["meta"]["kind"];
  state: State;
  priority: TaskDoc["meta"]["priority"];
  size: Size;
  ambiguity: Ambiguity;
  executor: Executor;
  isolation: Isolation;
  parent?: string;
  assignees?: string[];
  labels?: string[];
  updated_at: string;
  last_activity_at?: string;
  path: string;
  blocked?: string;
}

export interface TaskTreeNode {
  id: string;
  title: string;
  kind: TaskDoc["meta"]["kind"];
  state: State;
  priority: TaskDoc["meta"]["priority"];
  blocked?: string;
  children: TaskTreeNode[];
}

export interface OpenTreeItem {
  id: string;
  kind: TaskDoc["meta"]["kind"];
  state: State;
  priority: TaskDoc["meta"]["priority"];
  title: string;
  path: string;
  updated_at: string;
  parent?: string;
  blocked?: string;
}

export interface OpenTreeStoryNode {
  story: OpenTreeItem;
  tasks: OpenTreeItem[];
}

export interface OpenTreeEpicNode {
  epic: OpenTreeItem;
  children: OpenTreeStoryNode[];
}

export interface OpenTreeStateGroup {
  state: State;
  by_epic: OpenTreeEpicNode[];
  ungrouped: {
    stories: OpenTreeItem[];
    tasks: OpenTreeItem[];
  };
}

const OPEN_STATES: State[] = ["idea", "ready", "in-progress"];
const OPEN_STATE_SET = new Set<State>(OPEN_STATES);

type StoryAccumulator = {
  story: TaskDoc;
  tasks: TaskDoc[];
};

type EpicAccumulator = {
  epic: TaskDoc;
  stories: Map<string, StoryAccumulator>;
};

type OpenTreeFilters = {
  priority?: TaskDoc["meta"]["priority"];
  label?: string;
  search?: string;
  readyOnly?: boolean;
};

export class TaskQueryService {
  private readonly byId = new Map<string, TaskDoc>();
  private readonly children = new Map<string, TaskDoc[]>();
  private readonly parentById = new Map<string, string | undefined>();
  private readonly rankingContext: TaskRankingContext;

  constructor(private readonly tasks: TaskDoc[]) {
    const { index } = buildHierarchyIndex(tasks);
    const rankingContext = buildRankingContext(tasks);

    for (const doc of tasks) {
      this.byId.set(doc.meta.id, doc);
      this.parentById.set(doc.meta.id, index.parentById.get(doc.meta.id));
    }

    for (const [parentId, childDocs] of index.childrenById) {
      this.children.set(parentId, childDocs.slice());
    }

    for (const doc of tasks) {
      const parentId = this.parentById.get(doc.meta.id);
      if (!parentId) {
        continue;
      }
      const list = this.children.get(parentId) ?? [];
      if (!list.some((child) => child.meta.id === doc.meta.id)) {
        list.push(doc);
        this.children.set(parentId, list);
      }
    }

    for (const [parentId, list] of this.children) {
      if (!index.orderIndex.has(parentId)) {
        list.sort((a, b) => compareTasks(a, b, rankingContext));
      }
    }

    this.rankingContext = rankingContext;
  }

  private buildMatcher(filters: TaskListFilters): (doc: TaskDoc) => boolean {
    const normalizedSearch = filters.search?.toLowerCase();
    const normalizedLabel = filters.label?.toLowerCase();
    const sizeFilter = filters.size ? new Set(filters.size) : null;
    const ambiguityFilter = filters.ambiguity ? new Set(filters.ambiguity) : null;
    const executorFilter = filters.executor ? new Set(filters.executor) : null;
    const isolationFilter = filters.isolation ? new Set(filters.isolation) : null;
    return (doc: TaskDoc) => {
      if (filters.openStatesOnly && !OPEN_STATE_SET.has(doc.meta.state)) return false;
      if (filters.state && doc.meta.state !== filters.state) return false;
      if (filters.priority && doc.meta.priority !== filters.priority) return false;
      const derivedParent = this.parentById.get(doc.meta.id);
      if (filters.parent && derivedParent !== filters.parent) return false;

      const isBlocked = typeof doc.meta.blocked === "string";
      if (filters.blocked === true && !isBlocked) return false;
      if (filters.blocked === false && isBlocked) return false;

      if (sizeFilter && !sizeFilter.has(doc.meta.size)) return false;
      if (ambiguityFilter && !ambiguityFilter.has(doc.meta.ambiguity)) return false;
      if (executorFilter && !executorFilter.has(doc.meta.executor)) return false;
      if (isolationFilter && !isolationFilter.has(doc.meta.isolation)) return false;

      if (normalizedLabel) {
        const labels = doc.meta.labels?.map((label) => label.toLowerCase()) ?? [];
        if (!labels.includes(normalizedLabel)) return false;
      }

      if (normalizedSearch) {
        const haystacks = [doc.meta.id, doc.meta.title, doc.body];
        if (!haystacks.some((value) => value.toLowerCase().includes(normalizedSearch))) {
          return false;
        }
      }

      return true;
    };
  }

  getTask(id: string): TaskDoc | undefined {
    return this.byId.get(id);
  }

  getAncestors(id: string, options: { includeSelf?: boolean } = {}): TaskDoc[] {
    const includeSelf = options.includeSelf === true;
    const current = this.byId.get(id);
    if (!current) {
      return [];
    }

    const chain: TaskDoc[] = [];
    const visited = new Set<string>();
    let cursorId = this.parentById.get(current.meta.id);

    while (cursorId) {
      if (visited.has(cursorId)) {
        break;
      }
      visited.add(cursorId);
      const parent = this.byId.get(cursorId);
      if (!parent) {
        break;
      }
      chain.push(parent);
      cursorId = this.parentById.get(parent.meta.id);
    }

    chain.reverse();
    if (includeSelf) {
      chain.push(current);
    }
    return chain;
  }

  getChildren(id: string): TaskDoc[] {
    const children = this.children.get(id);
    if (!children) {
      return [];
    }
    return children.slice();
  }

  list(filters: TaskListFilters = {}): TaskListItem[] {
    const docs: TaskDoc[] = [];
    const matches = this.buildMatcher(filters);
    for (const doc of this.tasks) {
      if (!matches(doc)) continue;
      docs.push(doc);
    }

    docs.sort((a, b) => {
      const stateDiff = stateOrder.indexOf(a.meta.state) - stateOrder.indexOf(b.meta.state);
      if (stateDiff !== 0) return stateDiff;
      return compareTasks(a, b, this.rankingContext);
    });

    return docs.map((doc) => this.toListItem(doc));
  }

  buildTree(rootId?: string): TaskTreeNode[] {
    if (rootId) {
      const root = this.byId.get(rootId);
      if (!root) {
        throw new Error(`Task with id '${rootId}' not found`);
      }
      return [this.buildNode(root)];
    }

    // collect top-level nodes (no parent)
    const roots = this.tasks.filter((task) => !this.parentById.get(task.meta.id));
    roots.sort((a, b) => a.meta.title.localeCompare(b.meta.title));
    return roots.map((task) => this.buildNode(task));
  }

  buildOpenTree(states: State[], filters: OpenTreeFilters = {}): OpenTreeStateGroup[] {
    const normalizedStates: State[] = [];
    const seen = new Set<State>();
    for (const state of states) {
      if (!OPEN_STATE_SET.has(state) || seen.has(state)) {
        continue;
      }
      seen.add(state);
      normalizedStates.push(state);
    }
    if (normalizedStates.length === 0) {
      normalizedStates.push(...OPEN_STATES);
    }

    const result: OpenTreeStateGroup[] = [];
    const stateSet = new Set<State>(normalizedStates);
    const hasFilters = Boolean(filters.priority || filters.label || filters.search);
    const selectedIds = new Set<string>();
    const readyOnly = filters.readyOnly === true;

    if (hasFilters) {
      const matcher = this.buildMatcher({
        priority: filters.priority,
        label: filters.label,
        search: filters.search,
      });
      for (const doc of this.tasks) {
        if (!stateSet.has(doc.meta.state)) continue;
        if (readyOnly && !isTaskReady(doc, this.rankingContext).ready) continue;
        if (!matcher(doc)) continue;
        let current: TaskDoc | undefined = doc;
        while (current && stateSet.has(current.meta.state)) {
          if (!selectedIds.has(current.meta.id)) {
            selectedIds.add(current.meta.id);
          }
          const parentId = this.parentById.get(current.meta.id);
          current = parentId ? this.byId.get(parentId) : undefined;
        }
      }
    }

    for (const state of normalizedStates) {
      const docsInState = this.tasks.filter((doc) => {
        if (doc.meta.state !== state) {
          return false;
        }
        if (readyOnly && !isTaskReady(doc, this.rankingContext).ready) {
          return false;
        }
        if (!hasFilters) {
          return true;
        }
        return selectedIds.has(doc.meta.id);
      });
      if (docsInState.length === 0) {
        continue;
      }

      const epicGroups = new Map<string, EpicAccumulator>();
      const ungroupedStories: TaskDoc[] = [];
      const ungroupedTasks: TaskDoc[] = [];
      let hasContent = false;

      const ensureEpicGroup = (epicDoc: TaskDoc): EpicAccumulator => {
        const existing = epicGroups.get(epicDoc.meta.id);
        if (existing) {
          if (existing.epic !== epicDoc && epicDoc.meta.state === state) {
            existing.epic = epicDoc;
          }
          return existing;
        }
        const accumulator: EpicAccumulator = {
          epic: epicDoc,
          stories: new Map<string, StoryAccumulator>(),
        };
        epicGroups.set(epicDoc.meta.id, accumulator);
        return accumulator;
      };

      for (const doc of docsInState) {
        if (doc.meta.kind !== "epic") {
          continue;
        }
        ensureEpicGroup(doc);
        hasContent = true;
      }

      for (const doc of docsInState) {
        if (doc.meta.kind !== "story") {
          continue;
        }
        const rootEpic = this.findRootEpic(doc);
        if (!rootEpic) {
          ungroupedStories.push(doc);
          hasContent = true;
          continue;
        }
        const epicGroup = ensureEpicGroup(rootEpic);
        const existing = epicGroup.stories.get(doc.meta.id);
        if (existing) {
          existing.story = doc;
        } else {
          epicGroup.stories.set(doc.meta.id, { story: doc, tasks: [] });
        }
        hasContent = true;
      }

      for (const doc of docsInState) {
        if (doc.meta.kind !== "task") {
          continue;
        }
        const parentId = this.parentById.get(doc.meta.id);
        if (!parentId) {
          ungroupedTasks.push(doc);
          hasContent = true;
          continue;
        }
        const story = this.byId.get(parentId);
        if (!story || story.meta.kind !== "story") {
          ungroupedTasks.push(doc);
          hasContent = true;
          continue;
        }
        const rootEpic = this.findRootEpic(story);
        if (!rootEpic) {
          ungroupedTasks.push(doc);
          hasContent = true;
          continue;
        }
        const epicGroup = ensureEpicGroup(rootEpic);
        const storyGroup = epicGroup.stories.get(story.meta.id);
        if (storyGroup) {
          storyGroup.story = story;
          storyGroup.tasks.push(doc);
        } else {
          epicGroup.stories.set(story.meta.id, { story, tasks: [doc] });
        }
        hasContent = true;
      }

      if (!hasContent) {
        continue;
      }

      const byEpic: OpenTreeEpicNode[] = Array.from(epicGroups.values())
        .filter((group) => group.epic)
        .sort((a, b) => compareTasks(a.epic, b.epic, this.rankingContext))
        .map((group) => {
          const children: OpenTreeStoryNode[] = Array.from(group.stories.values())
            .sort((a, b) => compareTasks(a.story, b.story, this.rankingContext))
            .map((entry) => ({
              story: this.toOpenTreeItem(entry.story),
              tasks: entry.tasks
                .slice()
                .sort((a, b) => compareTasks(a, b, this.rankingContext))
                .map((task) => this.toOpenTreeItem(task)),
            }));
          return {
            epic: this.toOpenTreeItem(group.epic),
            children,
          };
        });

      const ungroupedStoriesItems = ungroupedStories
        .slice()
        .sort((a, b) => compareTasks(a, b, this.rankingContext))
        .map((doc) => this.toOpenTreeItem(doc));
      const ungroupedTaskItems = ungroupedTasks
        .slice()
        .sort((a, b) => compareTasks(a, b, this.rankingContext))
        .map((doc) => this.toOpenTreeItem(doc));

      result.push({
        state,
        by_epic: byEpic,
        ungrouped: {
          stories: ungroupedStoriesItems,
          tasks: ungroupedTaskItems,
        },
      });
    }

    return result;
  }

  private buildNode(task: TaskDoc): TaskTreeNode {
    const children = this.children.get(task.meta.id) ?? [];
    return {
      id: task.meta.id,
      title: task.meta.title,
      kind: task.meta.kind,
      state: task.meta.state,
      priority: task.meta.priority,
      blocked: task.meta.blocked,
      children: children.map((child) => this.buildNode(child)),
    };
  }

  private toListItem(doc: TaskDoc): TaskListItem {
    return {
      id: doc.meta.id,
      title: doc.meta.title,
      kind: doc.meta.kind,
      state: doc.meta.state,
      priority: doc.meta.priority,
      size: doc.meta.size,
      ambiguity: doc.meta.ambiguity,
      executor: doc.meta.executor,
      isolation: doc.meta.isolation,
      parent: this.parentById.get(doc.meta.id),
      assignees: doc.meta.assignees,
      labels: doc.meta.labels,
      updated_at: doc.meta.updated_at,
      last_activity_at: doc.meta.last_activity_at,
      path: doc.path,
      blocked: doc.meta.blocked,
    };
  }

  private toOpenTreeItem(doc: TaskDoc): OpenTreeItem {
    const item: OpenTreeItem = {
      id: doc.meta.id,
      kind: doc.meta.kind,
      state: doc.meta.state,
      priority: doc.meta.priority,
      title: doc.meta.title,
      path: doc.path,
      updated_at: doc.meta.updated_at,
    };
    const parentId = this.parentById.get(doc.meta.id);
    if (parentId) {
      item.parent = parentId;
    }
    if (doc.meta.blocked !== undefined) {
      item.blocked = doc.meta.blocked;
    }
    return item;
  }

  private findRootEpic(doc: TaskDoc): TaskDoc | undefined {
    const rootId = getRootEpicId(doc.meta.id, this.rankingContext);
    return rootId ? this.byId.get(rootId) : undefined;
  }
}
