// Copyright 2024 Ahyve AI Inc.
// SPDX-License-Identifier: BUSL-1.1

/**
 * Apply Patch Helper Utilities
 *
 * This module provides utilities for implementing the apply_patch builtin tool.
 * It includes a harness interface for abstracting file system operations and
 * a helper function for executing patch operations.
 */

import {
  ApplyPatchCall,
  ApplyPatchResult,
  ApplyPatchOperation,
  ApplyPatchCreateFile,
  ApplyPatchUpdateFile,
  ApplyPatchDeleteFile,
} from "../builtin-tools";

// ============================================================================
// Harness Interface
// ============================================================================

/**
 * Harness interface for file system operations.
 * Implement this interface to provide your own file system abstraction.
 * This allows testing with mock file systems and using different file system backends.
 */
export interface ApplyPatchHarness {
  /**
   * Read a file's contents.
   * @param path The file path relative to the workspace root
   * @returns The file contents as a string
   * @throws Error if the file doesn't exist or can't be read
   */
  readFile(path: string): Promise<string>;

  /**
   * Write content to a file, creating it if it doesn't exist.
   * @param path The file path relative to the workspace root
   * @param content The content to write
   * @throws Error if the file can't be written
   */
  writeFile(path: string, content: string): Promise<void>;

  /**
   * Delete a file.
   * @param path The file path relative to the workspace root
   * @throws Error if the file can't be deleted
   */
  deleteFile(path: string): Promise<void>;

  /**
   * Check if a file exists.
   * @param path The file path relative to the workspace root
   * @returns true if the file exists
   */
  fileExists(path: string): Promise<boolean>;

  /**
   * Create a directory (and parent directories if needed).
   * @param path The directory path
   */
  mkdir?(path: string): Promise<void>;
}

// ============================================================================
// Node.js File System Harness
// ============================================================================

/**
 * Create a harness that uses Node.js fs module.
 * @param workspaceRoot The root directory for relative paths
 * @returns An ApplyPatchHarness implementation
 */
export function createNodeFsHarness(workspaceRoot: string): ApplyPatchHarness {
  // Dynamic import to avoid bundling issues in browser environments
  const fs = require("fs").promises;
  const path = require("path");

  const resolvePath = (filePath: string): string => {
    // Prevent path traversal attacks
    const resolved = path.resolve(workspaceRoot, filePath);
    if (!resolved.startsWith(path.resolve(workspaceRoot))) {
      throw new Error(`Path traversal detected: ${filePath}`);
    }
    return resolved;
  };

  return {
    async readFile(filePath: string): Promise<string> {
      const fullPath = resolvePath(filePath);
      return fs.readFile(fullPath, "utf-8");
    },

    async writeFile(filePath: string, content: string): Promise<void> {
      const fullPath = resolvePath(filePath);
      // Ensure directory exists
      const dir = path.dirname(fullPath);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(fullPath, content, "utf-8");
    },

    async deleteFile(filePath: string): Promise<void> {
      const fullPath = resolvePath(filePath);
      await fs.unlink(fullPath);
    },

    async fileExists(filePath: string): Promise<boolean> {
      const fullPath = resolvePath(filePath);
      try {
        await fs.access(fullPath);
        return true;
      } catch {
        return false;
      }
    },

    async mkdir(dirPath: string): Promise<void> {
      const fullPath = resolvePath(dirPath);
      await fs.mkdir(fullPath, { recursive: true });
    },
  };
}

// ============================================================================
// Unified Diff Parser
// ============================================================================

/**
 * A single hunk in a unified diff
 */
interface DiffHunk {
  /** Starting line in the original file (1-indexed) */
  oldStart: number;
  /** Number of lines in the original section */
  oldCount: number;
  /** Starting line in the new file (1-indexed) */
  newStart: number;
  /** Number of lines in the new section */
  newCount: number;
  /** The lines of the hunk (with +, -, or space prefix) */
  lines: string[];
}

/**
 * Parse a unified diff string into hunks
 */
export function parseDiff(diff: string): DiffHunk[] {
  const lines = diff.split("\n");
  const hunks: DiffHunk[] = [];
  let currentHunk: DiffHunk | null = null;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Skip file headers (---, +++)
    if (line.startsWith("---") || line.startsWith("+++")) {
      i++;
      continue;
    }

    // Parse hunk header: @@ -oldStart,oldCount +newStart,newCount @@
    const hunkMatch = line.match(
      /^@@\s*-(\d+)(?:,(\d+))?\s*\+(\d+)(?:,(\d+))?\s*@@/
    );
    if (hunkMatch) {
      if (currentHunk) {
        hunks.push(currentHunk);
      }
      currentHunk = {
        oldStart: parseInt(hunkMatch[1], 10),
        oldCount: hunkMatch[2] ? parseInt(hunkMatch[2], 10) : 1,
        newStart: parseInt(hunkMatch[3], 10),
        newCount: hunkMatch[4] ? parseInt(hunkMatch[4], 10) : 1,
        lines: [],
      };
      i++;
      continue;
    }

    // Collect hunk content
    if (currentHunk && (line.startsWith("+") || line.startsWith("-") || line.startsWith(" ") || line === "")) {
      // Handle the case where line is empty (context line with stripped space)
      currentHunk.lines.push(line === "" ? " " : line);
    }

    i++;
  }

  if (currentHunk) {
    hunks.push(currentHunk);
  }

  return hunks;
}

/**
 * Apply a unified diff to file content
 * @param original The original file content (empty string for new files)
 * @param diff The unified diff to apply
 * @returns The patched file content
 * @throws Error if the diff can't be applied
 */
export function applyDiff(original: string, diff: string): string {
  const hunks = parseDiff(diff);
  
  if (hunks.length === 0) {
    // No hunks - for create_file, the diff might just be the content
    // Strip any leading +
    const lines = diff.split("\n");
    const contentLines = lines
      .filter((l) => !l.startsWith("---") && !l.startsWith("+++"))
      .map((l) => (l.startsWith("+") ? l.slice(1) : l));
    return contentLines.join("\n");
  }

  const originalLines = original.split("\n");
  const resultLines: string[] = [];
  let originalIndex = 0;

  for (const hunk of hunks) {
    // Add unchanged lines before this hunk
    const hunkStartInOriginal = hunk.oldStart - 1; // Convert to 0-indexed
    while (originalIndex < hunkStartInOriginal) {
      resultLines.push(originalLines[originalIndex]);
      originalIndex++;
    }

    // Process hunk lines
    for (const line of hunk.lines) {
      if (line.startsWith("-")) {
        // Removed line - skip it in the original
        originalIndex++;
      } else if (line.startsWith("+")) {
        // Added line - add to result
        resultLines.push(line.slice(1));
      } else {
        // Context line - copy from original and advance
        resultLines.push(line.slice(1));
        originalIndex++;
      }
    }
  }

  // Add remaining lines from original
  while (originalIndex < originalLines.length) {
    resultLines.push(originalLines[originalIndex]);
    originalIndex++;
  }

  return resultLines.join("\n");
}

// ============================================================================
// Patch Execution
// ============================================================================

/**
 * Options for patch execution
 */
export interface ExecutePatchOptions {
  /** The harness to use for file operations */
  harness: ApplyPatchHarness;
  /** Whether to create backups before modifying files */
  createBackups?: boolean;
  /** Whether to do a dry run (don't actually modify files) */
  dryRun?: boolean;
  /** Callback for logging/progress */
  onProgress?: (message: string) => void;
}

/**
 * Execute an apply_patch call using the provided harness.
 * This is the main entry point for handling apply_patch tool calls.
 *
 * @param call The apply_patch call from the model
 * @param options Execution options including the harness
 * @returns The result to send back to the model
 *
 * @example
 * ```typescript
 * const harness = createNodeFsHarness("/path/to/workspace");
 * 
 * @handleBuiltinTool("apply_patch_call")
 * async handleApplyPatch(call: ApplyPatchCall): Promise<ApplyPatchResult> {
 *   return executeApplyPatch(call, { harness });
 * }
 * ```
 */
export async function executeApplyPatch(
  call: ApplyPatchCall,
  options: ExecutePatchOptions
): Promise<ApplyPatchResult> {
  const { harness, createBackups = false, dryRun = false, onProgress } = options;
  const { operation } = call;

  try {
    switch (operation.type) {
      case "create_file": {
        const createOp = operation as ApplyPatchCreateFile;
        onProgress?.(`Creating file: ${createOp.path}`);

        if (await harness.fileExists(createOp.path)) {
          throw new Error(`File already exists: ${createOp.path}`);
        }

        const content = applyDiff("", createOp.diff);
        if (!dryRun) {
          await harness.writeFile(createOp.path, content);
        }

        return {
          call_id: call.call_id,
          status: "completed",
          output: dryRun ? `[DRY RUN] Would create: ${createOp.path}` : `Created: ${createOp.path}`,
        };
      }

      case "update_file": {
        const updateOp = operation as ApplyPatchUpdateFile;
        onProgress?.(`Updating file: ${updateOp.path}`);

        if (!(await harness.fileExists(updateOp.path))) {
          throw new Error(`File not found: ${updateOp.path}`);
        }

        const original = await harness.readFile(updateOp.path);

        if (createBackups && !dryRun) {
          await harness.writeFile(`${updateOp.path}.bak`, original);
        }

        const updated = applyDiff(original, updateOp.diff);
        if (!dryRun) {
          await harness.writeFile(updateOp.path, updated);
        }

        return {
          call_id: call.call_id,
          status: "completed",
          output: dryRun ? `[DRY RUN] Would update: ${updateOp.path}` : `Updated: ${updateOp.path}`,
        };
      }

      case "delete_file": {
        const deleteOp = operation as ApplyPatchDeleteFile;
        onProgress?.(`Deleting file: ${deleteOp.path}`);

        if (!(await harness.fileExists(deleteOp.path))) {
          throw new Error(`File not found: ${deleteOp.path}`);
        }

        if (createBackups && !dryRun) {
          const content = await harness.readFile(deleteOp.path);
          await harness.writeFile(`${deleteOp.path}.bak`, content);
        }

        if (!dryRun) {
          await harness.deleteFile(deleteOp.path);
        }

        return {
          call_id: call.call_id,
          status: "completed",
          output: dryRun ? `[DRY RUN] Would delete: ${deleteOp.path}` : `Deleted: ${deleteOp.path}`,
        };
      }

      default:
        throw new Error(`Unknown operation type: ${(operation as any).type}`);
    }
  } catch (error: any) {
    return {
      call_id: call.call_id,
      status: "failed",
      output: `Error: ${error.message}`,
    };
  }
}

// ============================================================================
// Convenience Function for Agent Implementation
// ============================================================================

/**
 * Create a builtin tool handler for apply_patch using a harness.
 * This is a convenience function that creates a handler you can register.
 *
 * @param harness The harness to use for file operations
 * @param options Additional options
 * @returns A handler function for apply_patch_call
 *
 * @example
 * ```typescript
 * class MyAgent extends BaseAgent<...> {
 *   builtinTools = [BuiltinToolType.ApplyPatch];
 *   
 *   constructor(session: Session, options: MyOptions) {
 *     super(session, options);
 *     const harness = createNodeFsHarness(options.workspaceRoot);
 *     this.registerBuiltinToolHandler(
 *       "apply_patch_call",
 *       createApplyPatchHandler(harness)
 *     );
 *   }
 * }
 * ```
 */
export function createApplyPatchHandler(
  harness: ApplyPatchHarness,
  options?: Omit<ExecutePatchOptions, "harness">
): (call: ApplyPatchCall) => Promise<ApplyPatchResult> {
  return async (call: ApplyPatchCall) => {
    return executeApplyPatch(call, { harness, ...options });
  };
}

