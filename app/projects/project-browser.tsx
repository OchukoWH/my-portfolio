"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { FaGithub } from "react-icons/fa6";
import type { Project } from "app/lib/projects";

type ProjectSummary = Omit<Project, "content">;

export function 
ProjectBrowser({ projects }: { projects: ProjectSummary[] }) {
  const [activeTag, setActiveTag] = useState("All");

  const tags = useMemo(
    () => [
      "All",
      ...Array.from(
        new Set(projects.flatMap((project) => project.metadata.tags))
      ).sort(),
    ],
    [projects]
  );

  if (projects.length === 0) {
    return (
      <div className="rounded-md border border-neutral-200 p-6 text-neutral-600 dark:border-neutral-800 dark:text-neutral-400">
        No projects available at the moment.
      </div>
    );
  }

  const filteredProjects = projects.filter((project) => {
    const matchesQuery = project.metadata.title
      .toLowerCase()
    const matchesTag =
      activeTag === "All" || project.metadata.tags.includes(activeTag);

    return matchesQuery && matchesTag;
  });

  return (
    <div className="space-y-7">

        <div className="flex flex-wrap gap-2">
          {tags.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => setActiveTag(tag)}
              className={`rounded-md border px-3 py-1 text-xs transition-colors ${
                activeTag === tag
                  ? "border-neutral-950 bg-neutral-950 text-white dark:border-neutral-50 dark:bg-neutral-50 dark:text-neutral-950"
                  : "border-neutral-200 text-neutral-700 hover:border-neutral-400 dark:border-neutral-800 dark:text-neutral-300 dark:hover:border-neutral-600"
              }`}
            >
              {tag}
            </button>
          ))}
        </div>

      <div className="space-y-5">
        {filteredProjects.map((project) => (
          <article
            key={project.slug}
            className="rounded-md border border-neutral-200 p-5 dark:border-neutral-800"
          >
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Link href={`/projects/${project.slug}`}>
                  <h2 className="text-xl font-medium transition-opacity hover:opacity-80">
                    {project.metadata.title}
                  </h2>
                </Link>
                {project.metadata.featured ? (
                  <span className="rounded-md bg-neutral-100 px-2 py-1 text-xs text-neutral-700 dark:bg-neutral-900 dark:text-neutral-300">
                    Featured
                  </span>
                ) : null}
                <span className="rounded-md border border-neutral-200 px-2 py-1 text-xs text-neutral-600 dark:border-neutral-800 dark:text-neutral-400">
                  {project.metadata.status}
                </span>
              </div>

              <p className="text-neutral-700 dark:text-neutral-300">
                {project.metadata.description}
              </p>

              <div className="flex flex-wrap gap-2">
                {project.metadata.stack.map((tech) => (
                  <span
                    key={tech}
                    className="rounded-md border border-neutral-200 px-2 py-1 text-xs text-neutral-600 dark:border-neutral-800 dark:text-neutral-400"
                  >
                    {tech}
                  </span>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-4 pt-2 text-sm">
                <Link href={`/projects/${project.slug}`}>Read case study</Link>
                {project.metadata.github ? (
                  <a
                    className="inline-flex items-center gap-1"
                    href={project.metadata.github}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`${project.metadata.title} GitHub repository`}
                  >
                    <FaGithub aria-hidden="true" />
                    GitHub
                  </a>
                ) : null}
                {project.metadata.demo ? (
                  <a
                    className="rounded-md bg-neutral-950 px-3 py-1.5 text-white dark:bg-neutral-50 dark:text-neutral-950"
                    href={project.metadata.demo}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Demo
                  </a>
                ) : null}
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
