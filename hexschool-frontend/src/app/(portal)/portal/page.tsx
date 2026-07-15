import { PageHeader } from "@/components/shared/page-header";
import { UserMenu } from "@/components/shared/user-menu";

// Placeholder — student/parent/teacher portals ship with Module 18.
// UserMenu (M02) provides logout/sessions in the meantime.
export default function PortalHomePage() {
  return (
    <main className="flex-1 space-y-6 p-8">
      <UserMenu />
      <PageHeader
        title="Portal"
        description="Student, parent, and teacher portals arrive with Module 18."
      />
    </main>
  );
}
