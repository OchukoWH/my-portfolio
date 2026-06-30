import type { Metadata } from "next";
import { getBlogPosts, getBlogTags } from "app/lib/posts";
import { BlogBrowser } from "./blog-browser";

export const metadata: Metadata = {
  title: "Blog",
  description:
    "Writing by Ochuko Whoro on Kubernetes, Go, Linux, AWS, Terraform, cloud native systems, and platform engineering.",
};

export default function BlogPosts() {
  const posts = getBlogPosts().map(({ content, ...post }) => post);
  const tags = getBlogTags();

  return (
    <section className="mx-auto w-full max-w-[760px] space-y-10">
      <div className="space-y-3">
        <h1 className="text-3xl font-semibold">Blog</h1>
        <p className="text-neutral-600 dark:text-neutral-400">
          Practical notes on Kubernetes, Linux, Go, AWS, Terraform, cloud
          native operations, and platform engineering.
        </p>
      </div>

      <BlogBrowser posts={posts} tags={tags} />
    </section>
  );
}
