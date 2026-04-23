"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { forwardRef, ReactNode } from "react";
import { cn } from "@/lib/utils";

type NavState = { isActive: boolean; isPending: boolean };

interface NavLinkProps {
  to: string;
  end?: boolean;
  className?: string | ((s: NavState) => string | undefined);
  activeClassName?: string;
  pendingClassName?: string;
  children?: ReactNode | ((s: NavState) => ReactNode);
  [k: string]: any;
}

const NavLink = forwardRef<HTMLAnchorElement, NavLinkProps>(
  ({ to, end, className, activeClassName, pendingClassName, children, ...props }, ref) => {
    const pathname = usePathname() ?? "";
    const target = to.split("?")[0];
    const isActive = end
      ? pathname === target
      : pathname === target || pathname.startsWith(target + "/");
    const state: NavState = { isActive, isPending: false };
    const cls =
      typeof className === "function"
        ? className(state)
        : cn(className, isActive && activeClassName);
    return (
      <Link href={to} ref={ref as any} className={cls} {...props}>
        {typeof children === "function" ? (children as (s: NavState) => ReactNode)(state) : children}
      </Link>
    );
  }
);

NavLink.displayName = "NavLink";

export { NavLink };
