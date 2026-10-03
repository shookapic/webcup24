# Combined correction release acceptance

2026-10-03 17:57 Europe/Paris. PM reviewed A's frozen Wave7/coverage through52468bd, B's963b08b correction and A's QA-only c79083a. Exact integrated candidate **b365f28d8d537a2def86b9fe76dd1aa5156ae1de** was validated by B with a clean tree before/after, disposable databases and no source/ref/commit changes. This evidence commit changes only PM records/logs over that candidate; application source is identical.

| Gate | Result |
|---|---|
| Production build | PASS |
| API smoke | PASS138/138 |
| Original-schema migration/idempotent boot | PASS10/10 |
| Physical phone, places/emergency, real clicks/focus/alerts | PASS22/22 |
| Flat accessible phone | PASS17/17 |

Saved logs are adjacent. A's unchanged portal/browser/accessibility proof through52468bd and B's unchanged movement/alert/race/tram/building proof through963b08b are reused: movement15 at60/30+jitter/144, alerts14, phone race12, tram22, building22. PM reviewed straight/end rendered captures in docs/qa-captures/after, including outward cabs and rail support, plus readable phone capture.

**Not claimed:** user's Firefox glyph-loss defect is not reproduced here; the new affine host is a mitigation pending user retest. Authenticated host flows, real notification popups/assistive technology, measured hardware performance and touch remain unverified. Vegetation/sidewalks/crossings, sitting NPCs, avatar variants and world service prompts remain required future work. Wave8 application work is excluded;50-request matrix remains34 local PASS,12 PARTIAL,4 NOT STARTED at this frozen milestone.

User already authorized a normal main push for testing. PM accepts this candidate for another user test release, not final contest acceptance. Normal exact-SHA push and GET-only live version/assets/CSP/places/audit access checks follow; deployment proof is recorded separately under coordination/reports.
