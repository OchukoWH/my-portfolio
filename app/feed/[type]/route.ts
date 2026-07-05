import { getBlogPosts } from "app/lib/posts";
import { metaData } from "app/lib/config";

type Params = {
  params: Promise<{ type: string }>;
};

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function postUrl(slug: string) {
  return `${metaData.baseUrl}/blog/${slug}`;
}

function getUpdatedDate() {
  return (
    getBlogPosts()[0]?.metadata.modified ??
    getBlogPosts()[0]?.metadata.date ??
    new Date().toISOString()
  );
}

function rssFeed() {
  const posts = getBlogPosts();
  const items = posts
    .map((post) => {
      const url = postUrl(post.slug);

      return `
        <item>
          <title>${escapeXml(post.metadata.title)}</title>
          <link>${url}</link>
          <guid>${url}</guid>
          <description>${escapeXml(post.metadata.description)}</description>
          <pubDate>${new Date(post.metadata.date).toUTCString()}</pubDate>
          ${post.metadata.tags
            .map((tag) => `<category>${escapeXml(tag)}</category>`)
            .join("")}
        </item>`;
    })
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
    <rss version="2.0">
      <channel>
        <title>${escapeXml(metaData.name)}</title>
        <link>${metaData.baseUrl}</link>
        <description>${escapeXml(metaData.description)}</description>
        <lastBuildDate>${new Date(getUpdatedDate()).toUTCString()}</lastBuildDate>
        ${items}
      </channel>
    </rss>`;
}

function atomFeed() {
  const posts = getBlogPosts();
  const entries = posts
    .map((post) => {
      const url = postUrl(post.slug);
      const updated = post.metadata.modified ?? post.metadata.date;

      return `
        <entry>
          <title>${escapeXml(post.metadata.title)}</title>
          <link href="${url}" />
          <id>${url}</id>
          <published>${new Date(post.metadata.date).toISOString()}</published>
          <updated>${new Date(updated).toISOString()}</updated>
          <summary>${escapeXml(post.metadata.description)}</summary>
          <author><name>${escapeXml(metaData.name)}</name></author>
        </entry>`;
    })
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
    <feed xmlns="http://www.w3.org/2005/Atom">
      <title>${escapeXml(metaData.name)}</title>
      <link href="${metaData.baseUrl}" />
      <link href="${metaData.baseUrl}/atom.xml" rel="self" />
      <id>${metaData.baseUrl}</id>
      <updated>${new Date(getUpdatedDate()).toISOString()}</updated>
      ${entries}
    </feed>`;
}

function jsonFeed() {
  const posts = getBlogPosts();

  return JSON.stringify({
    version: "https://jsonfeed.org/version/1.1",
    title: metaData.name,
    home_page_url: metaData.baseUrl,
    feed_url: `${metaData.baseUrl}/feed.json`,
    description: metaData.description,
    authors: [{ name: metaData.name }],
    items: posts.map((post) => ({
      id: postUrl(post.slug),
      url: postUrl(post.slug),
      title: post.metadata.title,
      summary: post.metadata.description,
      date_published: new Date(post.metadata.date).toISOString(),
      date_modified: new Date(
        post.metadata.modified ?? post.metadata.date
      ).toISOString(),
      tags: post.metadata.tags,
      author: { name: metaData.name },
    })),
  });
}

export async function GET(_: Request, { params }: Params) {
  const { type } = await params;

  if (type === "rss.xml") {
    return new Response(rssFeed(), {
      headers: { "Content-Type": "application/rss+xml; charset=utf-8" },
    });
  }

  if (type === "atom.xml") {
    return new Response(atomFeed(), {
      headers: { "Content-Type": "application/atom+xml; charset=utf-8" },
    });
  }

  if (type === "feed.json") {
    return new Response(jsonFeed(), {
      headers: { "Content-Type": "application/feed+json; charset=utf-8" },
    });
  }

  return new Response("Not found", { status: 404 });
}
