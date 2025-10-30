import { type State, stateOrder } from "./types";

// Allow transitions between any states.
// Parent/child constraints and completion rules are enforced elsewhere.
export function canTransition(_current: State, _next: State): boolean {
  return true;
}

export function compareStateOrder(a: State, b: State): number {
  const indexA = stateOrder.indexOf(a);
  const indexB = stateOrder.indexOf(b);
  return indexA - indexB;
}
