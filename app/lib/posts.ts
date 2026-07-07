import fs from "fs";
import path from "path";

export type BlogPostMetadata = {
  title: string;
  description: string;
  date: string;
  cover: string;
  tags: string[];
  published: boolean;
};

export type BlogPost = {
  slug: string;
  content: string;
  metadata: BlogPostMetadata;
};

export type BlogTag = {
  name: string;
  slug: string;
  count: number;
};

const BLOG_DIR = path.join(process.cwd(), "content", "blog");

function parseBoolean(value: string | undefined) {
  return value?.toLowerCase() === "true";
}

function parseTags(value: string | undefined) {
  if (!value) {
    return [];
  }

  return value
    .replace(/^\[(.*)\]$/, "$1")
    .split(",")
    .map((tag) => tag.trim().replace(/^['"](.*)['"]$/, "$1"))
    .filter(Boolean);
}

function parseFrontmatter(fileContent: string) {
  const frontmatterRegex = /^---\s*([\s\S]*?)\s*---/;
  const match = frontmatterRegex.exec(fileContent);

  if (!match) {
    throw new Error("Markdown post is missing frontmatter.");
  }

  const rawMetadata: Record<string, string> = {};
  const content = fileContent.replace(frontmatterRegex, "").trim();

  match[1]
    .trim()
    .split("\n")
    .forEach((line) => {
      const [key, ...valueParts] = line.split(":");
      if (!key || valueParts.length === 0) {
        return;
      }

      rawMetadata[key.trim()] = valueParts
        .join(":")
        .trim()
        .replace(/^['"](.*)['"]$/, "$1");
    });

  const metadata: BlogPostMetadata = {
    title: rawMetadata.title ?? "Untitled",
    description: rawMetadata.description ?? "",
    date: rawMetadata.date ?? new Date().toISOString().split("T")[0],
    cover: rawMetadata.cover ?? "",
    tags: parseTags(rawMetadata.tags),
    published: parseBoolean(rawMetadata.published),
  };

  return { metadata, content };
}

function getMarkdownFiles(dir: string) {
  if (!fs.existsSync(dir)) {
    return [];
  }

  return fs.readdirSync(dir).filter((file) => path.extname(file) === ".md");
}

export function slugifyTag(tag: string) {
  return tag
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

export function getBlogPosts({ includeDrafts = false } = {}) {
  return getMarkdownFiles(BLOG_DIR)
    .map((file) => {
      const rawContent = fs.readFileSync(path.join(BLOG_DIR, file), "utf-8");
      const { metadata, content } = parseFrontmatter(rawContent);

      return {
        metadata,
        content,
        slug: path.basename(file, ".md"),
      };
    })
    .filter((post) => includeDrafts || post.metadata.published)
    .sort(
      (a, b) =>
        new Date(b.metadata.date).getTime() -
        new Date(a.metadata.date).getTime()
    );
}

export function getBlogPost(slug: string) {
  return getBlogPosts().find((post) => post.slug === slug);
}

export function getBlogTags(): BlogTag[] {
  const counts = new Map<string, BlogTag>();

  getBlogPosts().forEach((post) => {
    post.metadata.tags.forEach((tag) => {
      const slug = slugifyTag(tag);
      const existing = counts.get(slug);

      counts.set(slug, {
        name: existing?.name ?? tag,
        slug,
        count: (existing?.count ?? 0) + 1,
      });
    });
  });

  return Array.from(counts.values()).sort((a, b) => {
    if (b.count !== a.count) {
      return b.count - a.count;
    }

    return a.name.localeCompare(b.name);
  });
}

export function getBlogTag(slug: string) {
  return getBlogTags().find((tag) => tag.slug === slug);
}

export function getBlogPostsByTag(slug: string) {
  return getBlogPosts().filter((post) =>
    post.metadata.tags.some((tag) => slugifyTag(tag) === slug)
  );
}

export function getAdjacentPosts(slug: string) {
  const posts = getBlogPosts();
  const index = posts.findIndex((post) => post.slug === slug);

  return {
    previous: index >= 0 ? posts[index + 1] : undefined,
    next: index > 0 ? posts[index - 1] : undefined,
  };
}

export function getRelatedPosts(slug: string, limit = 3) {
  const post = getBlogPost(slug);

  if (!post) {
    return [];
  }

  const postTags = new Set(post.metadata.tags.map(slugifyTag));

  return getBlogPosts()
    .filter((candidate) => candidate.slug !== slug)
    .map((candidate) => {
      const score = candidate.metadata.tags.filter((tag) =>
        postTags.has(slugifyTag(tag))
      ).length;

      return { candidate, score };
    })
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }

      return (
        new Date(b.candidate.metadata.date).getTime() -
        new Date(a.candidate.metadata.date).getTime()
      );
    })
    .slice(0, limit)
    .map(({ candidate }) => candidate);
}

export function formatDate(date: string) {
  const targetDate = new Date(date.includes("T") ? date : `${date}T00:00:00`);

  return targetDate.toLocaleString("en-us", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}
