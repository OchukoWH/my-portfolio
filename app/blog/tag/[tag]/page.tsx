import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  getBlogPosts,
  getBlogTag,
  getBlogTags,
} from "app/lib/posts";
import { metaData } from "app/lib/config";
import { BlogBrowser } from "app/blog/blog-browser";

type Params = {
  params: Promise<{ tag: string }>;
};

export function generateStaticParams() {
  return getBlogTags().map((tag) => ({
    tag: tag.slug,
  }));
}

export async function generateMetadata({
  params,
}: Params): Promise<Metadata | undefined> {
  const { tag: tagSlug } = await params;
  const tag = getBlogTag(tagSlug);

  if (!tag) {
    return;
  }

  const title = `${tag.name} Articles`;
  const description = `Technical articles tagged ${tag.name} by Ochuko Whoro.`;

  return {
    title,
    description,
    alternates: {
      canonical: `${metaData.baseUrl}/blog/tag/${tag.slug}`,
    },
    openGraph: {
      title,
      description,
      url: `${metaData.baseUrl}/blog/tag/${tag.slug}`,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}

export default async function BlogTagPage({ params }: Params) {
  const { tag: tagSlug } = await params;
  const tag = getBlogTag(tagSlug);

  if (!tag) {
    notFound();
  }

  const posts = getBlogPosts().map(({ content, ...post }) => post);
  const tags = getBlogTags();

  return (
    <section className="mx-auto w-full max-w-[760px] space-y-10">
      <div className="space-y-3">
        <p className="text-sm font-medium uppercase tracking-[0.16em] text-neutral-500 dark:text-neutral-400">
          Blog tag
        </p>
        <h1 className="text-3xl font-semibold">{tag.name}</h1>
        <p className="text-neutral-600 dark:text-neutral-400">
          Articles tagged {tag.name}, generated from Markdown frontmatter.
        </p>
      </div>

      <BlogBrowser
        posts={posts}
        tags={tags}
        initialTag={tag.slug}
        titlePrefix={`Filtered by ${tag.name}`}
      />
    </section>
  );
}
