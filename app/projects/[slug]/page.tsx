import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FaGithub } from "react-icons/fa6";
import { Markdown } from "app/components/markdown";
import { formatDate } from "app/lib/posts";
import {
  getProject,
  getProjects,
  getRelatedProjects,
} from "app/lib/projects";
import { absoluteUrl, metaData } from "app/lib/config";

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

  const ogImage = absoluteUrl(
    project.metadata.cover || metaData.defaultProjectOgImage
  );
  const url = `${metaData.baseUrl}/projects/${project.slug}`;
  const keywords = [...project.metadata.stack, ...project.metadata.tags];

  return {
    title: project.metadata.title,
    description: project.metadata.description,
    keywords,
    authors: [{ name: metaData.name }],
    alternates: {
      canonical: url,
    },
    openGraph: {
      title: project.metadata.title,
      description: project.metadata.description,
      type: "article",
      publishedTime: project.metadata.date,
      url,
      images: [
        {
          url: ogImage,
          width: 1200,
          height: 630,
          alt: project.metadata.title,
        },
      ],
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

  const relatedProjects = getRelatedProjects(slug, 3);
  const url = `${metaData.baseUrl}/projects/${project.slug}`;
  const keywords = [...project.metadata.stack, ...project.metadata.tags];
  const ogImage = absoluteUrl(
    project.metadata.cover || metaData.defaultProjectOgImage
  );

  return (
    <section>
      <script
        type="application/ld+json"
        suppressHydrationWarning
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "CreativeWork",
            name: project.metadata.title,
            headline: project.metadata.title,
            datePublished: project.metadata.date,
            dateModified: project.metadata.date,
            description: project.metadata.description,
            url,
            image: ogImage,
            author: {
              "@type": "Person",
              name: metaData.name,
            },
            keywords,
            programmingLanguage: project.metadata.stack,
            codeRepository: project.metadata.github || undefined,
          }),
        }}
      />

      <div className="article-shell">
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

            <h1 className="article-title title">
              {project.metadata.title}
            </h1>

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

          <div className="article-content">
            <Markdown content={project.content} />
          </div>
          {relatedProjects.length > 0 ? (
            <section className="mt-14 border-t border-neutral-200 pt-8 dark:border-neutral-800">
              <h2 className="text-xl font-medium">
                More projects you might like
              </h2>
              <div className="mt-5 grid gap-4">
                {relatedProjects.map((relatedProject) => (
                  <Link
                    key={relatedProject.slug}
                    href={`/projects/${relatedProject.slug}`}
                    className="block rounded-md border border-neutral-200 p-4 transition-colors hover:border-neutral-400 dark:border-neutral-800 dark:hover:border-neutral-600"
                  >
                    <h3 className="font-medium text-neutral-950 dark:text-neutral-50">
                      {relatedProject.metadata.title}
                    </h3>
                    <p className="mt-2 text-sm leading-6 text-neutral-600 dark:text-neutral-400">
                      {relatedProject.metadata.description}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-sm text-neutral-500 dark:text-neutral-400">
                      <time dateTime={relatedProject.metadata.date}>
                        {formatDate(relatedProject.metadata.date)}
                      </time>
                      <span>{relatedProject.metadata.status}</span>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          ) : null}
        </article>
      </div>
    </section>
  );
}
