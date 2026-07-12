# Node Prompt Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace direct node system-prompt editing with the same local-file import and read-only collapsible preview used by Jizi personality configuration.

**Architecture:** Store the imported filename beside `systemPrompt` in `AgentNodeData`, preserve it through canvas export/import, and keep file validation/truncation rules in a small pure helper under `PropertiesPanel`. The property panel reuses the existing Jizi preview CSS classes and the shared text-file reader.

**Tech Stack:** React 19, TypeScript 6, Ant Design 6, Zustand 5, Vitest 4.

## Global Constraints

- Import-only editing; expanded preview is read-only.
- Accept `txt`, `md`, `csv`, `json`, `log`, `xml`, `yaml`, and `yml`.
- Truncate at exactly 14,000 characters and show a warning.
- Persist only the source filename, never the full path or file handle.
- Old nodes without a source filename show `早期手动编辑（无关联文件）`.
- Read-only snapshot nodes may preview but cannot import.
- Do not modify Jizi configuration, node execution, model calls, tool tags, or data-source behavior.

---

### Task 1: Prompt Import Metadata and Pure Rules

**Files:**
- Create: `app/src/components/PropertiesPanel/nodePromptImport.ts`
- Create: `app/src/components/PropertiesPanel/nodePromptImport.test.ts`
- Create: `app/src/lib/canvasTransfer.test.ts`
- Modify: `app/src/stores/canvas/types.ts`
- Modify: `app/src/lib/canvasTransfer.ts`

**Interfaces:**
- Produces: `NODE_PROMPT_CHAR_CAP`, `normalizeNodePromptText(text)`, `nodePromptSourceLabel(text, sourceName)`.
- Produces: optional `AgentNodeData.systemPromptSourceName` preserved by canvas export/import.

- [ ] **Step 1: Write failing helper and transfer tests**

```ts
import { describe, expect, it } from 'vitest';
import {
  NODE_PROMPT_CHAR_CAP,
  nodePromptSourceLabel,
  normalizeNodePromptText,
} from './nodePromptImport';

describe('node prompt import rules', () => {
  it('keeps short text unchanged', () => {
    expect(normalizeNodePromptText('角色说明')).toEqual({
      text: '角色说明',
      truncated: false,
    });
  });

  it('truncates long text to the Jizi prompt limit', () => {
    const result = normalizeNodePromptText('a'.repeat(NODE_PROMPT_CHAR_CAP + 5));
    expect(result.text).toHaveLength(14_000);
    expect(result.truncated).toBe(true);
  });

  it('labels imported and legacy prompt sources', () => {
    expect(nodePromptSourceLabel('内容', 'analyst.md')).toBe('analyst.md');
    expect(nodePromptSourceLabel('旧内容', undefined)).toBe(
      '早期手动编辑（无关联文件）',
    );
    expect(nodePromptSourceLabel('', undefined)).toBe('未导入');
  });
});
```

Add a canvas round-trip test:

```ts
it('preserves the node prompt source filename through export and import', () => {
  const envelope = buildCanvasExport({
    name: '测试画布',
    nodes: [{
      id: 'node-1',
      type: 'agent',
      position: { x: 0, y: 0 },
      data: {
        label: '分析师',
        systemPrompt: '核对需求',
        systemPromptSourceName: 'analyst.md',
      },
    }],
    edges: [],
  });

  const result = parseCanvasImport(JSON.stringify(envelope), []);
  expect(result.nodes[0].data.systemPromptSourceName).toBe('analyst.md');
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `cd app; npm.cmd test -- src/components/PropertiesPanel/nodePromptImport.test.ts src/lib/canvasTransfer.test.ts`

Expected: FAIL because the helper and metadata field do not exist.

- [ ] **Step 3: Implement the pure rules and metadata**

```ts
export const NODE_PROMPT_CHAR_CAP = 14_000;

export function normalizeNodePromptText(text: string): {
  text: string;
  truncated: boolean;
} {
  if (text.length <= NODE_PROMPT_CHAR_CAP) {
    return { text, truncated: false };
  }
  return { text: text.slice(0, NODE_PROMPT_CHAR_CAP), truncated: true };
}

export function nodePromptSourceLabel(
  text: string,
  sourceName: string | undefined,
): string {
  if (sourceName) return sourceName;
  return text ? '早期手动编辑（无关联文件）' : '未导入';
}
```

Add `systemPromptSourceName?: string` beside `systemPrompt` in `AgentNodeData` and the canvas export shape. Copy the field in `exportNodeData` and `parseCanvasImport` without reading any source file.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `cd app; npm.cmd test -- src/components/PropertiesPanel/nodePromptImport.test.ts src/lib/canvasTransfer.test.ts`

Expected: both test files pass.

### Task 2: Property Panel Import and Collapsible Preview

**Files:**
- Create: `app/src/components/PropertiesPanel/NodePromptImport.test.tsx`
- Modify: `app/src/components/PropertiesPanel.tsx`
- Modify: `app/src/App.css`

**Interfaces:**
- Consumes: `TEXT_EXTENSIONS`, `isTextFile`, `fileToText`, and Task 1 prompt helpers.
- Produces: import button, persisted source label, collapsed character count, and disabled expanded preview.

- [ ] **Step 1: Write the failing presentation contract**

Read `PropertiesPanel.tsx` as text and assert:

```ts
expect(source).toContain('node-prompt-import__controls');
expect(source).toContain('master-config-preview__toggle');
expect(source).toContain('展开系统提示词预览');
expect(source).toContain('systemPromptSourceName');
expect(source).not.toContain('placeholder="定义该节点的角色、任务与输出要求"');
```

- [ ] **Step 2: Run the presentation test and verify RED**

Run: `cd app; npm.cmd test -- src/components/PropertiesPanel/NodePromptImport.test.tsx`

Expected: FAIL because the direct editable textarea is still present.

- [ ] **Step 3: Replace the direct textarea**

Use a hidden file input with:

```tsx
accept={TEXT_EXTENSIONS.map((ext) => `.${ext}`).join(',')}
```

On selection:

```ts
if (!isTextFile(file)) {
  message.warning('请选择纯文本格式的文件(txt/md/csv/json/log/xml/yaml/yml)');
  return;
}
try {
  const normalized = normalizeNodePromptText(await fileToText(file));
  patch({
    systemPrompt: normalized.text,
    systemPromptSourceName: file.name,
  });
  if (normalized.truncated) {
    message.warning(`文件内容过长,已截断至 ${NODE_PROMPT_CHAR_CAP} 字`);
  }
} catch {
  message.error('读取文件失败');
}
```

Render the same control order as Jizi:

```tsx
<div className="node-prompt-import__controls">
  <Button
    icon={<InboxOutlined />}
    disabled={readOnly}
    onClick={() => promptFileInputRef.current?.click()}
  >
    选择文件导入
  </Button>
  <span>当前来源：{sourceLabel}</span>
</div>
<div className="master-config-preview">
  <button
    type="button"
    className="master-config-preview__toggle"
    onClick={() => setPromptPreviewOpen((open) => !open)}
  >
    {promptPreviewOpen ? <DownOutlined /> : <RightOutlined />}
    <span>
      {promptPreviewOpen ? '收起系统提示词预览' : '展开系统提示词预览'}
    </span>
    <em>{promptText.length.toLocaleString('en-US')} 字符</em>
  </button>
  {promptPreviewOpen ? (
    <Input.TextArea value={promptText} disabled autoSize={{ minRows: 6, maxRows: 14 }} />
  ) : (
    <div className="master-config-preview__summary">
      当前节点提示词已导入。预览默认收起，避免占用属性面板空间。
    </div>
  )}
</div>
```

Reset `promptPreviewOpen` to `false` when `node?.id` changes.

- [ ] **Step 4: Add the compact control-row style**

```css
.node-prompt-import__controls {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.node-prompt-import__controls span {
  min-width: 0;
  overflow: hidden;
  color: var(--pearl-text-secondary);
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

- [ ] **Step 5: Run focused and full verification**

Run: `cd app; npm.cmd test -- src/components/PropertiesPanel/NodePromptImport.test.tsx src/components/PropertiesPanel/nodePromptImport.test.ts src/lib/canvasTransfer.test.ts src/stores/canvasStore.test.ts; npm.cmd run lint; npm.cmd run build`

Expected: all focused tests pass, lint exits 0, and build exits 0.
