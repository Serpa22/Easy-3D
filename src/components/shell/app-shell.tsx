"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Boxes, LogOut, Menu, Plus, Settings, X } from "lucide-react";
import { ThemeToggle } from "@/components/ui/client-bits";
import { Monogram } from "@/components/ui/display";
import { closeModalAnimated } from "@/components/ui/top-layer";
import { cn } from "@/lib/cn";
import { COMPANY_NAV, companyHref } from "@/lib/nav";
import { logoutAction } from "@/server/actions/auth";
import { NavIcon } from "./nav-icon";
import { NewCompanyDialog } from "./new-company-dialog";

export interface ShellCompany {
  slug: string;
  name: string;
  monogram: string;
  activity: string | null;
}

export interface AppShellProps {
  orgName: string;
  companies: ShellCompany[];
  user: { name: string; email: string };
  children: ReactNode;
}

const linkClass =
  "flex min-h-9 items-center gap-3 rounded-md px-2.5 text-sm transition-colors pointer-coarse:min-h-11";
const idle = "text-fg-2 hover:bg-hover hover:text-fg active:bg-active";
const active = "bg-hover font-medium text-fg";

function Logo() {
  return (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-fg">
      <Boxes className="size-[1.125rem]" aria-hidden="true" />
    </span>
  );
}

function SidebarContent({ orgName, companies, user, onNavigate, onNewCompany }: Omit<AppShellProps, "children"> & { onNavigate?: () => void; onNewCompany: () => void }) {
  const pathname = usePathname();
  const currentSlug = pathname.startsWith("/e/") ? pathname.split("/")[2] : null;
  const segment = currentSlug ? (pathname.split("/")[3] ?? "") : null;

  return (
    <div className="flex h-full flex-col">
      <Link href="/" onClick={onNavigate} className="flex h-14 shrink-0 items-center gap-3 px-4 hover:bg-hover active:bg-active">
        <Logo />
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-fg">{orgName}</span>
          <span className="block text-[0.6875rem] uppercase tracking-wider text-fg-3">Impresión 3D</span>
        </span>
      </Link>

      <nav aria-label="Principal" className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-4">
        <Link href="/" onClick={onNavigate} aria-current={pathname === "/" ? "page" : undefined} className={cn(linkClass, "mt-2", pathname === "/" ? active : idle)}>
          <NavIcon name="dashboard" className="size-4 shrink-0" />
          Vista de grupo
        </Link>

        <div className="mb-1 mt-5 flex items-center justify-between px-2.5">
          <span className="text-[0.6875rem] font-medium uppercase tracking-wider text-fg-3">Sub-empresas</span>
        </div>
        <ul className="flex flex-col gap-0.5">
          {companies.map((company) => {
            const isCurrent = company.slug === currentSlug;
            return (
              <li key={company.slug}>
                <Link
                  href={companyHref(company.slug)}
                  onClick={onNavigate}
                  aria-current={isCurrent && segment === "" ? "page" : undefined}
                  className={cn(linkClass, "min-h-10", isCurrent ? "text-fg" : idle)}
                >
                  <Monogram text={company.monogram} size="sm" inverted={isCurrent} />
                  <span className="min-w-0 flex-1 truncate font-medium">{company.name}</span>
                </Link>
                {isCurrent ? (
                  <div className="mb-2 ml-[1.0625rem] mt-0.5 border-l border-line pl-2.5">
                    {COMPANY_NAV.map((group) => (
                      <ul key={group.title} aria-label={group.title} className="mb-2 flex flex-col gap-0.5 last:mb-0">
                        {group.items.map((item) => {
                          const isActive = segment === item.segment;
                          return (
                            <li key={item.segment}>
                              <Link
                                href={companyHref(company.slug, item.segment)}
                                onClick={onNavigate}
                                aria-current={isActive ? "page" : undefined}
                                className={cn(linkClass, isActive ? active : idle)}
                              >
                                <NavIcon name={item.icon} className="size-4 shrink-0" />
                                {item.label}
                              </Link>
                            </li>
                          );
                        })}
                      </ul>
                    ))}
                  </div>
                ) : null}
              </li>
            );
          })}
          <li>
            <button type="button" onClick={onNewCompany} className={cn(linkClass, idle, "w-full")}>
              <span className="flex size-7 shrink-0 items-center justify-center rounded-sm border border-dashed border-line-strong">
                <Plus className="size-3.5" aria-hidden="true" />
              </span>
              Nueva sub-empresa
            </button>
          </li>
        </ul>
      </nav>

      <div className="shrink-0 border-t border-line p-2">
        <Link href="/ajustes" onClick={onNavigate} aria-current={pathname.startsWith("/ajustes") ? "page" : undefined} className={cn(linkClass, pathname.startsWith("/ajustes") ? active : idle)}>
          <Settings className="size-4 shrink-0" aria-hidden="true" />
          Ajustes generales
        </Link>
        <div className="mt-1 flex items-center gap-1 pl-2.5">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[0.8125rem] font-medium text-fg">{user.name}</p>
            <p className="truncate text-xs text-fg-3">{user.email}</p>
          </div>
          <ThemeToggle />
          <form action={logoutAction}>
            <button
              type="submit"
              aria-label="Cerrar sesión"
              title="Cerrar sesión"
              className="flex size-10 items-center justify-center rounded-md text-fg-2 transition-colors hover:bg-hover hover:text-fg active:bg-active pointer-coarse:size-11"
            >
              <LogOut className="size-[1.125rem]" aria-hidden="true" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

/** Armazón de la zona autenticada: barra lateral fija en escritorio y cajón en móvil. */
export function AppShell({ children, ...props }: AppShellProps) {
  const pathname = usePathname();
  const drawerRef = useRef<HTMLDialogElement>(null);
  const [newCompany, setNewCompany] = useState(false);

  const closeDrawer = () => {
    if (drawerRef.current?.open) void closeModalAnimated(drawerRef.current);
  };
  // Al cambiar de página el cajón se cierra.
  useEffect(() => {
    if (drawerRef.current?.open) drawerRef.current.close();
  }, [pathname]);

  const currentSlug = pathname.startsWith("/e/") ? pathname.split("/")[2] : null;
  const current = props.companies.find((c) => c.slug === currentSlug);

  return (
    <div className="min-h-dvh lg:pl-64">
      <a href="#contenido" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:text-primary-fg">
        Saltar al contenido
      </a>

      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-line bg-bg lg:block">
        <SidebarContent {...props} onNewCompany={() => setNewCompany(true)} />
      </aside>

      <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-line bg-bg px-2 lg:hidden">
        <button
          type="button"
          aria-label="Abrir menú"
          onClick={() => drawerRef.current?.showModal()}
          className="flex size-11 items-center justify-center rounded-md text-fg hover:bg-hover active:bg-active"
        >
          <Menu className="size-5" aria-hidden="true" />
        </button>
        <Link href={current ? companyHref(current.slug) : "/"} className="flex min-w-0 items-center gap-2.5 rounded-md px-1 py-1.5 active:bg-active">
          {current ? <Monogram text={current.monogram} size="sm" inverted /> : <Logo />}
          <span className="truncate text-sm font-semibold">{current ? current.name : props.orgName}</span>
        </Link>
      </header>

      <dialog
        ref={drawerRef}
        className="drawer"
        aria-label="Menú de navegación"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) closeDrawer();
        }}
      >
        <button
          type="button"
          aria-label="Cerrar menú"
          onClick={closeDrawer}
          className="absolute right-1.5 top-1.5 z-10 flex size-11 items-center justify-center rounded-md text-fg-2 hover:bg-hover hover:text-fg active:bg-active"
        >
          <X className="size-5" aria-hidden="true" />
        </button>
        <SidebarContent
          {...props}
          onNavigate={closeDrawer}
          onNewCompany={() => {
            drawerRef.current?.close();
            setNewCompany(true);
          }}
        />
      </dialog>

      <main id="contenido" className="mx-auto flex w-full max-w-[1320px] flex-col gap-6 px-4 pb-16 pt-6 sm:px-6 lg:px-8 lg:pt-8">
        {children}
      </main>

      <NewCompanyDialog open={newCompany} onClose={() => setNewCompany(false)} />
    </div>
  );
}
