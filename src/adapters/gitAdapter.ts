import path from "node:path";

import simpleGit, { type SimpleGit } from "simple-git";

function toPosix(value: string): string {
  return value.replace(/\\/g, "/");
}

export class GitAdapter {
  private readonly git: SimpleGit;

  constructor(readonly cwd: string) {
    this.git = simpleGit({ baseDir: cwd });
  }

  async resolveRoot(): Promise<string> {
    try {
      return await this.git.revparse(["--show-toplevel"]);
    } catch (_error) {
      throw new Error("Failed to resolve git repository root");
    }
  }

  async isRepo(): Promise<boolean> {
    try {
      return await this.git.checkIsRepo();
    } catch (_error) {
      return false;
    }
  }

  async mv(source: string, destination: string): Promise<void> {
    await this.git.raw(["mv", source, destination]);
  }

  async rm(pathspec: string): Promise<void> {
    await this.git.rm([pathspec]);
  }

  async add(pathspec: string): Promise<void> {
    await this.git.add(pathspec);
  }

  async commit(message: string): Promise<void> {
    await this.git.commit(message);
  }

  async listChangedFiles(): Promise<Set<string>> {
    const status = await this.git.status();
    const changed = new Set<string>();
    const add = (value: string | undefined): void => {
      if (!value) {
        return;
      }
      changed.add(toPosix(path.normalize(value)));
    };

    for (const file of status.files) {
      add(file.path);
    }

    for (const file of status.not_added) {
      add(file);
    }

    for (const file of status.conflicted) {
      add(file);
    }

    for (const rename of status.renamed) {
      add(rename.from);
      add(rename.to);
    }

    return changed;
  }
}
