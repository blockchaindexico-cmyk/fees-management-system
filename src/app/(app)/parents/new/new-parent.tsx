"use client";

import { RequireRole } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/ui/page-header";
import { ParentForm } from "../parent-form";

export function NewParent() {
  return (
    <RequireRole role="writer">
      <PageHeader
        title="Add parent"
        crumbs={[{ label: "Parents", href: "/parents" }, { label: "Add parent" }]}
        description="Fields marked * are required."
        info="Parents are also created automatically from the students' phone numbers. Add one here when you want to record a family before its children are admitted, or under another number."
      />
      <ParentForm />
    </RequireRole>
  );
}
