"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Can } from "@/components/shared/can";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { apiErrorMessage } from "@/lib/api/auth";
import {
  bookApi,
  categoryApi,
  publisherApi,
  type Book,
} from "@/lib/api/library";
import {
  bookSchema,
  splitAuthorNames,
  type BookFormValues,
} from "@/lib/validations/library";

const ALL = "__all__";
const NONE = "__none__";

/** Shared with the other library tabs. */
export function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-xs text-destructive">{message}</p>;
}

/**
 * The catalogue: one row per **title**, with an availability badge that
 * reads `available / total`. A LOST or WITHDRAWN copy counts toward
 * neither figure (roadmap §6) — "we hold 40 copies" must not include the
 * twelve that went missing in 2019.
 */
export function CatalogTab() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState<string>(ALL);
  const [editing, setEditing] = useState<Book | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Book | null>(null);

  const categories = useQuery({
    queryKey: ["library-categories"],
    queryFn: () => categoryApi.list({ limit: 100 }),
  });

  const list = useQuery({
    queryKey: ["library-books", search, categoryId],
    queryFn: () =>
      bookApi.list({
        search: search.trim() || undefined,
        categoryId: categoryId === ALL ? undefined : categoryId,
        limit: 50,
      }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => bookApi.remove(id),
    onSuccess: () => {
      toast.success("Title removed from the catalogue.");
      setDeleting(null);
      void qc.invalidateQueries({ queryKey: ["library-books"] });
    },
    onError: (err) => {
      setDeleting(null);
      toast.error(apiErrorMessage(err));
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-72 space-y-1">
            <Label htmlFor="book-search">Search</Label>
            <Input
              id="book-search"
              placeholder="Title, ISBN or author"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <div className="w-52 space-y-1">
            <Label>Category</Label>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All categories</SelectItem>
                {(categories.data?.rows ?? []).map((category) => (
                  <SelectItem key={category.id} value={category.id}>
                    {category.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <Can permission="library.catalog.manage">
          <Button onClick={() => setCreating(true)}>Catalogue a book</Button>
        </Can>
      </div>

      {list.isLoading ? (
        <LoadingBlock />
      ) : list.isError ? (
        <ErrorState onRetry={() => void list.refetch()} />
      ) : (list.data?.rows.length ?? 0) === 0 ? (
        <EmptyState
          title="Nothing on the shelves yet"
          description="Catalogue a title, then generate its copies — each one gets its own accession number and barcode."
        />
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Author(s)</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Rack</TableHead>
                <TableHead className="text-right">Copies</TableHead>
                <TableHead className="w-40" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(list.data?.rows ?? []).map((book) => (
                <TableRow key={book.id}>
                  <TableCell>
                    <Link
                      href={`/admin/library/${book.id}`}
                      className="font-medium hover:underline"
                    >
                      {book.title}
                    </Link>
                    <div className="text-xs text-muted-foreground">
                      {[book.edition, book.language, book.isbn]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">
                    {book.authors.map((a) => a.author.name).join(", ") || "—"}
                  </TableCell>
                  <TableCell className="text-sm">
                    {book.category.name}
                  </TableCell>
                  <TableCell className="text-sm">
                    {book.rackNo ?? "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <Badge
                      variant={
                        book.copies.available > 0 ? "default" : "secondary"
                      }
                    >
                      {book.copies.available} / {book.copies.total}
                    </Badge>
                  </TableCell>
                  <TableCell className="space-x-1 text-right">
                    <Can permission="library.catalog.manage">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditing(book)}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDeleting(book)}
                      >
                        Delete
                      </Button>
                    </Can>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {(creating || editing) && (
        <BookDialog
          book={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Remove "${deleting?.title ?? ""}"?`}
        description="A title with copies on the shelves cannot be removed — withdraw those first. This does not touch anybody's borrowing history."
        confirmLabel="Remove"
        onConfirm={() => {
          if (deleting) remove.mutate(deleting.id);
        }}
      />
    </div>
  );
}

function BookDialog({
  book,
  onClose,
}: {
  book: Book | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const categories = useQuery({
    queryKey: ["library-categories"],
    queryFn: () => categoryApi.list({ limit: 100 }),
  });
  const publishers = useQuery({
    queryKey: ["library-publishers"],
    queryFn: () => publisherApi.list({ limit: 100 }),
  });

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<BookFormValues>({
    resolver: zodResolver(bookSchema),
    defaultValues: {
      title: book?.title ?? "",
      titleBn: book?.titleBn ?? "",
      isbn: book?.isbn ?? "",
      categoryId: book?.categoryId ?? "",
      publisherId: book?.publisherId ?? "",
      authorNames: book?.authors.map((a) => a.author.name).join(", ") ?? "",
      edition: book?.edition ?? "",
      language: book?.language ?? "English",
      price: book?.price ? Number(book.price) : undefined,
      rackNo: book?.rackNo ?? "",
      description: book?.description ?? "",
    },
  });

  const save = useMutation({
    mutationFn: (values: BookFormValues) => {
      const payload = {
        title: values.title,
        titleBn: values.titleBn || undefined,
        isbn: values.isbn || undefined,
        categoryId: values.categoryId,
        publisherId: values.publisherId || undefined,
        authorNames: splitAuthorNames(values.authorNames),
        edition: values.edition || undefined,
        language: values.language || undefined,
        price: values.price ?? null,
        rackNo: values.rackNo || undefined,
        description: values.description || undefined,
      };
      return book
        ? bookApi.update(book.id, payload)
        : bookApi.create(payload);
    },
    onSuccess: () => {
      toast.success(book ? "Title updated." : "Catalogued.");
      void qc.invalidateQueries({ queryKey: ["library-books"] });
      onClose();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{book ? "Edit title" : "Catalogue a book"}</DialogTitle>
          <DialogDescription>
            One row per edition. The same title in a different edition is a
            separate book, so its copies never mix on the shelf list.
          </DialogDescription>
        </DialogHeader>

        <form
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={handleSubmit((values) => save.mutate(values))}
        >
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="title">Title</Label>
            <Input id="title" {...register("title")} />
            <FieldError message={errors.title?.message} />
          </div>

          <div className="space-y-1">
            <Label htmlFor="titleBn">Title (Bangla)</Label>
            <Input id="titleBn" {...register("titleBn")} />
          </div>

          <div className="space-y-1">
            <Label htmlFor="isbn">ISBN</Label>
            <Input id="isbn" placeholder="Optional" {...register("isbn")} />
            <FieldError message={errors.isbn?.message} />
          </div>

          <div className="space-y-1">
            <Label>Category</Label>
            <Select
              value={watch("categoryId") || ""}
              onValueChange={(value) => setValue("categoryId", value)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Pick a category" />
              </SelectTrigger>
              <SelectContent>
                {(categories.data?.rows ?? []).map((category) => (
                  <SelectItem key={category.id} value={category.id}>
                    {category.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldError message={errors.categoryId?.message} />
          </div>

          <div className="space-y-1">
            <Label>Publisher</Label>
            <Select
              value={watch("publisherId") || NONE}
              onValueChange={(value) =>
                setValue("publisherId", value === NONE ? "" : value)
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Not recorded</SelectItem>
                {(publishers.data?.rows ?? []).map((publisher) => (
                  <SelectItem key={publisher.id} value={publisher.id}>
                    {publisher.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="authorNames">Authors</Label>
            <Input
              id="authorNames"
              placeholder="Humayun Ahmed, Zafar Iqbal"
              {...register("authorNames")}
            />
            <p className="text-xs text-muted-foreground">
              Comma-separated. Any name that is not already an author is
              created — you do not have to leave this form.
            </p>
          </div>

          <div className="space-y-1">
            <Label htmlFor="edition">Edition</Label>
            <Input id="edition" {...register("edition")} />
          </div>

          <div className="space-y-1">
            <Label htmlFor="language">Language</Label>
            <Input id="language" {...register("language")} />
          </div>

          <div className="space-y-1">
            <Label htmlFor="price">Replacement price (BDT)</Label>
            <Input
              id="price"
              type="number"
              step="0.01"
              {...register("price", {
                setValueAs: (value) =>
                  value === "" || value === null ? undefined : Number(value),
              })}
            />
            <p className="text-xs text-muted-foreground">
              What a lost copy is charged at, times the multiplier setting.
            </p>
          </div>

          <div className="space-y-1">
            <Label htmlFor="rackNo">Rack</Label>
            <Input id="rackNo" placeholder="A1" {...register("rackNo")} />
          </div>

          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="description">Notes</Label>
            <Textarea id="description" rows={3} {...register("description")} />
          </div>

          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {book ? "Save" : "Catalogue"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
