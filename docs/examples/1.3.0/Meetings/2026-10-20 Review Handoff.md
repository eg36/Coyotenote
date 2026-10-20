---
date: 2026-10-20
attendees: [Mira, Sam]
decisions: 3
complete: true
tags: [showcase, meetings, diagrams]
---

# Review Handoff

A small sequence diagram keeps the conversation and its order together. Open Preview to render it.

```mermaid
sequenceDiagram
  participant Mira
  participant Sam
  Mira->>Sam: Share the field notebook
  Sam->>Mira: Confirm the sample count
  Mira->>Sam: Record the review date
  Sam-->>Mira: Ready for the next draft
```

## Decisions

1. Keep metadata alongside the note
2. Use local diagrams for repeatable processes
3. Save the source so the next person can edit it

Next: [[Projects/Trailhead Release Flow]] and [[Reference/Source Editing Practice]].