import type { Metadata } from "next";
import { getProjects } from "app/lib/projects";
import { metaData } from "app/lib/config";
import { ProjectBrowser } from "./project-browser";

export const metadata: Metadata = {
  title: "Projects",
  description:
    "Cloud-native and platform engineering projects by Ochuko Whoro.",
  alternates: {
    canonical: `${metaData.baseUrl}/projects`,
  },
};

export default function Projects() {
  const projects = getProjects().map(({ content, ...project }) => project);

  return (
    <section className="mx-auto w-full max-w-[760px] space-y-8">
      <div className="space-y-3">
        <h1 className="text-3xl font-semibold">Projects</h1>
      </div>

      <ProjectBrowser projects={projects} />
    </section>
  );
}
