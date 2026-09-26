import { AppShell } from "@/components/layouts/app-shell";

export default function MainLayout({
  children,
  modal,
}: {
  children: React.ReactNode;
  modal?: React.ReactNode;
}) {
  return <AppShell modal={modal}>{children}</AppShell>;
}
