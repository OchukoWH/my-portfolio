import Link from "next/link";
import { FaGithub } from "react-icons/fa6";
import { contactLinks } from "app/lib/config";
import { formatDate, getBlogPosts } from "app/lib/posts";
import { getProjects } from "app/lib/projects";

export default function Page() {
  const featuredProjects = getProjects()
    .filter((project) => project.metadata.featured)
    .sort(
      (a, b) =>
        new Date(b.metadata.date).getTime() -
        new Date(a.metadata.date).getTime()
    )
    .slice(0, 3);
  const featuredPosts = getBlogPosts().slice(0, 3);

  return (
    <section className="mx-auto w-full max-w-[768px] space-y-16">
      <div className="space-y-7">
        <div className="space-y-4">
          <p className="text-sm font-medium uppercase tracking-[0.16em] text-neutral-500 dark:text-neutral-400">
            Kubernetes {/*& AWS*/} Certified • Cloud-Native Infrastructure Engineer
          </p>
          <h1 className="title text-4xl font-semibold leading-tight text-neutral-950 dark:text-neutral-50">
           Platforms and Infrastructure.
          </h1>
        </div>

        <div className="prose prose-neutral dark:prose-invert text-lg">
          <p>
            <span className="font-bold">Ochuko</span> is a Kubernetes {/*and AWS*/} certified cloud-native
            infrastructure engineer focused on Kubernetes, Linux, Go, AWS,
            Terraform, and platform engineering.
          </p>
          <p>
            He works on Kubernetes platforms, networking, storage,
            virtualization, automation, observability, reliability, and
            developer tooling for cloud-native systems.
          </p>
          <p>
            I enjoy learning how production platforms work, from
            Kubernetes networking and storage to infrastructure automation,
            distributed systems, and platform reliability.
          </p>
          <p>
            My work combines software engineering with infrastructure
            engineering. I write Go, Python, TypeScript, Bash, and Terraform to
            build cloud-native tools, automate infrastructure, and publish
            practical technical articles that help engineers understand complex
            systems.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <Link
            className="rounded-md bg-neutral-950 px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-neutral-950"
            href="/projects"
          >
            View Projects
          </Link>
          <Link
            className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium dark:border-neutral-700"
            href="/blog"
          >
            Read Blog
          </Link>
          <a
            className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium dark:border-neutral-700"
            href={`mailto:${contactLinks.email}`}
          >
            Contact Me
          </a>
        </div>
      </div>

      {featuredProjects.length > 0 ? (
        <div className="space-y-5">
          <div className="flex items-end justify-between gap-4">
            <h2 className="text-xl font-medium">Featured Projects</h2>
            <Link
              className="text-sm text-neutral-600 hover:text-neutral-950 dark:text-neutral-400 dark:hover:text-neutral-100"
              href="/projects"
            >
              View all projects
            </Link>
          </div>
          <div className="grid gap-4">
            {featuredProjects.map((project) => (
              <article
                key={project.slug}
                className="rounded-md border border-neutral-200 p-4 dark:border-neutral-800"
              >
                <h3 className="font-medium">{project.metadata.title}</h3>
                <p className="mt-2 text-sm leading-6 text-neutral-600 dark:text-neutral-400">
                  {project.metadata.description}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {project.metadata.stack.map((tech) => (
                    <span
                      key={tech}
                      className="rounded-md border border-neutral-200 px-2 py-1 text-xs text-neutral-600 dark:border-neutral-800 dark:text-neutral-400"
                    >
                      {tech}
                    </span>
                  ))}
                </div>
                <div className="mt-4 flex flex-wrap gap-3 text-sm">
                  {project.metadata.github ? (
                    <a
                      className="inline-flex items-center gap-1 rounded-md border border-neutral-300 px-3 py-1.5 font-medium dark:border-neutral-700"
                      href={project.metadata.github}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <FaGithub aria-hidden="true" />
                      GitHub
                    </a>
                  ) : (
                    <span
                      aria-disabled="true"
                      className="inline-flex items-center gap-1 rounded-md border border-neutral-200 px-3 py-1.5 font-medium text-neutral-400 dark:border-neutral-800 dark:text-neutral-600"
                    >
                      <FaGithub aria-hidden="true" />
                      GitHub
                    </span>
                  )}
                  <Link
                    className="rounded-md border border-neutral-300 px-3 py-1.5 font-medium dark:border-neutral-700"
                    href={`/projects/${project.slug}`}
                  >
                    Read More
                  </Link>
                </div>
              </article>
            ))}
          </div>
        </div>
      ) : null}

      {featuredPosts.length > 0 ? (
        <div className="space-y-5">
          <div className="flex items-end justify-between gap-4">
            <h2 className="text-xl font-medium">Latest Articles</h2>
            <Link
              className="text-sm text-neutral-600 hover:text-neutral-950 dark:text-neutral-400 dark:hover:text-neutral-100"
              href="/blog"
            >
              View all writing
            </Link>
          </div>
          <div>
            {featuredPosts.map((post) => (
              <article
                key={post.slug}
                className="border-b border-neutral-200 py-5 first:pt-0 last:border-0 dark:border-neutral-800"
              >
                <Link
                  href={`/blog/${post.slug}`}
                  className="block transition-opacity hover:opacity-80"
                >
                  <h3 className="font-medium">{post.metadata.title}</h3>
                </Link>
                <div className="flex flex-wrap gap-x-3 gap-y-1 pt-2 text-sm text-neutral-500 dark:text-neutral-400">
                  <time dateTime={post.metadata.date}>
                    {formatDate(post.metadata.date)}
                  </time>
                </div>
                <div className="flex flex-wrap gap-2 pt-3">
                  {post.metadata.tags.slice(0, 4).map((tag) => (
                    <span
                      key={tag}
                      className="rounded-md border border-neutral-200 px-2 py-1 text-xs text-neutral-600 dark:border-neutral-800 dark:text-neutral-400"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
