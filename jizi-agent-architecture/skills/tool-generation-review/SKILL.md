---
name: tool-generation-review
description: Generate and review custom Python tools for the multi-agent app. Use when built-in tools do not cover a task and the user wants a new tool, or when failure diagnosis suggests a missing tool/library.
---

# Tool Generation Review

Use this skill only for custom tool creation or review.

## Workflow

1. Confirm the built-in tools do not already cover the task.
2. Define the tool contract: name, input params, output result, dependencies, and error behavior.
3. Prefer a mature library over hand-written fragile parsing.
4. Generate the complete tool proposal metadata, not just Python code.
5. Generate code with a single top-level `async def execute(params)` entry point.
6. Avoid top-level side effects. Imports, constants, class/function definitions, and safe compiled regex are acceptable.
7. Show the complete code for review before installation.
8. Warn that installation writes code to disk, writes metadata into the tool registry, and may install dependencies.
9. Install only after explicit user confirmation.

## Generated Tool Metadata

When generating a new Python tool, always produce the full installable tool package. Do not output code alone.

The proposal must include:

- `name`: lowercase executable tool id, such as `api-tester`.
- `description`: Chinese user-facing summary shown in the tool library.
- `tags`: use the tool name itself as the only tag, such as `["api-tester"]`. Do not create category tags like `api`, `test`, or `http`.
- `dependencies`: pip packages required by the tool. Use `[]` when only the Python standard library is needed.
- `implementation`: `language`, `libraries`, and a short Chinese `note` explaining how the tool works.
- `capabilities`: 3-6 Chinese capability items. Each item must include `label` and `description`.
- `code`: complete Python module code with `async def execute(params)`.

After the user confirms installation, save the metadata together with the tool entry in `python/tools/custom/registry.json`, so the tool library can display generated tools like first-class tools instead of bare scripts.

Use capability descriptions to explain what the tool can actually do, what important params it accepts, and what useful result it returns.

Example capability style:

- `发送 HTTP 请求`: supports method, url, headers, query params, JSON/body, and timeout.
- `读取响应信息`: returns status code, response headers, parsed JSON/body, and elapsed time.
- `状态码断言`: compares the actual status code with `expected_status` and reports whether the API behaves as expected.

## Safety Rules

- Never hide code from the user.
- Never auto-install unreviewed generated code.
- Avoid file deletion, shell commands, network calls, or environment changes unless the tool's purpose absolutely requires them and the user confirms.
- Keep dependency lists short and specific.

## Review Checklist

- Does the tool name avoid conflicting with built-in tools?
- Are inputs validated?
- Does it return JSON-friendly data?
- Are errors readable?
- Are dependencies necessary?
- Is there any import-time side effect?
