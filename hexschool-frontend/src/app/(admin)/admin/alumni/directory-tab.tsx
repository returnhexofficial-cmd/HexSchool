"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Can } from "@/components/shared/can";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { LoadingBlock } from "@/components/shared/spinner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiErrorMessage } from "@/lib/api/auth";
import {
  ALUMNI_STATUS_LABELS,
  alumniApi,
  type Alumni,
} from "@/lib/api/community";

/**
 * The school's own view of the directory — which, unlike the public one,
 * **does** carry phone numbers and emails. That is the point of the
 * school's copy: the office can ring people. The public directory never
 * shows a contact detail, and the two are different queries rather than
 * the same query trimmed differently.
 *
 * The **Public profile** badge is the opt-in from roadmap §6, shown on
 * every row so it is obvious at a glance which entries a visitor to the
 * website can see.
 */
export function DirectoryTab() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [batchYear, setBatchYear] = useState("");
  const [editing, setEditing] = useState<Alumni | null>(null);
  const [creating, setCreating] = useState(false);

  const list = useQuery({
    queryKey: ["alumni", { search, batchYear, status: "APPROVED" }],
    queryFn: () =>
      alumniApi.list({
        limit: 200,
        status: "APPROVED",
        search: search || undefined,
        batchYear: batchYear ? Number(batchYear) : undefined,
      }),
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["alumni"] });

  const remove = useMutation({
    mutationFn: (id: string) => alumniApi.remove(id),
    onSuccess: () => {
      toast.success("Profile removed");
      invalidate();
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  if (list.isLoading) return <LoadingBlock />;
  if (list.isError) return <ErrorState onRetry={() => void list.refetch()} />;

  const rows = list.data?.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="al-search">Search</Label>
          <Input
            id="al-search"
            className="w-64"
            placeholder="Name, profession or organization"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="al-batch">Batch</Label>
          <Input
            id="al-batch"
            className="w-28"
            placeholder="2015"
            value={batchYear}
            onChange={(e) => setBatchYear(e.target.value)}
          />
        </div>
        <div className="ml-auto flex gap-2">
          <Can permission="alumni.export">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void alumniApi.downloadDirectory()}
            >
              Export (XLSX)
            </Button>
          </Can>
          <Can permission="alumni.manage">
            <Button size="sm" onClick={() => setCreating(true)}>
              Add an alumnus
            </Button>
          </Can>
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="No alumni yet"
          description="Approved registrations and profiles added here make up the directory."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="p-3">Name</th>
                <th className="p-3">Batch</th>
                <th className="p-3">Profession</th>
                <th className="p-3">Organization</th>
                <th className="p-3">Contact</th>
                <th className="p-3">Public</th>
                <th className="p-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map((alumnus) => (
                <tr key={alumnus.id} className="border-t">
                  <td className="p-3 font-medium">{alumnus.name}</td>
                  <td className="p-3">{alumnus.batchYear}</td>
                  <td className="p-3 text-muted-foreground">
                    {alumnus.profession ?? "—"}
                  </td>
                  <td className="p-3 text-muted-foreground">
                    {alumnus.organization ?? "—"}
                  </td>
                  <td className="p-3 text-muted-foreground">
                    {alumnus.phone ?? alumnus.email ?? "—"}
                  </td>
                  <td className="p-3">
                    {alumnus.isPublicProfile ? (
                      <Badge variant="default">Listed</Badge>
                    ) : (
                      <Badge variant="outline">Private</Badge>
                    )}
                  </td>
                  <td className="p-3 text-right">
                    <Can permission="alumni.manage">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditing(alumnus)}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            if (confirm(`Remove ${alumnus.name}?`)) {
                              remove.mutate(alumnus.id);
                            }
                          }}
                        >
                          Remove
                        </Button>
                      </div>
                    </Can>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(creating || editing) && (
        <AlumniDialog
          alumnus={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={invalidate}
        />
      )}
    </div>
  );
}

function AlumniDialog({
  alumnus,
  onClose,
  onSaved,
}: {
  alumnus: Alumni | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(alumnus?.name ?? "");
  const [batchYear, setBatchYear] = useState(
    alumnus ? String(alumnus.batchYear) : "",
  );
  const [lastClass, setLastClass] = useState(alumnus?.lastClass ?? "");
  const [phone, setPhone] = useState(alumnus?.phone ?? "");
  const [email, setEmail] = useState(alumnus?.email ?? "");
  const [profession, setProfession] = useState(alumnus?.profession ?? "");
  const [organization, setOrganization] = useState(
    alumnus?.organization ?? "",
  );
  const [bio, setBio] = useState(alumnus?.bio ?? "");
  const [isPublicProfile, setIsPublicProfile] = useState(
    alumnus?.isPublicProfile ?? false,
  );

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name,
        batchYear: Number(batchYear),
        lastClass: lastClass || undefined,
        phone: phone || undefined,
        email: email || undefined,
        profession: profession || undefined,
        organization: organization || undefined,
        bio: bio || undefined,
        isPublicProfile,
      };
      return alumnus
        ? alumniApi.update(alumnus.id, body)
        : alumniApi.create(body);
    },
    onSuccess: () => {
      toast.success(alumnus ? "Profile updated" : "Alumnus added");
      onSaved();
      onClose();
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const year = Number(batchYear);
  const valid =
    name.trim().length >= 2 &&
    Number.isInteger(year) &&
    year >= 1950 &&
    year <= new Date().getFullYear() &&
    (phone.trim().length > 0 || email.trim().length > 0);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {alumnus ? "Edit alumni profile" : "Add an alumnus"}
          </DialogTitle>
          <DialogDescription>
            A profile needs a phone number or an email — a directory entry
            nobody can reach is one nobody uses.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="ad-name">Name</Label>
            <Input
              id="ad-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ad-batch">Batch year</Label>
              <Input
                id="ad-batch"
                value={batchYear}
                onChange={(e) => setBatchYear(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ad-class">Last class</Label>
              <Input
                id="ad-class"
                value={lastClass}
                onChange={(e) => setLastClass(e.target.value)}
              />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ad-phone">Mobile</Label>
              <Input
                id="ad-phone"
                placeholder="01XXXXXXXXX"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ad-email">Email</Label>
              <Input
                id="ad-email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ad-profession">Profession</Label>
              <Input
                id="ad-profession"
                value={profession}
                onChange={(e) => setProfession(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ad-org">Organization</Label>
              <Input
                id="ad-org"
                value={organization}
                onChange={(e) => setOrganization(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ad-bio">Note</Label>
            <Textarea
              id="ad-bio"
              rows={3}
              value={bio}
              onChange={(e) => setBio(e.target.value)}
            />
          </div>

          <label className="flex items-start gap-2 rounded-md border p-3 text-sm">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={isPublicProfile}
              onChange={(e) => setIsPublicProfile(e.target.checked)}
            />
            <span>
              <strong>Show on the public directory.</strong> Only the name,
              batch, class, profession, organization and note are published —
              never a phone number, an email or an address.
            </span>
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!valid || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
