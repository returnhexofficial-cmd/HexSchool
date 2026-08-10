"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { publicCommunityApi } from "@/lib/api/community";

/**
 * The public alumni directory (roadmap §5's "directory (search by
 * batch)").
 *
 * **Every card here carries a name, a batch, a profession and nothing
 * else that could be used to contact anybody.** That is not a rendering
 * choice made on this screen — the API never sends a phone number or an
 * email for a public profile, and only profiles whose owner explicitly
 * opted in are returned at all. This component could not leak a contact
 * detail if it tried, which is the property worth having.
 */
export function AlumniDirectory() {
  const [search, setSearch] = useState("");
  const [batchYear, setBatchYear] = useState<number | null>(null);

  const batches = useQuery({
    queryKey: ["public-alumni", "batches"],
    queryFn: () => publicCommunityApi.batches(),
  });

  const directory = useQuery({
    queryKey: ["public-alumni", { search, batchYear }],
    queryFn: () =>
      publicCommunityApi.directory({
        limit: 60,
        search: search || undefined,
        batchYear: batchYear ?? undefined,
      }),
  });

  const profiles = directory.data?.data ?? [];

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="dir-search">Search</Label>
          <Input
            id="dir-search"
            placeholder="Name, profession or organization"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {(batches.data ?? []).length > 0 && (
          <div className="flex flex-wrap gap-2">
            <Button
              variant={batchYear === null ? "default" : "outline"}
              size="sm"
              onClick={() => setBatchYear(null)}
            >
              All batches
            </Button>
            {(batches.data ?? []).map((batch) => (
              <Button
                key={batch.batchYear}
                variant={batchYear === batch.batchYear ? "default" : "outline"}
                size="sm"
                onClick={() => setBatchYear(batch.batchYear)}
              >
                {batch.batchYear}
                <span className="ml-1.5 text-xs opacity-70">
                  {batch.count}
                </span>
              </Button>
            ))}
          </div>
        )}
      </div>

      {directory.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : profiles.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            {search || batchYear
              ? "Nobody in the directory matches that."
              : "The directory is empty for now. Register below to be the first."}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {profiles.map((profile) => (
            <Card key={profile.id}>
              <CardContent className="space-y-2 p-4">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium">{profile.name}</p>
                  <Badge variant="secondary">{profile.batchYear}</Badge>
                </div>
                {(profile.profession || profile.organization) && (
                  <p className="text-sm text-muted-foreground">
                    {[profile.profession, profile.organization]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                )}
                {profile.lastClass && (
                  <p className="text-xs text-muted-foreground">
                    Left from {profile.lastClass}
                  </p>
                )}
                {profile.bio && (
                  <p className={cn("text-sm", "line-clamp-3")}>{profile.bio}</p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
