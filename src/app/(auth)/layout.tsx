import { Boxes } from "lucide-react";

export const dynamic = "force-dynamic";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-md bg-primary text-primary-fg">
            <Boxes className="size-5" aria-hidden="true" />
          </span>
          <span className="text-lg font-semibold tracking-tight">Easy 3D</span>
        </div>
        {children}
      </div>
    </main>
  );
}
