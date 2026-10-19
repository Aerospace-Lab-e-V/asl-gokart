import { NavBarItemData } from "@/data/models";
import NavBarItem from "./navbar-item";
import React from "react";

interface NavBarProps {
  items: NavBarItemData[];
}

const NavBar = ({ items }: NavBarProps) => {
  return (
    <nav className="flex h-full flex-col py-1.5">
      {items.map((item) => (
        <NavBarItem key={item.linkTo} {...item} />
      ))}
    </nav>
  );
};

export default NavBar;
