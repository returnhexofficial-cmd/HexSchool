# MODULE_DEPENDENCIES.md — SMIS Module Dependency Graph

> Build order authority. A module may start only when every hard dependency is complete.
> **Legend:** solid arrow = hard dependency · `(soft)` = integration completed later via a defined hook.

## Dependency Graph (Mermaid)

```mermaid
graph TD
    M01[01 Project Setup] --> M02[02 Authentication]
    M02 --> M03[03 RBAC + Audit]
    M03 --> M04[04 School Setup]
    M04 --> M05[05 Academic Session]
    M05 --> M06[06 Academic Structure]
    M03 --> M07[07 Staff & Users]
    M04 --> M07
    M06 --> M07
    M07 --> M08[08 Teachers]
    M06 --> M08
    M07 --> M09[09 Students & Guardians]
    M06 --> M09
    M09 --> M10[10 Admission]
    M09 --> M11[11 Enrollment & Promotion]
    M06 --> M11
    M11 -. soft: enrollment backfill for ADMITTED .-> M10
    M11 --> M12[12 Attendance]
    M08 --> M12
    M09 --> M12
    M05 --> M12
    M13 -. period mode + period_id FK (done) .-> M12
    M13 -. conflict checker + periods/week (done) .-> M08
    M11 --> M13[13 Timetable]
    M08 --> M13
    M13 -. pattern only: clash engine + override tiers .-> M14[14 Examination]
    M04 --> M14
    M06 --> M14
    M11 --> M14
    M05 --> M14
    M14 --> M15[15 Marks & Results]
    M15 -. binds EXAM_RESULT_GATE .-> M14
    M16 -. binds EXAM_DUES_GATE .-> M14
    M11 --> M16[16 Fees & Payments]
    M09 --> M16
    M04 --> M17[17 Communication ✅]
    M09 --> M17
    M02 --> M17
    M12 -. absent SMS live via NotificationService .-> M17
    M15 -. result SMS live via NotificationService .-> M17
    M16 -. receipt SMS live via NotificationService .-> M17
    M10 -. status SMS live via NotificationService .-> M17
    M10 -. soft: gateway wiring .-> M16
    M15 --> M18[18 Portals & Dashboards ✅]
    M16 --> M18
    M17 --> M18
    M12 --> M18
    M13 --> M18
    M18 --> M19[19 Website CMS ✅]
    M10 --> M19
    M15 --> M19
    M05 -. is_public events consumed .-> M19
    M17 -. website-visible notices consumed .-> M19
    M19 -. portal Contact School files into the office inbox .-> M18
    M19 -. binds certificate verifier .-> M27
    M16 --> M20[20 Accounting ✅]
    M16 -. emits payment.success/refunded; M20 listens .-> M20
    M20 --> M21[21 HR & Payroll ✅]
    M08 --> M21
    M12 --> M21
    M21 -. supersedes teacher_leaves; binds hr.leave.approved .-> M08
    M21 -. staff leave now marks the register .-> M12
    M21 -. employee self-service panels .-> M18
    M18 --> M22[22 Assignments ✅]
    M08 --> M22
    M11 --> M22
    M17 --> M22
    M22 -. student/parent assignment panels .-> M18
    M09 --> M23[23 Library ✅]
    M07 --> M24[24 Inventory]
    M16 --> M25[25 Transport]
    M16 --> M26[26 Hostel]
    M15 --> M27[27 Documents & Certificates]
    M16 --> M27
    M19 --> M27
    M17 --> M28[28 Complaint/Visitor/Alumni]
    M19 --> M28
    M18 --> M29[29 Reports & Analytics v2]
    M20 --> M29
    M21 --> M29
    M29 --> M30[30 SysAdmin & Hardening]
    M30 --> M31[31 Multi-School SaaS]
    M31 --> M32[32 Future Expansion]
```

## Dependency Table

| Module | Hard depends on | Soft / completed-later hooks |
|---|---|---|
| 01 Project Setup | — | — |
| 02 Authentication | 01 | — |
| 03 RBAC + Audit | 02 | — |
| 04 School Setup | 03 | — |
| 05 Academic Session | 04 | — |
| 06 Academic Structure | 05 | — |
| 07 Staff & Users | 03, 04, 06 | Provides shared SequenceService consumed by 09/10/16/20 |
| 08 Teachers ✅ | 06, 07 | Timetable conflict hook **closed by 13** (`TIMETABLE_CONFLICT_CHECKER` now binds the real checker; `TimetableConflictCheck` gained `schoolId`) and workload finalized with `periodsPerWeek`. **Leave moved out in M21**: `teacher_leaves` and `teacher.leave.approved` are gone, replaced by the unified `leave_applications` and `hr.leave.approved`; `exit_date` was added to `teachers` there so payroll can prorate a leaver's final month. **M22 made `teacher_section_subjects` an authorization surface** — it is no longer only a scheduling record, it decides who may set and mark a section's homework, so a reassignment now moves teaching rights as well as duties. |
| 09 Students & Guardians ✅ | 06, 07 | Dues hard-block on status change (16); history tabs are filled — attendance by 12, results by 15. Adjusted the M02 user-uniqueness constraint to `(school_id, user_type, contact)` so a guardian can also be staff — login now checks every candidate account. |
| 10 Admission ✅ | 06, 09 | Enrollment backfill for ADMITTED students (11 — roadmap: run 11 before the first REAL admission cycle); online gateway wiring (16); publish merit to website (19). Implementation confirmed 11 is NOT a hard dep: conversion completes at ADMITTED via the exported `StudentsService`. AuthModule newly exports `OtpService` (public phone verify). |
| 11 Enrollment & Promotion ✅ | 06, 09 | Promotion auto-decisions from results (15); rollback guard blocks once attendance (12) **or marks (15)** exist — both live. Exports the canonical roster service (`getSectionStudents`/`getStudentCurrentEnrollment`) consumed by 12/14/16. Closed the M06 section delete-guard and the M09 section-scoped batch ID-card debts. The M10 ADMITTED backfill is served by the normal enroll flow (no dedicated endpoint). |
| 12 Attendance ✅ | 05, 08, 09, 11 | Absent SMS actually sends after 17. **Period mode is now live** — 13 added the `period_id` FK and `getCurrentPeriod`. Consumed the M08 `teacher.leave.approved` hook. Added `CalendarService.workingDays()` to M05 and exports `AttendanceReportsService` + the attendance repositories for 18/21 (**M21 consumes `StaffAttendancesRepository`**, and its listener now marks STAFF leave too, not only teachers'). Closed the M09 `attendance-history` debt and armed the M11 promotion rollback guard (extended to marks by M15). |
| 13 Timetable ✅ | 06, 08, 11 | **Closed the M08 `TIMETABLE_CONFLICT_CHECKER` hook** (the real `RoutineConflictChecker` is bound to the token) and finalized M08's periods/week workload stub; turned on M12 period-mode attendance. Exports `RoutineService` + `PeriodSlotsRepository` + `TimetableEntriesRepository` for 14 (exam routines reuse `period_slots`) and 18 (portal routines). Substitution-on-teacher-leave is deferred to the Phase 3 backlog. **Graph note:** the conflict checker lives in the timetable module but is *bound inside* TeacherModule over a re-provisioned repository — TimetableModule imports TeacherModule, so the reverse import would cycle. |
| 14 Examination ✅ | 04, 05, 06, 11 | **13 turned out to be a pattern dependency, not a data one** — exam sittings keep their own wall-clock `start_time`+`duration_min` rather than reusing `period_slots` (a 3-hour paper does not fit a 40-minute bell); what M13 supplied was the clash-engine technique (compare wall-clock minutes, never slot ids) and the two-tier override split. Declares two DI hooks bound to no-ops: **`EXAM_RESULT_GATE`** (15 binds it — done) and **`EXAM_DUES_GATE`** (16 binds it — done). **`EXAM_RESULT_GATE` is live since 15**; **`EXAM_DUES_GATE` is live since 16** (reads real dues; `exam.admit_card_block_dues` turning that into a hard block is a UI toggle). Extended M11 with `EnrollmentsRepository.findClassRoster()` — a paper is set per class, so its candidates span every section. Exports `ExamsService`/`ExamsRepository`/`ExamSubjectsRepository`/`ExamRoutineService` for 15 and 18. Delete guards on `exam_classes`/`exam_subjects` were slots until 15 created the marks table — **now armed**. |
| 15 Marks & Results ✅ | 14 | Result SMS becomes real with 17 (queued through the existing contract now); the public search **API is live**, 19 builds the page. **Binds `EXAM_RESULT_GATE` for real** — publication now refuses until results are processed and still describe the marks on file, which is a breaking change for any caller that walked an exam to PUBLISHED unprocessed. **Moved the grade-scale freeze from PUBLISH to the first processing run**, because results are computed before publication and were otherwise graded through a table that could still change. Armed five guards left as slots by earlier modules: M14 `exam_classes`/`exam_subjects` deletes, M06 subject removal, the M11 promotion rollback, and M09 `performance-history`. Publication visibility is the active `result_publications` row, **not** `exams.status` (the status machine cannot rewind past PUBLISHED). Exports `ResultsService`/`ResultsRepository`/`MarksRepository`/`ResultReportsService` for 18. |
| 16 Fees & Payments ✅ | 09, 11 | **Binds `EXAM_DUES_GATE` for real** via `LedgerService.outstandingFor` — M14's admit-card flow now reads live dues (turning that into a hard *block* vs a warning is a UI/policy toggle). Armed the **M09 status-change dues warning** (stub text → real `warnings` array) and completed the **M10 gateway wiring** it had deferred (`PaymentGatewayService.openSession` is the admission-fee online path). Invoicing keys on `enrollment_id`, is idempotent per `(enrollment, month)` and prorates a mid-month joiner; a fully-waived invoice is `PAID` from birth so the fine job never charges it; online money is SUCCESS only after a server-side `verify()` whose amount matches (`chk_payments_success_evidence`). Exports `LedgerService`/`InvoiceService`/`CollectionService`/`PaymentGatewayService` for 18 (portal payment view) and 20 (accounting auto-posting). Leaves for later: receipt/dues **SMS** (17), the **Rocket** adapter, and an automatic result-withhold-on-dues (`ResultsService.setWithheld` hook + `outstandingFor`). |
| 17 Communication ✅ | 02, 04, 09 | **`NotificationService.send()` is the single send entry point** — retro-wired the queued events from 10 (admission status), 12 (absent alert), 15 (result published) and 16 (fee receipt) off the raw queue onto the template pipeline, and made the M02 OTP/welcome raw jobs deliver for real (OTP-to-phone now real). The real BullMQ worker moved from QueuesModule into CommunicationModule (it needs the render/dispatch services). CommunicationModule is imported BY its producers and never the reverse (stateless re-provisions + a self-contained `AudienceRepository`), so the graph stays acyclic. Exports `NotificationService` for 18 (portal messages) and reuses `NotificationBell`. Defaulter-list audience deferred to 18 (fee data lives in FeeModule — resolving it here would cycle). |
| 18 Portals & Dashboards ✅ | 02–17, **19** | **Phase 1 capstone.** A pure aggregator (`PortalModule`, a leaf): portal reads are authorized by **ownership** (`OwnershipGuard` + `PortalResolverService`, IDOR-safe), not permissions. Admin/accountant dashboards cached in Redis; a `GET /reports` registry. **No new tables/migration.** Closed the M15/M16 **result-withhold-on-dues**, the M16 **portal Pay-Now**, and the M17 **dues-reminder blast**. Fixed two pre-existing cross-suite e2e flakes (attendance-on-Friday, Mailpit IPv6 `localhost`). **Completed 2026-07-28** with the §5 gaps its own backend had already exported but no UI consumed: Routine / Profile / Documents panels, report-card PDF, Pay Now + `/portal/payment`, parent SMS history + Contact School, teacher My Students + Leaves, and the four dashboard charts. That added **three import edges, all downward**: `TeacherModule` (now exports `TeacherLeavesService`), `StudentModule` (`StudentDocumentsService`), `ResultModule` (`ResultExportService`), plus **`WebsiteModule` (M19) for `ContactService`** — the portal contact form files into the M19 office inbox rather than a second one, so a *later* module is imported by an earlier one. That is safe precisely because both are leaves: nothing imports PortalModule, and WebsiteModule imports nothing that reaches back. `NotificationsRepository` is a stateless re-provision (CommunicationModule does not export it — the e2e run is what caught that). Contact-school → real **tickets** stays deferred to 28; **certificates** to 27. **M22 added a fifth import edge** (`AssignmentModule`) and six portal routes: the split is the usual one — AssignmentModule decides what a candidate may see and whether they may still submit, PortalModule answers only "which student is this account?". |
| 19 Website CMS ✅ | 04, 05, 10, 15, 17 | **Phase 2 opener.** Near-leaf like `PortalModule`: imports only SchoolModule / CommunicationModule / StorageModule, and nothing imports it back — the five feature modules whose data the site shows are deliberately *not* imported, because those reads are privacy-shaped and live in a narrow `PublicSiteRepository` (the M17 `AudienceRepository` / M18 `DashboardRepository` precedent). **Closed three hooks**: M05's `calendar_events.is_public` and M17's `notices.is_website_visible` finally have public readers, and M15's `@Public` result search finally has its page — which needed a picker M15 never shipped, so `GET /public/results/exams` was added there. Reuses M10's `RecaptchaService` (stateless re-provision) and M17's `NotificationService` for the contact-form / career-application alerts. **Leaves for 27:** `GET /public/verify/certificate` answers `{available:false, reason}` and `/verify/certificate` says so on the page — M27 replaces the body, binding into WebsiteModule the way M15 bound `EXAM_RESULT_GATE` into ExamModule. Also leaves: a media library (content images are pasted URLs today) and the Bangla toggle over the `*_bn` columns the schema already carries. |
| 20 Accounting ✅ | 16 | **The integration runs on events, one way.** `FeeModule` *emits* `payment.success` / `payment.refunded` (`fee/events/fee.events.ts`); `AccountingModule` *listens* — the M08 `teacher.leave.approved` → M12 pattern. Fees never learns the ledger exists, so a school with `accounting.enabled` off loses nothing. That one-way edge is exactly what lets AccountingModule **import** FeeModule for the invoice reads a voucher needs without a cycle. Auto-posting is idempotent on `vouchers.source_ref` (`payment:<id>`, partial unique), so a replayed event, a reconciliation sweep and a duplicated callback land ONE voucher. Exports `VoucherService` (`postAuto` — the door 21/24/25/26/28 post through with their own `VoucherSource`), `PostingMapService` and `AccountingReportsService`; `PostingMapKind` is append-only so a later module registers mappings without a migration. The seeded 61-account chart already carries `2110 Salary Payable`, `5100 Salary & Allowances`, `5110 Festival Bonus` and `2120 Provident Fund Payable` for 21. Its eight reports are registered in the M18 hub. Closed the M03 note in the seeded Accountant role ("Accounting vouchers arrive with Module 20"). |
| 21 HR & Payroll ✅ | 07, 08, 12, 20 | **Closed the M08 leave debt for real**: `teacher_leaves` was copied into the polymorphic `leave_applications` and **dropped**, together with `leave_type_enum`, `/teacher-leaves` and the `teacher.leave.approved` event. Leave now hangs off a `leave_types` ROW with a quota, counts **working** days, decrements a per-session balance, and covers staff — so M12's listener (`hr.leave.approved`, carrying a `personType`) marks an office assistant's leave the same way it always marked a teacher's. Added `exit_date` to `teachers`/`staff_profiles`, because M07/M08 recorded a status change but never its date and payroll cannot prorate a leaver's final month without one. Posts to the ledger through M20's `VoucherService.postAuto` (source `PAYROLL`, idempotent on `payroll:<runId>`); the voucher is derived from four stored payslip columns and balances **by algebra**, so no splitting is needed. Appended six payroll slots to M20's append-only `SYSTEM_SLOTS`, all resolving to accounts the seeded chart already carries. Consumes M12's exported `StaffAttendancesRepository` and M05's `CalendarService.workingDays`. Exported `LeaveService`/`PayrollService`/`EmployeesRepository` for M18's portal panels — and `HrSettingsService`, which the e2e run caught missing. **Graph note:** HR imports Attendance/Accounting/Academic/Communication and nothing imports HR back except the leaf `PortalModule`; M12 consumes `hr.leave.approved` through a bare constants file, which is what keeps that edge one-way. |
| 22 Assignments ✅ | 08, 11, 17, 18 | **The dependency on 08 is the DUTY ROSTER, not teacher management**: `AssignmentPolicyService` reads `teacher_section_subjects` live at every request rather than trusting `assignments.teacher_id`, which is what delivers roadmap §8's "teacher reassigned → new teacher inherits evaluation rights" with no data migration. That query goes straight over PrismaService (TeacherModule does not export the repository), the M17 `AudienceRepository` / M18 `DashboardRepository` / M19 `PublicSiteRepository` precedent — so AssignmentModule imports Enrollment/Academic/Communication/School/Rbac/Storage and **not** TeacherModule. Submissions key on the `enrollment_id` M11's `getSectionStudents` / `getStudentCurrentEnrollment` return; publish/reminder/nudge all go through M17's `NotificationService.send`. Exports `StudentAssignmentsService` (+ the three feature services and `AssignmentUploadsService`) for M18's leaf `PortalModule`, which composes them into `/portal/assignments` — the only module that imports this one back. Reuses M19's `sanitizeHtml` as a pure engine import. Declares one DI hook bound to a no-op: **`ATTACHMENT_SCANNER`** (a ClamAV binding replaces the pass-through), the M08 `TIMETABLE_CONFLICT_CHECKER` convention. Leaves for 29: submission-rate analytics; for 32c: rubrics and peer assessment. |
| 23 Library ✅ | 08, 09 | **The dependency on 08/09 is the PEOPLE, not their modules.** A library card is polymorphic over `students`/`teachers`/`staff_profiles` with no FK, and resolving one to a name needs a single column from each — so `LibraryDirectoryRepository` reads all three over PrismaService (the M12 `EmployeeDirectoryRepository` / M17 `AudienceRepository` / M18 `DashboardRepository` / M19 `PublicSiteRepository` / M22 policy-query precedent) and LibraryModule imports none of them. **That is also what makes the M09 clearance hook possible at all**: `LibraryClearanceService` depends on PrismaService alone and is provided a *second time inside StudentModule*, bound to the `LIBRARY_CLEARANCE` token — the M13 `RoutineConflictChecker` pattern. StudentModule importing LibraryModule would close a cycle (Library → Accounting → Fee → Student). The token is always bound, never conditional (the M08/M14 call-site rule). Imports Academic (`CalendarService.workingDays` — the holiday-aware fine), Communication (the overdue chase through `NotificationService.send`), Accounting (fine receipts through `VoucherService.postAuto`, source `LIBRARY`, idempotent on `library-fine:<issueId>`) and Sequence (gap-free accession + card numbers). Appended `LIBRARY` to M20's `voucher_source_enum` and `LIBRARY_FINE_INCOME` to its append-only `SYSTEM_SLOTS`, resolving to the seeded `4150 Library Fee Income`. Closed the **M03 Librarian role** (empty since M03 with a note pointing here) and registered four reports in M18's hub. Exports `OpacService` for M18's leaf `PortalModule` — the only module that imports this one back — and `LibraryClearanceService` for **27**, which aggregates it beside M16 dues and M26 hostel. Leaves for 24: books as inventory assets (informational — `1530 Books & Library Assets` is already seeded); for 29: reading-history analytics. |
| 24 Inventory | 07 | Purchase posting (20 optional) |
| 25 Transport | 09, 16 | Expense posting (20 optional) |
| 26 Hostel | 09, 16 | Deposit voucher (20 optional) |
| 27 Documents & Certificates | 09, 15, 16, 19 | Clearance aggregates 16/23/26 — **M23's half is ready**: `LibraryClearanceService.clearanceForPerson` returns `{cleared, booksOut, outstandingFine, details}` and LibraryModule exports it. **Replaces the M19 certificate-verification stub** (`/public/verify/certificate`, today `{available:false}`) |
| 28 Complaint / Visitor / Alumni | 07, 09, 17, 19 | Donation posting (20 optional); the public contact form (M19) is the front door a complaint ticket will hang off |
| 29 Reports & Analytics v2 | 18, 20, 21 (all Phase 1–2 data) | — |
| 30 SysAdmin & Hardening | all prior | — |
| 31 Multi-School SaaS | 30 | — |
| 32 Future Expansion | 30–31 baseline; per sub-project | — |

## Parallelization Opportunities (if a second developer joins)

- After 07: **08 (Teachers)** ∥ **09 (Students)**.
- After 11: **12 (Attendance)** ∥ **13 (Timetable)** ∥ **16 (Fees)**.
- After 18: ~~**19 (Website)** ∥ **20 (Accounting)** ∥ **21 (HR & Payroll)**~~ — all done. ~~**22**~~ ~~**23**~~ done; **24–28** are mutually independent and can run in any order; only **29** waits on 21 (and now also on 22 for submission analytics and 23 for reading history).

## Critical Path

`01 → 02 → 03 → 04 → 05 → 06 → 07 → 09 → 11 → 14 → 15 → 18` — protect this chain; everything else can flex around it.

*(Updated after M14: 13 is no longer on the critical path. It was scheduled before 14 on the assumption that exam scheduling would reuse `period_slots`; implementation showed sittings need their own wall-clock timing, so 13 contributed patterns rather than data and 14 could have run in parallel with it.)*

## Update Rule

When implementation reveals a new dependency (or removes one), update the Mermaid graph, the table row(s), and note the change in that module's completion document under **Links to related modules**.
