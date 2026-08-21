---
status: accepted
---

# Pi JSONL Session authority

Pi JSONL is the sole authority for Agent conversation history, including branches, compaction, usage, custom entries, and Extension state. Pictor persists only navigation metadata, Pi Session identity, and a rebuildable Session Projection; pre-authority Session data without matching Pi JSONL is archived as a read-only Legacy Session Import rather than silently flattened, discarded, or used to start a context-losing Run.
