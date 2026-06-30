import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AuthorCard } from "app/components/author-card";
import { KnowledgeGraph } from "app/components/knowledge-graph";
import { Markdown } from "app/components/markdown";
import {
  formatDate,
  getAdjacentPosts,
  getBlogPost,
  getBlogPosts,
} from "app/lib/posts";
import { getKnowledgeGraph } from "app/lib/related";
import { metaData } from "app/lib/config";

type Params = {
  params: Promise<{ slug: string }>;
};

export async function generateStaticParams() {
  return getBlogPosts().map((post) => ({
    slug: post.slug,
  }));
}

export async function generateMetadata({
  params,
}: Params): Promise<Metadata | undefined> {
  const { slug } = await params;
  const post = getBlogPost(slug);

  if (!post) {
    return;
  }

  const ogImage = `${metaData.baseUrl}/og?title=${encodeURIComponent(
    post.metadata.title
  )}`;

  return {
    title: post.metadata.title,
    description: post.metadata.description,
    openGraph: {
      title: post.metadata.title,
      description: post.metadata.description,
      type: "article",
      publishedTime: post.metadata.date,
      url: `${metaData.baseUrl}/blog/${post.slug}`,
      images: [{ url: ogImage }],
    },
    twitter: {
      card: "summary_large_image",
      title: post.metadata.title,
      description: post.metadata.description,
      images: [ogImage],
    },
  };
}

export default async function Blog({ params }: Params) {
  const { slug } = await params;
  const post = getBlogPost(slug);

  if (!post) {
    notFound();
  }

  const { previous, next } = getAdjacentPosts(slug);
  const graph = getKnowledgeGraph({
    type: "blog",
    slug: post.slug,
    tags: post.metadata.tags,
  });

  return (
    <section>
      <script
        type="application/ld+json"
        suppressHydrationWarning
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "BlogPosting",
            headline: post.metadata.title,
            datePublished: post.metadata.date,
            dateModified: post.metadata.date,
            description: post.metadata.description,
            url: `${metaData.baseUrl}/blog/${post.slug}`,
            author: {
              "@type": "Person",
              name: metaData.name,
            },
            keywords: post.metadata.tags,
          }),
        }}
      />

      <div className="mx-auto grid max-w-[900px] gap-8 lg:grid-cols-[minmax(0,600px)_240px] lg:items-start">
        <article>
          <header className="mb-12 space-y-5 border-b border-neutral-200 pb-8 dark:border-neutral-800">
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-neutral-500 dark:text-neutral-400">
              <span>Ochuko Whoro</span>
              <time dateTime={post.metadata.date}>
                {formatDate(post.metadata.date)}
              </time>
              <span>{post.readingTime}</span>
            </div>
            <h1 className="title text-4xl font-semibold leading-tight text-neutral-950 dark:text-neutral-50">
              {post.metadata.title}
            </h1>
            <p className="text-lg leading-8 text-neutral-700 dark:text-neutral-300">
              {post.metadata.description}
            </p>
            <div className="flex flex-wrap gap-2">
              {post.metadata.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-md border border-neutral-200 px-2 py-1 text-xs text-neutral-600 dark:border-neutral-800 dark:text-neutral-400"
                >
                  {tag}
                </span>
              ))}
            </div>
          </header>

          <div className="prose prose-lg prose-neutral dark:prose-invert">
            <Markdown content={post.content} />
          </div>
          <AuthorCard />
        </article>
        <KnowledgeGraph graph={graph} />
      </div>

      <nav className="mx-auto mt-14 grid max-w-[600px] gap-4 border-t border-neutral-200 pt-8 text-sm dark:border-neutral-800 sm:grid-cols-2">
        {previous ? (
          <Link href={`/blog/${previous.slug}`} className="space-y-1">
            <span className="block text-neutral-500 dark:text-neutral-400">
              Previous
            </span>
            <span className="font-medium">{previous.metadata.title}</span>
          </Link>
        ) : (
          <div className="space-y-1 text-neutral-400 dark:text-neutral-600">
            <span className="block">Previous</span>
            <span>No previous article</span>
          </div>
        )}
        {next ? (
          <Link href={`/blog/${next.slug}`} className="space-y-1 sm:text-right">
            <span className="block text-neutral-500 dark:text-neutral-400">
              Next
            </span>
            <span className="font-medium">{next.metadata.title}</span>
          </Link>
        ) : (
          <div className="space-y-1 text-neutral-400 dark:text-neutral-600 sm:text-right">
            <span className="block">Next</span>
            <span>No next article</span>
          </div>
        )}
      </nav>
    </section>
  );
}
