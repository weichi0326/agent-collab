---
name: model-routing-advisor
description: Advise model/provider choices for the multi-agent app. Use when the user asks which LLM to use for long documents, images, reasoning, low cost, speed, or fallback routing.
---

# Model Routing Advisor

Use this skill to recommend model capabilities, not to guess unavailable configuration.

## Workflow

1. Identify task needs: text, long context, vision, reasoning, coding, speed, or low cost.
2. Match the need to capability tags instead of assuming a specific configured model exists.
3. If the app configuration is unknown, ask the user to check the model configuration center.
4. Explain tradeoffs in plain language.
5. For workflows, recommend where to use stronger models and where cheaper models are enough.

## Common Guidance

- Long requirement documents need long-context models.
- Screenshots, embedded Excel images, and visual references need vision-capable models.
- Planning, root-cause analysis, and code generation benefit from stronger reasoning models.
- Formatting or summarization can often use cheaper text models.

## Boundaries

- Do not invent which models the user has configured.
- Do not claim pricing or quotas are current unless verified.
- For failed keys, tell the user to regenerate/check the key in the provider console.
