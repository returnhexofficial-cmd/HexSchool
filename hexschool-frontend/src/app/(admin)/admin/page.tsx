import { PageHeader } from "@/components/shared/page-header";
import { UserMenu } from "@/components/shared/user-menu";

// Placeholder — the admin shell (sidebar, session switcher, dashboards)
// grows from Module 03 onward. UserMenu (M02) provides logout/sessions.
export default function AdminHomePage() {
  return (
    <main className="flex-1 space-y-6 p-8">
      <UserMenu />
      <PageHeader
        title="Admin"
        description="The admin panel is scaffolded; features arrive module by module."
      />
    </main>
  );
}
