import type { Metadata } from "next";
import { publicSite } from "@/lib/api/public-site";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Nothing, PageBanner, Section } from "../_components/ui";

/**
 * The teacher & staff directory. The API never sends a phone number or
 * an email for a teacher (roadmap §6) — the privacy rule lives in the
 * backend's SELECT list, so there is nothing to filter out here.
 */
// Literal, not the imported constant: Next requires this value to be
// statically analyzable (it matches `SITE_REVALIDATE` in lib/api).
export const revalidate = 60;

export const metadata: Metadata = {
  title: "Teachers & staff",
  description: "Meet the teachers and staff of the school.",
  alternates: { canonical: "/teachers" },
};

const DESIGNATION_LABELS: Record<string, string> = {
  HEAD_TEACHER: "Head Teacher",
  ASSISTANT_HEAD_TEACHER: "Assistant Head Teacher",
  SENIOR_TEACHER: "Senior Teacher",
  ASSISTANT_TEACHER: "Assistant Teacher",
  JUNIOR_TEACHER: "Junior Teacher",
  LECTURER: "Lecturer",
  INSTRUCTOR: "Instructor",
  DEMONSTRATOR: "Demonstrator",
};

export default async function TeachersPage() {
  const teachers = await publicSite.teachers();

  return (
    <>
      <PageBanner
        title="Teachers & staff"
        subtitle="The people who run the school."
        breadcrumb="Teachers"
      />
      <Section>
        {!teachers || teachers.length === 0 ? (
          <Nothing>The directory is not published yet.</Nothing>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {teachers.map((teacher) => (
              <Card key={teacher.id}>
                <CardContent className="flex gap-4 p-5">
                  {teacher.photoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={teacher.photoUrl}
                      alt=""
                      className="h-20 w-20 shrink-0 rounded-lg object-cover"
                    />
                  ) : (
                    <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-lg bg-muted text-xl font-medium text-muted-foreground">
                      {teacher.name.slice(0, 1)}
                    </div>
                  )}
                  <div className="min-w-0">
                    <h2 className="font-medium">{teacher.name}</h2>
                    <p className="text-sm text-muted-foreground">
                      {DESIGNATION_LABELS[teacher.designation] ??
                        teacher.designation}
                    </p>
                    {teacher.qualifications.length > 0 ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {teacher.qualifications[0]}
                      </p>
                    ) : null}
                    {teacher.subjects.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {teacher.subjects.slice(0, 3).map((subject) => (
                          <Badge key={subject} variant="outline">
                            {subject}
                          </Badge>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </Section>
    </>
  );
}
