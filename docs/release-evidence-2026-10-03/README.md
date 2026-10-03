# Combined test release evidence

Code revision validated: `ece7ba60f22de0d6a75ced1704d48c4265874e5a`, in the isolated `webcup24-int` worktree on 2026-10-03 at16:45 Europe/Paris. B ran the checks through its working execution environment; PM reviewed the logs and branch ancestry. Only ignored build output was changed; all test databases were disposable.

| Log | Result |
| --- | --- |
| build.log | PASS, Vite production build |
| smoke.log | PASS104/104 API/serving checks |
| world-physical.log | PASS20/20 built Node-served world checks with physical phone |
| world-flat.log | PASS15/15 built Node-served world checks with flat dialog |

The subsequent release acceptance commit changes only documentation/evidence. A's earlier unchanged portal/accessibility proof and B's matching movement/tram/phone-race proof are recorded in QA_A/QA_B and reused. Actual Hodifly deployment is a separate post-push check; local production-build results do not assert host acceptance. No claim of full Wave7 completion, real hardware performance, real assistive technology or mobile game support is made.
