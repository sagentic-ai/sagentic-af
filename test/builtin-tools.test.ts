// Copyright 2024 Ahyve AI Inc.
// SPDX-License-Identifier: BUSL-1.1

/**
 * Tests for builtin tools support
 */

import { describe, test, expect, beforeEach, jest } from "@jest/globals";
import {
  BuiltinToolType,
  ApplyPatchCall,
  ApplyPatchResult,
  WebSearchCall,
  FileSearchCall,
  CodeInterpreterCall,
  ComputerUseCall,
  createBuiltinToolSpec,
  isBuiltinToolCallType,
  requiresResponse,
  createUnhandledError,
  filterOutputItems,
  OutputFilterOptions,
} from "../src/builtin-tools";
import {
  ApplyPatchHarness,
  parseDiff,
  applyDiff,
  executeApplyPatch,
  createApplyPatchHandler,
} from "../src/builtin-tools/apply-patch";

// ============================================================================
// Type Tests
// ============================================================================

describe("Builtin Tool Types", () => {
  describe("BuiltinToolType enum", () => {
    test("contains all expected tool types", () => {
      expect(BuiltinToolType.ApplyPatch).toBe("apply_patch");
      expect(BuiltinToolType.WebSearch).toBe("web_search");
      expect(BuiltinToolType.WebSearchPreview).toBe("web_search_preview");
      expect(BuiltinToolType.FileSearch).toBe("file_search");
      expect(BuiltinToolType.CodeInterpreter).toBe("code_interpreter");
      expect(BuiltinToolType.ComputerUse).toBe("computer_use_preview");
    });
  });

  describe("isBuiltinToolCallType", () => {
    test("returns true for builtin tool call types", () => {
      expect(isBuiltinToolCallType("apply_patch_call")).toBe(true);
      expect(isBuiltinToolCallType("web_search_call")).toBe(true);
      expect(isBuiltinToolCallType("file_search_call")).toBe(true);
      expect(isBuiltinToolCallType("code_interpreter_call")).toBe(true);
      expect(isBuiltinToolCallType("computer_call")).toBe(true);
    });

    test("returns false for non-builtin types", () => {
      expect(isBuiltinToolCallType("function_call")).toBe(false);
      expect(isBuiltinToolCallType("message")).toBe(false);
      expect(isBuiltinToolCallType("random_type")).toBe(false);
    });
  });

  describe("requiresResponse", () => {
    test("returns true for apply_patch_call and computer_call", () => {
      expect(requiresResponse("apply_patch_call")).toBe(true);
      expect(requiresResponse("computer_call")).toBe(true);
    });

    test("returns false for server-side tools", () => {
      expect(requiresResponse("web_search_call")).toBe(false);
      expect(requiresResponse("file_search_call")).toBe(false);
      expect(requiresResponse("code_interpreter_call")).toBe(false);
    });
  });
});

// ============================================================================
// Tool Spec Tests
// ============================================================================

describe("createBuiltinToolSpec", () => {
  test("creates apply_patch spec", () => {
    const spec = createBuiltinToolSpec(BuiltinToolType.ApplyPatch);
    expect(spec).toEqual({ type: "apply_patch" });
  });

  test("creates web_search spec", () => {
    const spec = createBuiltinToolSpec(BuiltinToolType.WebSearch);
    expect(spec.type).toBe("web_search");
  });

  test("creates web_search_preview spec", () => {
    const spec = createBuiltinToolSpec(BuiltinToolType.WebSearchPreview);
    expect(spec.type).toBe("web_search_preview");
  });

  test("creates code_interpreter spec", () => {
    const spec = createBuiltinToolSpec(BuiltinToolType.CodeInterpreter);
    expect(spec.type).toBe("code_interpreter");
  });

  test("throws for file_search without vector_store_ids", () => {
    expect(() => createBuiltinToolSpec(BuiltinToolType.FileSearch)).toThrow(
      "file_search requires vector_store_ids"
    );
  });

  test("creates file_search spec with vector_store_ids", () => {
    const spec = createBuiltinToolSpec(BuiltinToolType.FileSearch, {
      vector_store_ids: ["vs_123"],
    } as any);
    expect(spec.type).toBe("file_search");
    expect((spec as any).vector_store_ids).toEqual(["vs_123"]);
  });

  test("throws for computer_use without required options", () => {
    expect(() => createBuiltinToolSpec(BuiltinToolType.ComputerUse)).toThrow(
      "computer_use requires display_width, display_height, and environment"
    );
  });

  test("creates computer_use spec with required options", () => {
    const spec = createBuiltinToolSpec(BuiltinToolType.ComputerUse, {
      display_width: 1920,
      display_height: 1080,
      environment: "linux",
    } as any);
    expect(spec.type).toBe("computer_use_preview");
    expect((spec as any).display_width).toBe(1920);
    expect((spec as any).display_height).toBe(1080);
    expect((spec as any).environment).toBe("linux");
  });
});

// ============================================================================
// Output Filtering Tests
// ============================================================================

describe("filterOutputItems", () => {
  const items = [
    { type: "apply_patch_call", id: "1" },
    { type: "web_search_call", id: "2" },
    { type: "file_search_call", id: "3" },
    { type: "function_call", id: "4" },
  ];

  test("returns all items when no filter", () => {
    expect(filterOutputItems(items)).toEqual(items);
    expect(filterOutputItems(items, undefined)).toEqual(items);
    expect(filterOutputItems(items, {})).toEqual(items);
  });

  test("excludes items by type", () => {
    const options: OutputFilterOptions = {
      excludeTypes: ["web_search_call", "file_search_call"],
    };
    const result = filterOutputItems(items, options);
    expect(result).toHaveLength(2);
    expect(result.map((i) => i.type)).toEqual(["apply_patch_call", "function_call"]);
  });

  test("applies custom filter function", () => {
    const options: OutputFilterOptions = {
      filter: (item) => item.id !== "2",
    };
    const result = filterOutputItems(items, options);
    expect(result).toHaveLength(3);
    expect(result.find((i) => i.id === "2")).toBeUndefined();
  });

  test("applies excludeTypes before custom filter", () => {
    const options: OutputFilterOptions = {
      excludeTypes: ["web_search_call"],
      filter: (item) => item.id !== "3",
    };
    const result = filterOutputItems(items, options);
    expect(result).toHaveLength(2);
    expect(result.map((i) => i.id)).toEqual(["1", "4"]);
  });
});

// ============================================================================
// Error Handling Tests
// ============================================================================

describe("createUnhandledError", () => {
  test("creates error for apply_patch_call", () => {
    const call: ApplyPatchCall = {
      id: "ap_123",
      call_id: "call_456",
      type: "apply_patch_call",
      operation: { type: "create_file", path: "test.txt", diff: "+hello" },
      status: "in_progress",
    };
    const result = createUnhandledError(call);
    expect(result).not.toBeNull();
    expect((result as ApplyPatchResult).call_id).toBe("call_456");
    expect((result as ApplyPatchResult).status).toBe("failed");
    expect((result as ApplyPatchResult).output).toContain("No handler registered");
  });

  test("returns null for web_search_call (no response needed)", () => {
    const call: WebSearchCall = {
      id: "ws_123",
      type: "web_search_call",
      status: "completed",
    };
    const result = createUnhandledError(call);
    expect(result).toBeNull();
  });
});

// ============================================================================
// Diff Parsing Tests
// ============================================================================

describe("parseDiff", () => {
  test("parses simple unified diff", () => {
    const diff = `--- a/file.txt
+++ b/file.txt
@@ -1,3 +1,3 @@
 line1
-line2
+modified line2
 line3`;
    const hunks = parseDiff(diff);
    expect(hunks).toHaveLength(1);
    expect(hunks[0].oldStart).toBe(1);
    expect(hunks[0].oldCount).toBe(3);
    expect(hunks[0].newStart).toBe(1);
    expect(hunks[0].newCount).toBe(3);
  });

  test("parses diff with multiple hunks", () => {
    const diff = `@@ -1,2 +1,3 @@
 line1
+new line
 line2
@@ -10,2 +11,2 @@
 line10
-line11
+modified line11`;
    const hunks = parseDiff(diff);
    expect(hunks).toHaveLength(2);
    expect(hunks[0].oldStart).toBe(1);
    expect(hunks[1].oldStart).toBe(10);
  });

  test("handles single line counts (omitted)", () => {
    const diff = `@@ -5 +5 @@
-old
+new`;
    const hunks = parseDiff(diff);
    expect(hunks).toHaveLength(1);
    expect(hunks[0].oldCount).toBe(1);
    expect(hunks[0].newCount).toBe(1);
  });
});

describe("applyDiff", () => {
  test("applies simple modification", () => {
    const original = "line1\nline2\nline3";
    const diff = `@@ -1,3 +1,3 @@
 line1
-line2
+modified line2
 line3`;
    const result = applyDiff(original, diff);
    expect(result).toBe("line1\nmodified line2\nline3");
  });

  test("applies addition", () => {
    const original = "line1\nline3";
    const diff = `@@ -1,2 +1,3 @@
 line1
+line2
 line3`;
    const result = applyDiff(original, diff);
    expect(result).toBe("line1\nline2\nline3");
  });

  test("applies deletion", () => {
    const original = "line1\nline2\nline3";
    const diff = `@@ -1,3 +1,2 @@
 line1
-line2
 line3`;
    const result = applyDiff(original, diff);
    expect(result).toBe("line1\nline3");
  });

  test("creates new file from diff", () => {
    const diff = `@@ -0,0 +1,3 @@
+line1
+line2
+line3`;
    const result = applyDiff("", diff);
    // The diff parser may add trailing newline from empty original
    expect(result.trim()).toBe("line1\nline2\nline3");
  });

  test("handles raw content for create_file", () => {
    const diff = `+line1
+line2
+line3`;
    const result = applyDiff("", diff);
    expect(result).toBe("line1\nline2\nline3");
  });
});

// ============================================================================
// executeApplyPatch Tests
// ============================================================================

describe("executeApplyPatch", () => {
  let mockHarness: jest.Mocked<ApplyPatchHarness>;
  let files: Map<string, string>;

  beforeEach(() => {
    files = new Map();
    mockHarness = {
      readFile: jest.fn((path: string) => {
        const content = files.get(path);
        if (content === undefined) {
          return Promise.reject(new Error(`File not found: ${path}`));
        }
        return Promise.resolve(content);
      }),
      writeFile: jest.fn((path: string, content: string) => {
        files.set(path, content);
        return Promise.resolve();
      }),
      deleteFile: jest.fn((path: string) => {
        if (!files.has(path)) {
          return Promise.reject(new Error(`File not found: ${path}`));
        }
        files.delete(path);
        return Promise.resolve();
      }),
      fileExists: jest.fn((path: string) => Promise.resolve(files.has(path))),
    };
  });

  test("creates a new file", async () => {
    const call: ApplyPatchCall = {
      id: "ap_1",
      call_id: "call_1",
      type: "apply_patch_call",
      operation: {
        type: "create_file",
        path: "new-file.txt",
        diff: "+hello world",
      },
      status: "in_progress",
    };

    const result = await executeApplyPatch(call, { harness: mockHarness });

    expect(result.status).toBe("completed");
    expect(result.call_id).toBe("call_1");
    expect(mockHarness.writeFile).toHaveBeenCalledWith("new-file.txt", "hello world");
    expect(files.get("new-file.txt")).toBe("hello world");
  });

  test("fails to create if file exists", async () => {
    files.set("existing.txt", "content");
    const call: ApplyPatchCall = {
      id: "ap_1",
      call_id: "call_1",
      type: "apply_patch_call",
      operation: {
        type: "create_file",
        path: "existing.txt",
        diff: "+new content",
      },
      status: "in_progress",
    };

    const result = await executeApplyPatch(call, { harness: mockHarness });

    expect(result.status).toBe("failed");
    expect(result.output).toContain("File already exists");
  });

  test("updates an existing file", async () => {
    files.set("file.txt", "line1\nold line\nline3");
    const call: ApplyPatchCall = {
      id: "ap_1",
      call_id: "call_1",
      type: "apply_patch_call",
      operation: {
        type: "update_file",
        path: "file.txt",
        diff: `@@ -1,3 +1,3 @@
 line1
-old line
+new line
 line3`,
      },
      status: "in_progress",
    };

    const result = await executeApplyPatch(call, { harness: mockHarness });

    expect(result.status).toBe("completed");
    expect(files.get("file.txt")).toBe("line1\nnew line\nline3");
  });

  test("fails to update non-existent file", async () => {
    const call: ApplyPatchCall = {
      id: "ap_1",
      call_id: "call_1",
      type: "apply_patch_call",
      operation: {
        type: "update_file",
        path: "missing.txt",
        diff: "@@ -1 +1 @@\n-old\n+new",
      },
      status: "in_progress",
    };

    const result = await executeApplyPatch(call, { harness: mockHarness });

    expect(result.status).toBe("failed");
    expect(result.output).toContain("File not found");
  });

  test("deletes an existing file", async () => {
    files.set("to-delete.txt", "content");
    const call: ApplyPatchCall = {
      id: "ap_1",
      call_id: "call_1",
      type: "apply_patch_call",
      operation: {
        type: "delete_file",
        path: "to-delete.txt",
      },
      status: "in_progress",
    };

    const result = await executeApplyPatch(call, { harness: mockHarness });

    expect(result.status).toBe("completed");
    expect(mockHarness.deleteFile).toHaveBeenCalledWith("to-delete.txt");
    expect(files.has("to-delete.txt")).toBe(false);
  });

  test("dry run doesn't modify files", async () => {
    const call: ApplyPatchCall = {
      id: "ap_1",
      call_id: "call_1",
      type: "apply_patch_call",
      operation: {
        type: "create_file",
        path: "new-file.txt",
        diff: "+hello",
      },
      status: "in_progress",
    };

    const result = await executeApplyPatch(call, {
      harness: mockHarness,
      dryRun: true,
    });

    expect(result.status).toBe("completed");
    expect(result.output).toContain("[DRY RUN]");
    expect(mockHarness.writeFile).not.toHaveBeenCalled();
  });
});

// ============================================================================
// createApplyPatchHandler Tests
// ============================================================================

describe("createApplyPatchHandler", () => {
  test("creates a working handler", async () => {
    const files = new Map<string, string>();
    const mockHarness: ApplyPatchHarness = {
      readFile: (path) => Promise.resolve(files.get(path) || ""),
      writeFile: (path, content) => {
        files.set(path, content);
        return Promise.resolve();
      },
      deleteFile: (path) => {
        files.delete(path);
        return Promise.resolve();
      },
      fileExists: (path) => Promise.resolve(files.has(path)),
    };

    const handler = createApplyPatchHandler(mockHarness);

    const call: ApplyPatchCall = {
      id: "ap_1",
      call_id: "call_1",
      type: "apply_patch_call",
      operation: {
        type: "create_file",
        path: "test.txt",
        diff: "+hello",
      },
      status: "in_progress",
    };

    const result = await handler(call);

    expect(result.status).toBe("completed");
    expect(files.get("test.txt")).toBe("hello");
  });
});

