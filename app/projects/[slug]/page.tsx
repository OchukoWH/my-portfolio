import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FaGithub } from "react-icons/fa6";
import { AuthorCard } from "app/components/author-card";
import { KnowledgeGraph } from "app/components/knowledge-graph";
import { Markdown } from "app/components/markdown";
import { formatDate } from "app/lib/posts";
import {
  getAdjacentProjects,
  getProject,
  getProjects,
} from "app/lib/projects";
import { getKnowledgeGraph } from "app/lib/related";
import { metaData } from "app/lib/config";

type Params = {
  params: Promise<{ slug: string }>;
};

export async function generateStaticParams() {
  return getProjects().map((project) => ({
    slug: project.slug,
  }));
}

export async function generateMetadata({
  params,
}: Params): Promise<Metadata | undefined> {
  const { slug } = await params;
  const project = getProject(slug);

  if (!project) {
    return;
  }

  const ogImage =
    project.metadata.cover ||
    `${metaData.baseUrl}/og?title=${encodeURIComponent(
      project.metadata.title
    )}`;

  return {
    title: project.metadata.title,
    description: project.metadata.description,
    openGraph: {
      title: project.metadata.title,
      description: project.metadata.description,
      type: "article",
      publishedTime: project.metadata.date,
      url: `${metaData.baseUrl}/projects/${project.slug}`,
      images: [{ url: ogImage }],
    },
    twitter: {
      card: "summary_large_image",
      title: project.metadata.title,
      description: project.metadata.description,
      images: [ogImage],
    },
  };
}

export default async function ProjectPage({ params }: Params) {
  const { slug } = await params;
  const project = getProject(slug);

  if (!project) {
    notFound();
  }

  const { previous, next } = getAdjacentProjects(slug);
  const graph = getKnowledgeGraph({
    type: "project",
    slug: project.slug,
    tags: project.metadata.tags,
  });

  return (
    <section>
      <script
        type="application/ld+json"
        suppressHydrationWarning
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "TechArticle",
            headline: project.metadata.title,
            datePublished: project.metadata.date,
            dateModified: project.metadata.date,
            description: project.metadata.description,
            url: `${metaData.baseUrl}/projects/${project.slug}`,
            author: {
              "@type": "Person",
              name: metaData.name,
            },
            keywords: [...project.metadata.tags, ...project.metadata.stack],
          }),
        }}
      />

      <div className="mx-auto grid max-w-[900px] gap-8 lg:grid-cols-[minmax(0,600px)_240px] lg:items-start">
        <article>
          <Link
            href="/projects"
            className="mb-8 inline-block text-sm text-neutral-600 hover:text-neutral-950 dark:text-neutral-400 dark:hover:text-neutral-100"
          >
            Back to projects
          </Link>

          <header className="mb-12 space-y-5 border-b border-neutral-200 pb-8 dark:border-neutral-800">
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-neutral-500 dark:text-neutral-400">
              <time dateTime={project.metadata.date}>
                {formatDate(project.metadata.date)}
              </time>
              <span>{project.metadata.status}</span>
              {project.metadata.featured ? <span>Featured</span> : null}
            </div>

            <h1 className="title text-4xl font-semibold leading-tight text-neutral-950 dark:text-neutral-50">
              {project.metadata.title}
            </h1>
            <p className="text-lg leading-8 text-neutral-700 dark:text-neutral-300">
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

            <div className="flex flex-wrap items-center gap-4 text-sm">
              {project.metadata.github ? (
                <a
                  className="inline-flex items-center gap-1"
                  href={project.metadata.github}
                  target="_blank"
                  rel="noreferrer"
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
          </header>

          <div className="prose prose-lg prose-neutral dark:prose-invert">
            <Markdown content={project.content} />
          </div>
          <AuthorCard />
        </article>
        <KnowledgeGraph graph={graph} />
      </div>

      <nav className="mx-auto mt-14 grid max-w-[600px] gap-4 border-t border-neutral-200 pt-8 text-sm dark:border-neutral-800 sm:grid-cols-2">
        {previous ? (
          <Link href={`/projects/${previous.slug}`} className="space-y-1">
            <span className="block text-neutral-500 dark:text-neutral-400">
              Previous project
            </span>
            <span className="font-medium">{previous.metadata.title}</span>
          </Link>
        ) : (
          <span />
        )}
        {next ? (
          <Link
            href={`/projects/${next.slug}`}
            className="space-y-1 sm:text-right"
          >
            <span className="block text-neutral-500 dark:text-neutral-400">
              Next project
            </span>
            <span className="font-medium">{next.metadata.title}</span>
          </Link>
        ) : null}
      </nav>
    </section>
  );
}
