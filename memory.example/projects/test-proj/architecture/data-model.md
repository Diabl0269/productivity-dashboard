# Data Model

## Projects

```json
{
  "id": "test-proj",
  "name": "test proj",
  "parentId": null,
  "memorySlug": "test-proj",
  "docs": []
}
```

Sub-projects set `parentId` to the parent id and may override `memorySlug`.

## Tasks

- `projectId` links a ticket to a project or sub-project
- `parentId` (task field) nests tasks under epics
- `type`: `epic` | `task` | custom types from settings

## Documentation discovery

1. `memory/projects/{memorySlug}.md` → Overview
2. `memory/projects/{memorySlug}/**/*.{md,txt,json}` → nested tree
3. Extra paths from `project.docs[]`

Demo fallback: `memory.example/projects/` when gitignored `memory/` is empty.
