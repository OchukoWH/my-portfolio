import fs from "fs";
import path from "path";

export type ProjectMetadata = {
  title: string;
  description: string;
  date: string;
  status: string;
  featured: boolean;
  github: string;
  demo: string;
  cover: string;
  tags: string[];
  stack: string[];
  published: boolean;
};

export type Project = {
  slug: string;
  content: string;
  metadata: ProjectMetadata;
};

const PROJECTS_DIR = path.join(process.cwd(), "content", "projects");

function parseBoolean(value: string | undefined) {
  return value?.toLowerCase() === "true";
}

function parseList(value: string | undefined) {
  if (!value) {
    return [];
  }

  return value
    .replace(/^\[(.*)\]$/, "$1")
    .split(",")
    .map((item) => item.trim().replace(/^['"](.*)['"]$/, "$1"))
    .filter(Boolean);
}

function parseFrontmatter(fileContent: string) {
  const frontmatterRegex = /^---\s*([\s\S]*?)\s*---/;
  const match = frontmatterRegex.exec(fileContent);

  if (!match) {
    throw new Error("Project Markdown file is missing frontmatter.");
  }

  const rawMetadata: Record<string, string> = {};
  const content = fileContent.replace(frontmatterRegex, "").trim();

  match[1]
    .trim()
    .split("\n")
    .forEach((line) => {
      const [key, ...valueParts] = line.split(":");
      if (!key || valueParts.length === 0) {
        return;
      }

      rawMetadata[key.trim()] = valueParts
        .join(":")
        .trim()
        .replace(/^['"](.*)['"]$/, "$1");
    });

  const metadata: ProjectMetadata = {
    title: rawMetadata.title ?? "Untitled project",
    description: rawMetadata.description ?? "",
    date: rawMetadata.date ?? new Date().toISOString().split("T")[0],
    status: rawMetadata.status ?? "In progress",
    featured: parseBoolean(rawMetadata.featured),
    github: rawMetadata.github ?? "",
    demo: rawMetadata.demo ?? "",
    cover: rawMetadata.cover ?? "",
    tags: parseList(rawMetadata.tags),
    stack: parseList(rawMetadata.stack),
    published: parseBoolean(rawMetadata.published),
  };

  return { metadata, content };
}

function getMarkdownFiles(dir: string) {
  if (!fs.existsSync(dir)) {
    return [];
  }

  return fs.readdirSync(dir).filter((file) => path.extname(file) === ".md");
}

function slugifyTag(tag: string) {
  return tag
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

export function getProjects({ includeDrafts = false } = {}) {
  return getMarkdownFiles(PROJECTS_DIR)
    .map((file) => {
      const rawContent = fs.readFileSync(
        path.join(PROJECTS_DIR, file),
        "utf-8"
      );
      const { metadata, content } = parseFrontmatter(rawContent);

      return {
        metadata,
        content,
        slug: path.basename(file, ".md"),
      };
    })
    .filter((project) => includeDrafts || project.metadata.published)
    .sort((a, b) => {
      if (a.metadata.featured !== b.metadata.featured) {
        return a.metadata.featured ? -1 : 1;
      }

      return (
        new Date(b.metadata.date).getTime() -
        new Date(a.metadata.date).getTime()
      );
    });
}

export function getProject(slug: string) {
  return getProjects().find((project) => project.slug === slug);
}

export function getAdjacentProjects(slug: string) {
  const projects = getProjects();
  const index = projects.findIndex((project) => project.slug === slug);

  return {
    previous: index >= 0 ? projects[index + 1] : undefined,
    next: index > 0 ? projects[index - 1] : undefined,
  };
}

export function getRelatedProjects(slug: string, limit = 2) {
  const project = getProject(slug);

  if (!project) {
    return [];
  }

  const projectTags = new Set(project.metadata.tags.map(slugifyTag));

  return getProjects()
    .filter((candidate) => candidate.slug !== slug)
    .map((candidate) => {
      const score = candidate.metadata.tags.filter((tag) =>
        projectTags.has(slugifyTag(tag))
      ).length;

      return { candidate, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }

      return (
        new Date(b.candidate.metadata.date).getTime() -
        new Date(a.candidate.metadata.date).getTime()
      );
    })
    .slice(0, limit)
    .map(({ candidate }) => candidate);
}
