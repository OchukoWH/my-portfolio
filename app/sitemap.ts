import { MetadataRoute } from "next";
import { getBlogPosts, getBlogSeries, getBlogTags } from "./lib/posts";
import { getProjects } from "./lib/projects";
import { metaData } from "./lib/config";

const BaseUrl = metaData.baseUrl.endsWith("/")
  ? metaData.baseUrl
  : `${metaData.baseUrl}/`;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  let blogs = getBlogPosts().map((post) => ({
    url: `${BaseUrl}blog/${post.slug}`,
    lastModified: post.metadata.date,
  }));

  let blogTags = getBlogTags().map((tag) => ({
    url: `${BaseUrl}blog/tag/${tag.slug}`,
    lastModified: new Date().toISOString().split("T")[0],
  }));

  let blogSeries = getBlogSeries().map((series) => ({
    url: `${BaseUrl}blog/series/${series.slug}`,
    lastModified:
      series.posts[series.posts.length - 1]?.metadata.modified ??
      series.posts[series.posts.length - 1]?.metadata.date ??
      new Date().toISOString().split("T")[0],
  }));

  let projects = getProjects().map((project) => ({
    url: `${BaseUrl}projects/${project.slug}`,
    lastModified: project.metadata.date,
  }));

  let routes = [
    "",
    "projects",
    "blog",
    "certifications",
  ].map((route) => ({
    url: `${BaseUrl}${route}`,
    lastModified: new Date().toISOString().split("T")[0],
  }));

  return [...routes, ...blogs, ...blogTags, ...blogSeries, ...projects];
}
