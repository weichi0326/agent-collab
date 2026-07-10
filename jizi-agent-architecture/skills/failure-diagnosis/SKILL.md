---
name: failure-diagnosis
description: Diagnose failed canvas nodes in the multi-agent app. Use when a node, tool call, model call, file read/write, Python service, or workflow run fails and the user wants a practical explanation and next step.
---

# Failure Diagnosis

Use this skill to explain failures without panic or guesswork.

## Workflow

1. Classify the failure: key/config, network, model capability, file/path, Python service, missing dependency, tool bug, prompt/input issue, or app bug.
2. Say the likely consequence in plain language.
3. Give the cheapest check first.
4. Separate user-fixable steps from developer fixes.
5. If the issue looks like missing tool capability, suggest a candidate tool only after explaining why.
6. If uncertain, say what evidence would decide it.

## Guardrails

- Do not pretend every failure needs a new tool.
- Do not advise risky system changes unless clearly necessary.
- For API keys, never repeat the full key.
- For model vision errors, suggest a vision-capable model or removing images from the input.
- For rate limits or quota, suggest waiting, changing provider, or checking billing.

## Output Template

```text
问题: ...
后果: ...
先试这个: ...
如果还不行: ...
是否值得修: ...
```
