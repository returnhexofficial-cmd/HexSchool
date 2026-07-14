import { PageHeader } from "@/components/shared/page-header";

// Placeholder — the admin shell (sidebar, session switcher, dashboards)
// grows from Module 02 onward.
export default function AdminHomePage() {
  return (
    <main className="flex-1 p-8">
      <PageHeader
        title="Admin"
        description="The admin panel is scaffolded; features arrive module by module."
      />
    </main>
  );
}
