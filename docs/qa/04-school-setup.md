# QA — Module 04: School Setup & Settings

In-browser QA results for this module. Environment, logins and gotchas live in
[`QA_RUNBOOK.md`](../../QA_RUNBOOK.md) at the repo root; defects live in
[`FINDINGS.md`](./FINDINGS.md); harness technique lives in
[`HARNESS.md`](./HARNESS.md).

Pairs with the completion doc [`docs/modules/04-school-setup.md`](../modules/04-school-setup.md).

| ID | Scenario | Result | Evidence |
|---|---|---|---|
| M04-01 | Profile edit round-trips Bangla + BD phone | ✅ | Saved `হেক্সস্কুল উচ্চ বিদ্যালয়` / principal `মোঃ আব্দুল করিম` / `01712345678`; all intact after a full reload |
| M04-02 | **Logo upload → renders in the sidebar** *(owed click-through)* | ✅ | Uploaded a 600×600 PNG; stored at `schools/<id>/<uuid>.png` in MinIO, served by signed URL (200 `image/png`), and **resized to exactly 512×512** as the spec requires. Renders in the sidebar header and persists across navigation. |
| M04-03 | General settings load with documented defaults | ✅ | 7 keys; `timezone=Asia/Dhaka`, `weekly_holidays=["FRIDAY"]`, the four id patterns |
| M04-04 | Secrets never returned in plaintext | ✅ | `sms.api_key` saved, comes back as the sentinel `__SECRET__`; the value appears nowhere in the page HTML; DB holds ciphertext |
| M04-04b | **Re-saving an untouched form does not overwrite the secret** | ✅ | Ciphertext byte-identical after a no-op save, and no row anywhere contains `__SECRET__` — the sentinel is correctly ignored on write |
| M04-05 | NCTB grade scale seeded exactly per spec | ✅ | A+ 80–100 (5), A 70–79 (4), A− 60–69 (3.5), B 50–59 (3), C 40–49 (2), D 33–39 (1), F 0–32 (0) |
| M04-06 | Overlapping grade range refused, leaving no trace | ✅ | Set A's max to 85 → **"A (…–85) overlaps A+ (80–…)"**, Save disabled; reverting to 79 clears it and re-enables Save |
