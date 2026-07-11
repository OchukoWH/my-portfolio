import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  formatDate,
  getBlogSeries,
  getBlogSeriesBySlug,
  getReadingTime,
  getSeriesPartLabel,
} from "app/lib/posts";
import { absoluteUrl, metaData } from "app/lib/config";

type Params = {
  params: Promise<{ slug: string }>;
};

export async function generateStaticParams() {
  return getBlogSeries().map((series) => ({
    slug: series.slug,
  }));
}

export async function generateMetadata({
  params,
}: Params): Promise<Metadata | undefined> {
  const { slug } = await params;
  const series = getBlogSeriesBySlug(slug);

  if (!series) {
    return;
  }

  const url = `${metaData.baseUrl}/blog/series/${series.slug}`;
  const description = `All articles in the ${series.title} series, listed in reading order.`;
  const ogImage = absoluteUrl(metaData.defaultBlogOgImage);

  return {
    title: series.title,
    description,
    alternates: {
      canonical: url,
    },
    openGraph: {
      title: series.title,
      description,
      type: "website",
      url,
      images: [
        {
          url: ogImage,
          width: 1200,
          height: 630,
          alt: series.title,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: series.title,
      description,
      images: [ogImage],
    },
  };
}

export default async function BlogSeriesPage({ params }: Params) {
  const { slug } = await params;
  const series = getBlogSeriesBySlug(slug);

  if (!series) {
    notFound();
  }

  return (
    <section className="blog-series-page">
      <div className="space-y-3">
        <p className="blog-series-page-kicker">Series</p>
        <h1>{series.title}</h1>
        <p>
          {series.posts.length} {series.posts.length === 1 ? "article" : "articles"}{" "}
          in reading order.
        </p>
      </div>

      <div className="blog-series-list">
        {series.posts.map((post) => (
          <Link
            key={post.slug}
            href={`/blog/${post.slug}`}
            className="blog-series-list-item"
          >
            <span>{getSeriesPartLabel(post)}</span>
            <div>
              <h2>{post.metadata.title}</h2>
              <p>{post.metadata.description}</p>
              <div className="blog-series-list-meta">
                <time dateTime={post.metadata.date}>
                  {formatDate(post.metadata.date)}
                </time>
                <span>{getReadingTime(post.content)}</span>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
