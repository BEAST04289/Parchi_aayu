# Milestone 1: one persisted encounter

Recommended coding model: Opus 5.5 / xhigh for the brief architecture pass; Sonnet 5.5 / high for ordinary implementation.

```text
Read CLAUDE.md and the product, architecture and UI specifications. Inspect existing code and preserve it. Implement the smallest working vertical slice: staff creates an encounter, patient enters a typed complaint, data persists, staff reads the attributed fact and opens its source. Use the included domain contracts as a starting point, translating them into validated runtime schemas. Do not implement all future features at once.

Build the patient route and staff workspace with the specified design tokens. Use a small, clearly labelled fixture dataset for layout. Implement session scoping and role-aware server actions, private source storage and migrations. Do not display clinical sample data as if it came from a live patient. No fake working buttons.

Gate: complete the flow in two independent browser contexts, refresh both, verify persistence and denial of access to another encounter. Show actual screenshots at phone and desktop widths. Run available build/type checks and the relevant integration check, fix failures and update docs/HANDOFF.md. Stop this milestone when the gate passes; state exactly which integrations remain fixtures.
```
