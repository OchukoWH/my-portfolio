import Link from "next/link";
import { ThemeSwitch } from "./theme-switch";
import { metaData, resumeUrl } from "../lib/config";

const navItems = {
  "/projects": { name: "Projects" },
  "/blog": { name: "Blog" },
  "/certifications": { name: "Certifications" },
};

export function Navbar() {
  return (
    <nav className="sticky top-0 z-50 mb-8 bg-white/95 py-5 backdrop-blur dark:bg-neutral-950/95 lg:mb-10">
      <div className="mx-auto flex w-full max-w-[768px] flex-col justify-between md:flex-row md:items-center">
        <div className="flex items-center">
          <Link href="/" className="text-2xl font-semibold">
            {metaData.name}
          </Link>
        </div>
        <div className="flex flex-row flex-wrap gap-x-4 gap-y-3 mt-6 md:mt-0 md:ml-auto items-center text-sm">
          {Object.entries(navItems).map(([path, { name }]) => (
            <Link
              key={path}
              href={path}
              className="transition-all hover:text-neutral-800 dark:hover:text-neutral-200 flex align-middle relative"
            >
              {name}
            </Link>
          ))}
          <a
            href={resumeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="transition-all hover:text-neutral-800 dark:hover:text-neutral-200 flex align-middle relative"
          >
            Resume
          </a>
          <ThemeSwitch />
        </div>
      </div>
    </nav>
  );
}
