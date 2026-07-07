"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { BlogPost, BlogTag } from "app/lib/posts";

type BlogSummary = Omit<BlogPost, "content">;

type SortOrder = "newest" | "oldest";

function formatDate(date: string) {
  const targetDate = new Date(date.includes("T") ? date : `${date}T00:00:00`);

  return targetDate.toLocaleString("en-us", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function slugifyTag(tag: string) {
  return tag
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

export function BlogBrowser({
  posts,
  tags,
  initialTag = "All",
}: {
  posts: BlogSummary[];
  tags: BlogTag[];
  initialTag?: string;
  titlePrefix?: string;
}) {
  const [activeTag, setActiveTag] = useState(initialTag);

  const filteredPosts = useMemo(() => {
    return posts
      .filter((post) => {
        const matchesTag =
          activeTag === "All" ||
          post.metadata.tags.some((tag) => slugifyTag(tag) === activeTag);

        return matchesTag;
      })
  }, [activeTag, posts]);

  return (
    <div className="space-y-9">
      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-[0.16em] text-neutral-500 dark:text-neutral-400">
          Popular tags
        </h2>
        <div className="flex flex-wrap gap-2">
          {tags.slice(0, 8).map((tag) => (
            <button
              key={tag.slug}
              type="button"
              onClick={() => setActiveTag(tag.slug)}
              className="rounded-md border border-neutral-200 px-3 py-1 text-xs text-neutral-700 transition-colors hover:border-neutral-400 dark:border-neutral-800 dark:text-neutral-300 dark:hover:border-neutral-600"
            >
              {tag.name} ({tag.count})
            </button>
          ))}
        </div>
      </section>

      <div className="space-y-9">
        {filteredPosts.map((post) => (
          <article
            key={post.slug}
            className="border-b border-neutral-200 pb-8 last:border-0 dark:border-neutral-800"
          >
            <div className="space-y-3">
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-neutral-500 dark:text-neutral-400">
                <time dateTime={post.metadata.date}>
                  {formatDate(post.metadata.date)}
                </time>
              </div>

              <Link href={`/blog/${post.slug}`} className="block space-y-2">
                <h2 className="text-2xl font-semibold leading-snug text-neutral-950 transition-opacity hover:opacity-80 dark:text-neutral-50">
                  {post.metadata.title}
                </h2>
                <p className="text-sm leading-6 text-neutral-600 dark:text-neutral-400">
                  {post.metadata.description}
                </p>
              </Link>

              <div className="flex flex-wrap gap-2 pt-1">
                {post.metadata.tags.map((tag) => {
                  const tagSlug = slugifyTag(tag);

                  return (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => setActiveTag(tagSlug)}
                      className="rounded-md border border-neutral-200 px-2 py-1 text-xs text-neutral-600 transition-colors hover:border-neutral-400 dark:border-neutral-800 dark:text-neutral-400 dark:hover:border-neutral-600"
                    >
                      {tag}
                    </button>
                  );
                })}
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
