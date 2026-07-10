---
name: workflow-planner
description: Plan canvas workflows for the multi-agent desktop app. Use when the user wants to design, explain, or improve a canvas made of Agent nodes, tool nodes, gate nodes, and data flow connections.
---

# Workflow Planner

Use this skill to help users turn a vague goal into a runnable canvas workflow.

## Workflow

1. Restate the user's goal in plain language.
2. Identify the needed inputs: documents, spreadsheets, screenshots, URLs, or manual text.
3. Propose a small number of Agent nodes, each with one clear job.
4. Explain how data should flow between nodes.
5. Add gate nodes only when the workflow truly needs branching or fallback.
6. Name expected outputs for each important node.
7. Point out what the user must configure manually, such as model keys or file paths.

## Default Patterns

- Requirement document -> Requirement analyst -> Test case generator -> Bug report generator.
- Excel with comments/images -> Rich input reader -> Visual reasoning Agent -> Test case generator.
- Risky or uncertain step -> Main branch plus NOR fallback branch.
- Multiple alternative analyzers -> OR gate -> downstream summary Agent.

## Output Style

- Prefer a short ordered list.
- Use a table when comparing node choices.
- Do not claim the canvas already exists unless the app has confirmed creation.
- If information is missing, ask for the smallest useful missing detail.
