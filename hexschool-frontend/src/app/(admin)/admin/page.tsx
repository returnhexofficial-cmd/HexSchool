import { PageHeader } from "@/components/shared/page-header";

// The admin shell (sidebar + header) lives in the (admin) layout since
// M03; dashboards and the session switcher arrive with Modules 04–05.
export default function AdminHomePage() {
  return (
    <main className="flex-1 space-y-6 p-8">
      <PageHeader
        title="Admin"
        description="The admin panel is scaffolded; features arrive module by module."
      />
    </main>
  );
}
