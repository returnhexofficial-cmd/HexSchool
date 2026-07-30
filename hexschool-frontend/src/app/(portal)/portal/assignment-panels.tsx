"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { LoadingBlock } from "@/components/shared/spinner";
import { StatCard } from "@/components/shared/stat-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { apiErrorMessage } from "@/lib/api/auth";
import {
  ASSIGNMENT_TYPE_LABELS,
  dueRelative,
  formatDue,
  humanBytes,
  MATERIAL_TYPE_LABELS,
  SUBMISSION_STATUS_LABELS,
  type Attachment,
  type LearningMaterial,
  type PortalAssignment,
  type PortalAssignmentList,
} from "@/lib/api/assignment";
import {
  fileIssue,
  SUBMISSION_STATUS_VARIANT,
} from "@/lib/validations/assignment";

const TABS = [
  ["PENDING", "To do"],
  ["SUBMITTED", "Submitted"],
  ["EVALUATED", "Marked"],
] as const;

type TabKey = (typeof TABS)[number][0];

const CLIENT_LIMITS = {
  maxBytes: 10 * 1024 * 1024,
  allowedTypes: ["pdf", "doc", "docx", "jpg", "jpeg", "png"] as const,
};

export interface AssignmentFetchers {
  /** Query-key discriminator: `self` or `child-<id>`. */
  key: string;
  list: (tab?: string) => Promise<PortalAssignmentList>;
  materials: () => Promise<LearningMaterial[]>;
  /** Absent for a parent — only the student may hand work in. */
  submit?: (
    assignmentId: string,
    input: { textAnswer?: string; attachments?: Attachment[] },
  ) => Promise<unknown>;
  upload?: (file: File) => Promise<Attachment & { url: string }>;
}

/**
 * The portal's assignments panel, shared by the student view and the
 * parent's per-child view (roadmap §5).
 *
 * The difference between them is one prop: a parent's fetchers carry no
 * `submit`, so the form is simply not rendered. The API refuses a parent
 * submission regardless — this is the UI agreeing with the server rather
 * than the UI being the rule.
 */
export function AssignmentPanels({
  fetchers,
  canSubmit,
}: {
  fetchers: AssignmentFetchers;
  canSubmit: boolean;
}) {
  const [tab, setTab] = useState<TabKey>("PENDING");

  const list = useQuery({
    queryKey: ["portal", "assignments", fetchers.key, tab],
    queryFn: () => fetchers.list(tab),
  });

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-medium">Assignments &amp; homework</h2>

      {list.data && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard title="To do" value={String(list.data.summary.pending)} />
          <StatCard
            title="Overdue"
            value={String(list.data.summary.overdue)}
            hint={list.data.summary.overdue > 0 ? "past the deadline" : undefined}
          />
          <StatCard
            title="Due soon"
            value={String(list.data.summary.dueSoon)}
            hint="next 48 hours"
          />
          <StatCard
            title="Marked"
            value={String(list.data.summary.evaluated)}
          />
        </div>
      )}

      <div className="flex flex-wrap gap-1 border-b">
        {TABS.map(([key, label]) => (
          <Button
            key={key}
            variant="ghost"
            size="sm"
            className={cn(
              "-mb-px rounded-b-none border-b-2 border-transparent",
              tab === key && "border-primary",
            )}
            onClick={() => setTab(key)}
          >
            {label}
          </Button>
        ))}
      </div>

      {list.isLoading ? (
        <LoadingBlock />
      ) : list.isError ? (
        <ErrorState onRetry={() => void list.refetch()} />
      ) : (list.data?.assignments.length ?? 0) === 0 ? (
        <EmptyState
          title={
            tab === "PENDING"
              ? "Nothing outstanding"
              : tab === "SUBMITTED"
                ? "Nothing waiting to be marked"
                : "Nothing marked yet"
          }
          description="Work your teachers set will appear here."
        />
      ) : (
        <div className="space-y-3">
          {(list.data?.assignments ?? []).map((a) => (
            <AssignmentCard
              key={a.id}
              assignment={a}
              fetchers={fetchers}
              canSubmit={canSubmit}
            />
          ))}
        </div>
      )}

      <MaterialsPanel fetchers={fetchers} />
    </section>
  );
}

function AssignmentCard({
  assignment,
  fetchers,
  canSubmit,
}: {
  assignment: PortalAssignment;
  fetchers: AssignmentFetchers;
  canSubmit: boolean;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(assignment.submission?.textAnswer ?? "");
  const [files, setFiles] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);

  const submit = useMutation({
    mutationFn: () =>
      fetchers.submit!(assignment.id, {
        textAnswer: text.trim() || undefined,
        attachments: files.length > 0 ? files : undefined,
      }),
    onSuccess: () => {
      toast.success("Handed in.");
      setFiles([]);
      void qc.invalidateQueries({
        queryKey: ["portal", "assignments", fetchers.key],
      });
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const onPickFile = async (file: File | undefined) => {
    if (!file || !fetchers.upload) return;
    const issue = fileIssue(file, CLIENT_LIMITS);
    if (issue) {
      toast.error(issue);
      return;
    }
    setUploading(true);
    try {
      const uploaded = await fetchers.upload(file);
      setFiles((prev) => [
        ...prev,
        {
          key: uploaded.key,
          name: uploaded.name,
          size: uploaded.size,
          contentType: uploaded.contentType,
        },
      ]);
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setUploading(false);
    }
  };

  const submission = assignment.submission;
  const nothingToSend = text.trim().length === 0 && files.length === 0;

  return (
    <div className="rounded-md border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{assignment.title}</span>
            <Badge variant="outline">
              {ASSIGNMENT_TYPE_LABELS[assignment.type]}
            </Badge>
            {submission && (
              <Badge variant={SUBMISSION_STATUS_VARIANT[submission.status]}>
                {SUBMISSION_STATUS_LABELS[submission.status]}
              </Badge>
            )}
            {assignment.overdue && (
              <Badge variant="destructive">Overdue</Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            {assignment.subject.name} · {assignment.teacher} · due{" "}
            {formatDue(assignment.dueAt)} ({dueRelative(assignment.dueAt)})
            {assignment.fullMarks && ` · out of ${assignment.fullMarks}`}
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={() => setOpen((v) => !v)}>
          {open ? "Hide" : "Open"}
        </Button>
      </div>

      {open && (
        <div className="mt-4 space-y-4 border-t pt-4">
          {assignment.instructions && (
            /* Sanitized on write by the backend, so this is safe to render. */
            <div
              className="prose prose-sm max-w-none dark:prose-invert"
              dangerouslySetInnerHTML={{ __html: assignment.instructions }}
            />
          )}

          {assignment.attachments.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {assignment.attachments.length} attachment(s) from your teacher.
            </p>
          )}

          {submission && (
            <div className="rounded border bg-muted/40 p-3 text-sm">
              <p className="font-medium">
                Your submission — attempt {submission.attempt}
                {submission.isLate && (
                  <span className="ml-2 text-destructive">(late)</span>
                )}
              </p>
              <p className="text-xs text-muted-foreground">
                {formatDue(submission.submittedAt)}
              </p>
              {submission.textAnswer && (
                <p className="mt-2 whitespace-pre-wrap">
                  {submission.textAnswer}
                </p>
              )}
              {submission.marks !== null && (
                <p className="mt-2 font-medium">
                  Marks: {submission.marks}
                  {assignment.fullMarks && ` / ${assignment.fullMarks}`}
                </p>
              )}
              {submission.feedback && (
                <p className="mt-1 italic">“{submission.feedback}”</p>
              )}
            </div>
          )}

          {canSubmit && fetchers.submit ? (
            assignment.canSubmit ? (
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label>
                    {submission ? "Replace your answer" : "Your answer"}
                  </Label>
                  <Textarea
                    rows={5}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder="Type your answer, or attach a file below."
                  />
                </div>

                {fetchers.upload && (
                  <div className="space-y-2">
                    <Label>Attach a file</Label>
                    <Input
                      type="file"
                      disabled={uploading}
                      onChange={(e) => void onPickFile(e.target.files?.[0])}
                    />
                    {uploading && (
                      <p className="text-xs text-muted-foreground">
                        Uploading…
                      </p>
                    )}
                    {files.length > 0 && (
                      <ul className="space-y-1 text-sm">
                        {files.map((f) => (
                          <li
                            key={f.key}
                            className="flex items-center justify-between rounded border px-2 py-1"
                          >
                            <span className="truncate">{f.name}</span>
                            <span className="ml-2 shrink-0 text-xs text-muted-foreground">
                              {humanBytes(f.size)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                    <p className="text-xs text-muted-foreground">
                      PDF, Word or an image, up to 10 MB each.
                    </p>
                  </div>
                )}

                <Button
                  disabled={nothingToSend || uploading || submit.isPending}
                  onClick={() => submit.mutate()}
                >
                  {submit.isPending
                    ? "Sending…"
                    : submission
                      ? "Resubmit"
                      : "Hand in"}
                </Button>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                {assignment.submitBlockedReason ??
                  "This assignment is not accepting submissions."}
              </p>
            )
          ) : null}
        </div>
      )}
    </div>
  );
}

function MaterialsPanel({ fetchers }: { fetchers: AssignmentFetchers }) {
  const [subject, setSubject] = useState<string>("");

  const materials = useQuery({
    queryKey: ["portal", "materials", fetchers.key],
    queryFn: () => fetchers.materials(),
  });

  const subjects = [
    ...new Map(
      (materials.data ?? []).map((m) => [m.subject.id, m.subject.name]),
    ),
  ];
  const rows = (materials.data ?? []).filter(
    (m) => !subject || m.subject.id === subject,
  );

  return (
    <div className="space-y-3 border-t pt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-medium">Class notes &amp; materials</h3>
        {subjects.length > 1 && (
          <div className="flex flex-wrap gap-1">
            <Button
              size="sm"
              variant={subject === "" ? "default" : "outline"}
              onClick={() => setSubject("")}
            >
              All
            </Button>
            {subjects.map(([id, name]) => (
              <Button
                key={id}
                size="sm"
                variant={subject === id ? "default" : "outline"}
                onClick={() => setSubject(id)}
              >
                {name}
              </Button>
            ))}
          </div>
        )}
      </div>

      {materials.isLoading ? (
        <LoadingBlock />
      ) : materials.isError ? (
        <ErrorState onRetry={() => void materials.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No materials yet"
          description="Notes, slides and links your teachers share will show up here."
        />
      ) : (
        <ul className="space-y-2">
          {rows.map((m) => (
            <li key={m.id} className="rounded-md border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{m.title}</span>
                <Badge variant="outline">
                  {MATERIAL_TYPE_LABELS[m.type]}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {m.subject.name}
                </span>
              </div>
              {m.description && (
                <p className="mt-1 text-sm text-muted-foreground">
                  {m.description}
                </p>
              )}
              {m.linkUrl && (
                <a
                  className="mt-1 block truncate text-sm text-primary hover:underline"
                  href={m.linkUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {m.linkUrl}
                </a>
              )}
              {m.fileUrls.length > 0 && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {m.fileUrls.length} file(s) — ask your teacher if a download
                  link is missing.
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
