# Milestone 5: human correction and stable reading

Recommended: Opus 5.5 / xhigh for state design; Sonnet / high for implementation.

```text
Implement nurse source review inside the staff workspace: original evidence, proposed field, reason for review, confirm/correct/unreadable actions. Enforce roles server-side. Append fact revisions and audit events rather than overwriting source data. Keep source verification separate from clinician review and resolution.

Implement encounter/section revisions, immutable brief snapshots and review events tied to exact revisions. When the doctor opens a brief, pin its body. New nonurgent information shows a change banner and explicit diff. New allergy or urgent concerns appear immediately in a separate attention strip without silently rewriting the pinned body. Mark only affected sections stale while preserving prior review history.

Gate: nurse correction persists across two contexts, new page-four allergy makes the correct section stale, unrelated section reviews remain valid, and concurrent writes reject a stale expected revision. Check database transactions and actual refresh/reconnect behavior. Do not claim this works based only on component state. Update HANDOFF.md.
```
