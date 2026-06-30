import Link from "next/link";
import { contactLinks } from "app/lib/config";
import { getBlogPosts } from "app/lib/posts";
import { getProjects } from "app/lib/projects";

const focusAreas = [
  "Kubernetes",
  "Go",
  "Linux",
  "AWS",
  "Terraform",
  "Cloud Native",
  "Platform Engineering",
  "Technical Writing",
];

export default function Page() {
  const featuredProjects = getProjects().slice(0, 3);
  const featuredPosts = getBlogPosts().slice(0, 3);

  return (
    <section className="mx-auto w-full max-w-[720px] space-y-16">
      <div className="space-y-7">
        <div className="space-y-4">
          <p className="text-sm font-medium uppercase tracking-[0.16em] text-neutral-500 dark:text-neutral-400">
            Cloud-native platform engineer
          </p>
          <h1 className="title text-4xl font-semibold leading-tight text-neutral-950 dark:text-neutral-50">
            I build reliable Kubernetes platforms and developer infrastructure.
          </h1>
        </div>

        <div className="prose prose-neutral dark:prose-invert text-lg">
          <p>
            I am Ochuko Whoro. I work on cloud-native systems with a focus on
            Kubernetes, Linux, Go, AWS, Terraform, and the platform engineering
            practices that make infrastructure easier to operate. I also help
            with technical writing for engineering teams that need clear,
            practical documentation and deep technical content.
          </p>
          <p>
            My aim is to build practical platforms, tools, and learning
            resources that help engineering teams ship safely, understand their
            systems, and recover faster when production breaks.
          </p>
          <p>
            I live in Lagos, Nigeria, and work from the WAT timezone. I can
            comfortably collaborate with teams across timezones within about a
            three-hour offset.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <a
            className="rounded-md bg-neutral-950 px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-neutral-950"
            href={contactLinks.bookSession}
            target="_blank"
            rel="noopener noreferrer"
          >
            Book a session
          </a>
          <a
            className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium dark:border-neutral-700"
            href={`mailto:${contactLinks.email}`}
          >
            Email me
          </a>
          <Link
            className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium dark:border-neutral-700"
            href="/projects"
          >
            View projects
          </Link>
        </div>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          I typically respond within 24 hours.
        </p>
      </div>

      <div className="space-y-4">
        <h2 className="text-xl font-medium">What I Work On</h2>
        <div className="flex flex-wrap gap-2">
          {focusAreas.map((area) => (
            <span
              key={area}
              className="rounded-md border border-neutral-200 px-3 py-1 text-sm text-neutral-700 dark:border-neutral-800 dark:text-neutral-300"
            >
              {area}
            </span>
          ))}
        </div>
      </div>

      <div className="space-y-5">
        <div className="flex items-end justify-between gap-4">
          <h2 className="text-xl font-medium">Selected Projects</h2>
          <Link
            className="text-sm text-neutral-600 hover:text-neutral-950 dark:text-neutral-400 dark:hover:text-neutral-100"
            href="/projects"
          >
            View all projects
          </Link>
        </div>
        <div className="space-y-4">
          {featuredProjects.map((project) => (
            <Link
              key={project.slug}
              href={`/projects/${project.slug}`}
              className="block rounded-md border border-neutral-200 p-4 transition-colors hover:border-neutral-400 dark:border-neutral-800 dark:hover:border-neutral-600"
            >
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-medium">{project.metadata.title}</h3>
                {project.metadata.featured ? (
                  <span className="rounded-md bg-neutral-100 px-2 py-1 text-xs text-neutral-700 dark:bg-neutral-900 dark:text-neutral-300">
                    Featured
                  </span>
                ) : null}
              </div>
              <p className="mt-2 text-sm leading-6 text-neutral-600 dark:text-neutral-400">
                {project.metadata.description}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {project.metadata.stack.slice(0, 4).map((tech) => (
                  <span
                    key={tech}
                    className="rounded-md border border-neutral-200 px-2 py-1 text-xs text-neutral-600 dark:border-neutral-800 dark:text-neutral-400"
                  >
                    {tech}
                  </span>
                ))}
              </div>
            </Link>
          ))}
        </div>
      </div>

      <div className="space-y-5">
        <div className="flex items-end justify-between gap-4">
          <h2 className="text-xl font-medium">Recent Writing</h2>
          <Link
            className="text-sm text-neutral-600 hover:text-neutral-950 dark:text-neutral-400 dark:hover:text-neutral-100"
            href="/blog"
          >
            View all writing
          </Link>
        </div>
        <div className="space-y-0">
          {featuredPosts.map((post) => (
            <article
              key={post.slug}
              className="border-b border-neutral-200 py-5 first:pt-0 last:border-0 dark:border-neutral-800"
            >
              <Link
                href={`/blog/${post.slug}`}
                className="block space-y-1 transition-opacity hover:opacity-80"
              >
                <h3 className="font-medium">{post.metadata.title}</h3>
                <p className="text-sm leading-6 text-neutral-600 dark:text-neutral-400">
                  {post.metadata.description}
                </p>
              </Link>
              <div className="flex flex-wrap gap-2 pt-2">
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
    </section>
  );
}
