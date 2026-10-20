---
owner: Field team
phase: Review
ready: false
tags: [showcase, project, diagrams]
---

# Trailhead Release Flow

Switch to **Preview** to see this workflow. In Write, the same block remains editable diagram source.

```mermaid
flowchart LR
  Capture[Capture a field note] --> Check{Details complete?}
  Check -->|Yes| Review[Review together]
  Check -->|No| Capture
  Review --> Publish[Prepare the next draft]
```

## Review priorities

- Keep the original notes readable
- Make one small change at a time
- Check the result before sharing

The handoff conversation is in [[Meetings/2026-10-20 Review Handoff]]. Sample metadata lives in [[Lab/Typed Properties Lab]].