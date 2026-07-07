# Ochuko Whoro Portfolio

Personal portfolio and blog for [ochukowhoro.com](https://ochukowhoro.com), built with Next.js, TypeScript, and Tailwind CSS.

## Development

```bash
npm run dev
npm run build
```

## Blog Posts

Posts live in `content/blog/*.md` and use plain Markdown with frontmatter:

```md
---
title: "Post title"
description: "Short SEO-friendly summary."
date: "2026-06-30"
tags: "Kubernetes, Go, AWS"
cover: "/og/blog/kubernetes-notes.png"
published: true
---

Write the post in Markdown.
```

The filename becomes the slug. For example, `content/blog/kubernetes-notes.md` is published at `/blog/kubernetes-notes`.

Only posts with `published: true` are listed, routed, included in feeds, and used for tag pages.

Supported post features include Markdown headings, paragraphs, links, lists, blockquotes, inline code, fenced code blocks with syntax highlighting, tags, RSS/Atom/JSON feeds, sitemap entries, and social preview images.

To add a preview image to a blog post:

- Add a 1200x630 image to `public/og/blog/`.
- Add `cover: "/og/blog/image-name.png"` to the Markdown frontmatter.
- If `cover` is omitted, the post uses `/og/default-blog.png`.

## Projects

Projects live in `content/projects/*.md` and use Markdown frontmatter:

```md
---
title: "Kubernetes Rate Limiter"
description: "Short project summary."
date: "2026-06-30"
status: "In progress"
featured: true
github: "https://github.com/username/repo"
demo: "https://example.com"
cover: "/og/projects/kubernetes-rate-limiter.png"
tags: "Kubernetes, Go, Platform Engineering"
stack: "Go, Kubernetes, Prometheus"
published: true
---

## Overview

## Motivation

## Architecture

## Design decisions

## Challenges

## Lessons learned

## Screenshots

## Future improvements
```

The filename becomes the project slug. For example, `content/projects/cni-plugin.md` is published at `/projects/cni-plugin`.

Only projects with `published: true` are listed, routed, included in the sitemap, and used for related content.

To add a preview image to a project:

- Add a 1200x630 image to `public/og/projects/`.
- Add `cover: "/og/projects/image-name.png"` to the Markdown frontmatter.
- If `cover` is omitted, the project uses `/og/default-project.png`.
