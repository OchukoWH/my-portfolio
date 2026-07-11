import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Markdown } from "app/components/markdown";
import {
  formatDate,
  getBlogPost,
  getBlogPostSeriesContext,
  getBlogPosts,
  getRelatedPosts,
  getSeriesPartLabel,
  getSeriesPartTitle,
} from "app/lib/posts";
import { absoluteUrl, metaData } from "app/lib/config";

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

  const ogImage = absoluteUrl(
    post.metadata.cover || metaData.defaultBlogOgImage
  );
  const url = `${metaData.baseUrl}/blog/${post.slug}`;
  const modifiedTime = post.metadata.modified ?? post.metadata.date;

  return {
    title: post.metadata.title,
    description: post.metadata.description,
    keywords: post.metadata.tags,
    authors: [{ name: "Ochuko Whoro" }],
    alternates: {
      canonical: url,
    },
    openGraph: {
      title: post.metadata.title,
      description: post.metadata.description,
      type: "article",
      publishedTime: post.metadata.date,
      modifiedTime,
      url,
      images: [
        {
          url: ogImage,
          width: 1200,
          height: 630,
          alt: post.metadata.title,
        },
      ],
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

  const relatedPosts = getRelatedPosts(slug, 3);
  const seriesContext = getBlogPostSeriesContext(slug);
  const url = `${metaData.baseUrl}/blog/${post.slug}`;
  const modifiedDate = post.metadata.modified ?? post.metadata.date;
  const ogImage = absoluteUrl(
    post.metadata.cover || metaData.defaultBlogOgImage
  );

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
            dateModified: modifiedDate,
            description: post.metadata.description,
            mainEntityOfPage: url,
            url,
            image: ogImage,
            author: {
              "@type": "Person",
              name: "Ochuko Whoro",
            },
            publisher: {
              "@type": "Person",
              name: "Ochuko Whoro",
            },
            keywords: post.metadata.tags,
          }),
        }}
      />

      <div className="article-shell blog-article-shell">
        <article>
          <header className="blog-article-header">
            <div className="blog-article-meta">
              <Link
                href="/"
                className="hover:text-neutral-950 dark:hover:text-neutral-100"
              >
                Ochuko Whoro
              </Link>
              <time dateTime={post.metadata.date}>
                {formatDate(post.metadata.date)}
              </time>
            </div>
            <h1 className="article-title blog-article-title title">
              {post.metadata.title}
            </h1>
            <div className="blog-article-tags">
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

          <div className="article-content blog-article-content">
            <Markdown content={post.content} />
          </div>
          {seriesContext?.next ? (
            <section className="blog-series-nav" aria-labelledby="series-nav-title">
              <div>
                <p className="blog-series-nav-kicker">
                  Next in the series
                </p>
                <h2 id="series-nav-title">{seriesContext.series.title}</h2>
              </div>
              <div className="blog-series-nav-links">
                <Link href={`/blog/${seriesContext.next.slug}`}>
                  <span>{getSeriesPartLabel(seriesContext.next)}</span>
                  <strong>{getSeriesPartTitle(seriesContext.next)}</strong>
                </Link>
              </div>
            </section>
          ) : null}
          {relatedPosts.length > 0 ? (
            <section className="mx-auto mt-16 max-w-[768px] border-t border-neutral-200 pt-8 dark:border-neutral-800">
              <h2 className="text-xl font-medium">
                More articles you might like
              </h2>
              <div className="mt-5 grid gap-4">
                {relatedPosts.map((relatedPost) => (
                  <Link
                    key={relatedPost.slug}
                    href={`/blog/${relatedPost.slug}`}
                    className="block rounded-md border border-neutral-200 p-4 transition-colors hover:border-neutral-400 dark:border-neutral-800 dark:hover:border-neutral-600"
                  >
                    <h3 className="font-medium text-neutral-950 dark:text-neutral-50">
                      {relatedPost.metadata.title}
                    </h3>
                    <p className="mt-2 text-sm leading-6 text-neutral-600 dark:text-neutral-400">
                      {relatedPost.metadata.description}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-sm text-neutral-500 dark:text-neutral-400">
                      <time dateTime={relatedPost.metadata.date}>
                        {formatDate(relatedPost.metadata.date)}
                      </time>
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
