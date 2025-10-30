import { beforeEach, describe, expect, it, vi } from "vitest";

const git = vi.hoisted(() => {
  const raw = vi.fn();
  const status = vi.fn();
  const checkIsRepo = vi.fn();
  const revparse = vi.fn();
  const rm = vi.fn();
  const add = vi.fn();
  const commit = vi.fn();
  const factory = vi.fn(() => ({
    raw,
    status,
    checkIsRepo,
    revparse,
    rm,
    add,
    commit,
  }));
  return {
    raw,
    status,
    checkIsRepo,
    revparse,
    rm,
    add,
    commit,
    factory,
  };
});

vi.mock("simple-git", () => ({
  __esModule: true,
  default: git.factory,
}));

import { GitAdapter } from "../src/adapters/gitAdapter";

beforeEach(() => {
  git.raw.mockReset();
  git.status.mockReset();
  git.checkIsRepo.mockReset();
  git.revparse.mockReset();
  git.rm.mockReset();
  git.add.mockReset();
  git.commit.mockReset();
  git.factory.mockReset();
});

describe("GitAdapter.resolveRoot", () => {
  it("returns the repository root when git resolves successfully", async () => {
    git.revparse.mockResolvedValue("/repo/root");
    const adapter = new GitAdapter("/repo/root");
    await expect(adapter.resolveRoot()).resolves.toBe("/repo/root");
    expect(git.revparse).toHaveBeenCalledWith(["--show-toplevel"]);
  });

  it("throws a descriptive error when git fails", async () => {
    git.revparse.mockRejectedValue(new Error("no repo"));
    const adapter = new GitAdapter("/tmp/project");
    await expect(adapter.resolveRoot()).rejects.toThrow("Failed to resolve git repository root");
  });
});

describe("GitAdapter.isRepo", () => {
  it("passes through git checks", async () => {
    git.checkIsRepo.mockResolvedValue(true);
    const adapter = new GitAdapter("/repo");
    await expect(adapter.isRepo()).resolves.toBe(true);
  });

  it("returns false when git throws", async () => {
    git.checkIsRepo.mockRejectedValue(new Error("bad state"));
    const adapter = new GitAdapter("/repo");
    await expect(adapter.isRepo()).resolves.toBe(false);
  });
});

describe("GitAdapter.listChangedFiles", () => {
  it("normalizes file separators and collects renamed files", async () => {
    git.status.mockResolvedValue({
      files: [{ path: "tasks\\20-in-progress\\story.md" }],
      not_added: ["README.md"],
      conflicted: ["conflict.txt"],
      renamed: [{ from: "docs\\old.md", to: "docs\\new.md" }],
    });

    const adapter = new GitAdapter("/repo");
    const result = await adapter.listChangedFiles();
    const entries = Array.from(result).sort();
    expect(entries).toEqual([
      "README.md",
      "conflict.txt",
      "docs/new.md",
      "docs/old.md",
      "tasks/20-in-progress/story.md",
    ]);
  });
});
