---
name: agent-config-writer
description: Write practical Agent configurations for the multi-agent app. Use when the user asks for Agent names, descriptions, system prompts, tool tags, output formats, or model choices.
---

# Agent Config Writer

Use this skill to create clear Agent definitions that users can paste into the app.

## Workflow

1. Clarify the Agent's single responsibility.
2. Choose a concise name.
3. Write a one-sentence description.
4. Write a system prompt that defines input, task, output, and boundaries.
5. Suggest tool tags only when the Agent truly needs them.
6. Suggest output format: markdown, docx, xlsx, or mindmap.
7. Suggest model capability needs: long context, vision, reasoning, or ordinary text.

## Prompt Rules

- Keep prompts task-focused, not theatrical.
- Include what to do when input is missing.
- Include output structure when the downstream node expects structure.
- Do not invent app field names. Use placeholders if unsure.

## Output Template

```text
名称: ...
描述: ...
工具标签: ...
输出格式: ...
模型需求: ...
系统提示词:
...
```
