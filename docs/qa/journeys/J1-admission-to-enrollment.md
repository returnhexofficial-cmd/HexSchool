# Journey J1 — Admission → Enrollment

The chain `MODULE_DEPENDENCIES.md` calls the highest-risk seam in the product, driven
end to end in a real browser on 2026-08-18.

> Conversion is `StudentsService.create` in its own transaction *then* an application
> update — a crash between them leaves a SELECTED application with a student already
> created. There is deliberately **no backfill endpoint**: ADMITTED students surface in
> the `/enrollments/enrollable` picker.

## The run

| # | Step | Actor | Result |
|---|---|---|---|
| 1 | Verify phone by SMS OTP | anonymous | ✅ code read from the dev outbox (**F19**) |
| 2 | Apply — cycle, class, applicant, guardian | anonymous | ✅ Bangla throughout |
| 3 | Submit | anonymous | ✅ **`ADM-26-000001`**, draft cleared |
| 4 | Track by number + phone | anonymous | ✅ "Payment Pending", UNPAID BDT 500.00 |
| 5 | Record payment | admin | ✅ → `PAID · Submitted` |
| 6 | Mark Under Review | admin | ✅ reason captured, SMS queued |
| 7 | Close cycle | admin | ✅ warns that unpaid applications are cancelled |
| 8 | Generate merit list | admin | ✅ "1 selected, 0 waitlisted" |
| 9 | **Admit → create student** | admin | ✅ → `Admitted` |
| 10 | Enrollable picker | admin | ✅ the new student is listed, already-enrolled ones are not |
| 11 | Enroll into QA Class 6 §A | admin | ✅ "Enrolled 1 student(s)." |

## What the database says

The assertions that matter are the ones the UI cannot show.

**After step 9 — the two-transaction seam completed cleanly:**

| Check | Value |
|---|---|
| Student created | `HEX-202600001` — matches the seeded `student_id_pattern` `{SCHOOL_CODE}-{YYYY}{SEQ5}` |
| Bangla preserved | `তাহমিদ রহমান` |
| Guardian created **and linked** | `মোঃ ফরিদ রহমান`, FATHER, `is_primary = true` |
| Application | `ADMITTED` **and** `student_id IS NOT NULL` — both halves landed |
| Enrollments | **0** |

That last row is the point: admission does **not** auto-enrol. The student existed with
no enrollment until step 11 — exactly the documented design, and the reason the
enrollable picker exists instead of a backfill endpoint.

**After step 11:**

```
student_uid     roll_no  type  status   class         section
HEX-202600001   3        NEW   ACTIVE   QA Class 6    A
```

## Notification trail

The dev SMS outbox captured every transition to the applicant's number, which
double-checks that M17 dispatch fires at each state change:

```
Admission ADM-26-000001: Your application is submitted and under process…
Admission ADM-26-000001: Your application is now under review. QA review
Admission ADM-26-000001: Congratulations — you have been SELECTED for ad…
Admission ADM-26-000001: Admission confirmed. Welcome to the school! Stu…
```

## Verdict

**The seam holds.** No orphaned student, no unlinked application, no silent
auto-enrolment. Three fixture gaps (**F20**, **F22**) and one product defect (**F21**)
were found and fixed along the way; none of them was in the conversion itself.

Not yet covered: the crash-between-transactions case. It cannot be provoked from a
browser — it needs a fault injected between `StudentsService.create` and the application
update, which belongs in a backend e2e test.
