import { NavBarItemData } from "@/data/models";
import { cn } from "@/lib/utils";
import React from "react";
import { Link, useLocation } from "react-router-dom";

/** "/" only matches itself; any other path also matches the routes below it. */
const matchesPath = (pathname: string, path: string) =>
  path === "/" ? pathname === "/" : pathname === path || pathname.startsWith(`${path}/`);

/** One equal-height zone of the sidebar; the whole zone is the tap target. */
const NavBarItem = ({ Icon, label, linkTo, alsoActiveOn = [] }: NavBarItemData) => {
  const { pathname } = useLocation();
  const isActive = [linkTo, ...alsoActiveOn].some((path) => matchesPath(pathname, path));

  return (
    <Link to={linkTo} aria-current={isActive ? "page" : undefined} className="flex min-h-0 flex-1 p-1.5">
      <div
        className={cn(
          "flex h-full w-full flex-col items-center justify-center gap-1.5 rounded-xl",
          isActive ? "bg-secondary text-foreground" : "text-muted-foreground",
        )}
      >
        <Icon className="h-8 w-8" />
        <p className="text-sm font-medium">{label}</p>
      </div>
    </Link>
  );
};

export default NavBarItem;
