import { getBlogPosts, slugifyTag } from "./posts";
import { getProjects } from "./projects";

export type KnowledgeGraphItem = {
  title: string;
  description: string;
  href: string;
  date: string;
  tags: string[];
  sharedTags: string[];
};

export type KnowledgeGraph = {
  articles: KnowledgeGraphItem[];
  projects: KnowledgeGraphItem[];
};

type SourceContent = {
  type: "blog" | "project";
  slug: string;
  tags: string[];
};

function getSharedTags(sourceTags: Set<string>, itemTags: string[]) {
  return itemTags.filter((tag) => sourceTags.has(slugifyTag(tag)));
}

function rankBySharedTags<T extends KnowledgeGraphItem>(items: T[]) {
  return items.sort((a, b) => {
    if (b.sharedTags.length !== a.sharedTags.length) {
      return b.sharedTags.length - a.sharedTags.length;
    }

    return new Date(b.date).getTime() - new Date(a.date).getTime();
  });
}

export function getKnowledgeGraph(
  source: SourceContent,
  { articleLimit = 4, projectLimit = 4 } = {}
): KnowledgeGraph {
  const sourceTags = new Set(source.tags.map(slugifyTag));

  const articles = getBlogPosts()
    .filter((post) => source.type !== "blog" || post.slug !== source.slug)
    .map((post) => ({
      title: post.metadata.title,
      description: post.metadata.description,
      href: `/blog/${post.slug}`,
      date: post.metadata.date,
      tags: post.metadata.tags,
      sharedTags: getSharedTags(sourceTags, post.metadata.tags),
    }))
    .filter((post) => post.sharedTags.length > 0);

  const projects = getProjects()
    .filter(
      (project) => source.type !== "project" || project.slug !== source.slug
    )
    .map((project) => ({
      title: project.metadata.title,
      description: project.metadata.description,
      href: `/projects/${project.slug}`,
      date: project.metadata.date,
      tags: project.metadata.tags,
      sharedTags: getSharedTags(sourceTags, project.metadata.tags),
    }))
    .filter((project) => project.sharedTags.length > 0);

  return {
    articles: rankBySharedTags(articles).slice(0, articleLimit),
    projects: rankBySharedTags(projects).slice(0, projectLimit),
  };
}
