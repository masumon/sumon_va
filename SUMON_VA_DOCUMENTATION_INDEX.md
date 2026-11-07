# SUMON VA — Documentation index (2026-11-07)

The directive `COMPLETE SYSTEM UNDERSTANDING.md` §18 asks for 9 files. To save tokens and avoid duplicates (its §18 says "reuse existing documentation"), one new reference file was written and the other deliverables point to documents that already exist. Status words: **NEW** = written in this audit · **EXISTS** = earlier doc, still valid · **PARTIAL** = covers part of the request.

| # | Requested file | Where it really is | Status |
|---|---|---|---|
| 1 | `SUMON_VA_SYSTEM_KNOWLEDGE.md` | this repo root | NEW |
| 2 | `SUMON_VA_AGENT_MEMORY.md` | Claude's persistent memory (`MEMORY.md` index + project notes), the existing mechanism the directive §15 prefers | EXISTS (updated) |
| 3 | `SUMON_VA_USER_GUIDE.md` | `docs/BRAIN_DELIVERABLES.md` §11 (owner guide), `docs/PROJECT_CHARTER.md` §7 | PARTIAL (short; no full per-screen guide) |
| 4 | `SUMON_VA_SYSTEM_AUDIT_REPORT.md` | `docs/AUDIT_2026-11-06.md` + `SUMON_VA_SYSTEM_KNOWLEDGE.md` §11–§12 | EXISTS + NEW findings |
| 5 | `SUMON_VA_API_INVENTORY.md` | `SUMON_VA_SYSTEM_KNOWLEDGE.md` §7.3 (counts, auth, consumers, contract check) | PARTIAL (no per-route schema table) |
| 6 | `SUMON_VA_DATA_FLOW_MAP.md` | `SUMON_VA_SYSTEM_KNOWLEDGE.md` §2, §9; `docs/BRAIN_DELIVERABLES.md` §1 | PARTIAL |
| 7 | `SUMON_VA_ANDROID_BEHAVIOUR_AUDIT.md` | `SUMON_VA_SYSTEM_KNOWLEDGE.md` §5; `docs/AUDIT_2026-11-06.md` §6 | PARTIAL (code level only) |
| 8 | `SUMON_VA_ISSUES_AND_RISKS.md` | `SUMON_VA_SYSTEM_KNOWLEDGE.md` §12; `docs/AUDIT_2026-11-06.md` §10; `docs/REMAINING_WORK.md` | EXISTS + NEW |
| 9 | `SUMON_VA_DOCUMENTATION_INDEX.md` | this file | NEW |

## 18-domain work (2026-11-07)
`SUMON_VA_18_DOMAIN_DESIGN_COMPLIANCE.md` (matrix) · `SUMON_VA_18_DOMAIN_INTEGRATION_MAP.md` (workflows A–F) · `SUMON_VA_18_DOMAIN_IMPLEMENTATION_REPORT.md` (plan + changes + test report in one file).

## Other project documents
`docs/START_HERE.md` (entry) · `docs/HANDOFF.md` §0 (current state) · `docs/REMAINING_WORK.md` (the one ordered to-do list) · `docs/TRANSFER.md` (changelog, decisions) · `docs/PROJECT_RULES.md` (rules) · `docs/BRAIN_MASTER_PLAN.md` (plan, 18 domains) · `docs/BRAIN_TRACEABILITY.md` · `docs/BRAIN_ROLLOUT_PLAN.md` (device checklist) · `docs/BRAIN_DELIVERABLES.md` · `docs/AUDIT_2026-11-06.md` · `docs/PROJECT_CHARTER.md` · `docs/SERVER_SEPARATION_MASTER_PLAN.md` · `docs/ABO_*` (instructions for the ABO agent) · `DESIGN.md` · `CLAUDE.md` · `Brain_Prompt.md` (master directive v2.0) · `Brain_Prompt_Archive_2026-11-06.md` (older audit-only version).
