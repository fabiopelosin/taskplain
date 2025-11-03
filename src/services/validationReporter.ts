import os from "node:os";

import type { TaskDoc } from "../domain/types";
import { runWithConcurrency } from "../utils/concurrency";
import type { TaskService } from "./taskService";
import type { ValidationError, ValidationService, ValidationWarning } from "./validationService";

export interface ValidationCollection {
  docs: TaskDoc[];
  errors: ValidationError[];
  parseErrors: ValidationError[];
  filesChecked: number;
  warnings: ValidationWarning[];
}

export type ValidationStage = "parse" | "document" | "collection";

export interface ValidationStreamEvent {
  stage: ValidationStage;
  file: string;
  index: number;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  ok: boolean;
}

export interface CollectValidationOptions {
  maxConcurrency?: number;
  minParallelFiles?: number;
  onEvent?: (event: ValidationStreamEvent) => void;
}

export async function collectValidationIssues(
  taskService: TaskService,
  validator: ValidationService,
  options: CollectValidationOptions = {},
): Promise<ValidationCollection> {
  const files = await taskService.listAllTaskFiles();
  const filesChecked = files.length;
  const indexByFile = new Map<string, number>();
  files.forEach((file, index) => {
    indexByFile.set(file, index);
  });

  const cpuCount = Math.max(1, os.cpus().length);
  const requestedLimit = options.maxConcurrency ?? cpuCount;
  const minParallel = options.minParallelFiles ?? 25;
  const preliminaryLimit = Math.max(1, Math.floor(requestedLimit));
  const effectiveLimit =
    files.length < minParallel ? 1 : Math.min(preliminaryLimit, Math.max(1, files.length));

  const docsByIndex: (TaskDoc | undefined)[] = new Array(files.length);
  const docErrors: ValidationError[] = [];
  const parseErrors: ValidationError[] = [];
  const documentWarnings: ValidationWarning[] = [];

  const eventBuffer: (ValidationStreamEvent | undefined)[] = new Array(files.length);
  let nextEmitIndex = 0;

  const emit = (event: ValidationStreamEvent): void => {
    if (!options.onEvent) {
      return;
    }
    eventBuffer[event.index] = event;
    while (nextEmitIndex < eventBuffer.length) {
      const pending = eventBuffer[nextEmitIndex];
      if (!pending) {
        break;
      }
      options.onEvent(pending);
      eventBuffer[nextEmitIndex] = undefined;
      nextEmitIndex += 1;
    }
  };

  await runWithConcurrency(files, effectiveLimit, async (filePath, index) => {
    try {
      const doc = await taskService.getTask(filePath);
      docsByIndex[index] = doc;
      const result = validator.validate(doc);
      if (!result.ok) {
        docErrors.push(...result.errors);
      }
      if (result.warnings.length > 0) {
        documentWarnings.push(...result.warnings);
      }
      emit({
        stage: "document",
        file: filePath,
        index,
        errors: result.errors,
        warnings: result.warnings,
        ok: result.ok,
      });
    } catch (error) {
      const parseError: ValidationError = {
        code: "parse",
        message: (error as Error).message,
        file: filePath,
      };
      parseErrors.push(parseError);
      emit({
        stage: "parse",
        file: filePath,
        index,
        errors: [parseError],
        warnings: [],
        ok: false,
      });
    }
  });

  const docs: TaskDoc[] = [];
  for (const doc of docsByIndex) {
    if (doc) {
      docs.push(doc);
    }
  }

  const collectionErrors = validator.validateCrossDocument(docs);
  const groupedCollectionErrors = groupErrorsByFile(collectionErrors);

  if (options.onEvent && groupedCollectionErrors.size > 0) {
    for (const filePath of files) {
      const fileErrors = groupedCollectionErrors.get(filePath);
      if (!fileErrors || fileErrors.length === 0) {
        continue;
      }
      const index = indexByFile.get(filePath) ?? 0;
      options.onEvent({
        stage: "collection",
        file: filePath,
        index,
        errors: fileErrors,
        warnings: [],
        ok: false,
      });
    }
  }

  const errors = [...docErrors, ...collectionErrors];

  return {
    docs,
    errors,
    parseErrors,
    filesChecked,
    warnings: documentWarnings,
  };
}

export function groupErrorsByFile(errors: ValidationError[]): Map<string, ValidationError[]> {
  const grouped = new Map<string, ValidationError[]>();
  for (const error of errors) {
    const existing = grouped.get(error.file) ?? [];
    existing.push(error);
    grouped.set(error.file, existing);
  }
  return grouped;
}
