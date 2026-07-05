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
    <nav className="lg:mb-16 mb-12 py-5">
      <div className="mx-auto flex w-full max-w-[760px] flex-col md:flex-row md:items-center justify-between">
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
