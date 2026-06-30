import { highlight } from "sugar-high";

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/<[^>]*>/g, "")
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

function renderInline(markdown: string) {
  let html = escapeHtml(markdown);

  html = html.replace(
    /!\[([^\]]*)\]\((https?:\/\/[^)\s]+|\/[^)\s]+)\)/g,
    (_, alt: string, src: string) =>
      `<img src="${src}" alt="${alt}" loading="lazy" />`
  );
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/_([^_]+)_/g, "<em>$1</em>");
  html = html.replace(
    /\[([^\]]+)\]\((https?:\/\/[^)\s]+|\/[^)\s]+|#[^)\s]+)\)/g,
    (_, label: string, href: string) => {
      const target = href.startsWith("http")
        ? ' target="_blank" rel="noopener noreferrer"'
        : "";

      return `<a href="${href}"${target}>${label}</a>`;
    }
  );

  return html;
}

function isTableStart(lines: string[], index: number) {
  return (
    index + 1 < lines.length &&
    lines[index].trim().startsWith("|") &&
    lines[index + 1].trim().startsWith("|") &&
    /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(lines[index + 1].trim())
  );
}

function splitTableRow(row: string) {
  return row
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function renderTable(lines: string[]) {
  const [headerLine, , ...bodyLines] = lines;
  const headers = splitTableRow(headerLine);
  const rows = bodyLines.map(splitTableRow);

  return `<table><thead><tr>${headers
    .map((header) => `<th>${renderInline(header)}</th>`)
    .join("")}</tr></thead><tbody>${rows
    .map(
      (row) =>
        `<tr>${row
          .map((cell) => `<td>${renderInline(cell)}</td>`)
          .join("")}</tr>`
    )
    .join("")}</tbody></table>`;
}

function renderCallout(lines: string[]) {
  const firstLine = lines[0].replace(/^>\s?/, "").trim();
  const titleMatch = /^\[!(NOTE|TIP|WARNING|IMPORTANT)\]\s*(.*)$/i.exec(
    firstLine
  );

  if (!titleMatch) {
    return `<blockquote>${lines
      .map((line) => `<p>${renderInline(line.replace(/^>\s?/, ""))}</p>`)
      .join("")}</blockquote>`;
  }

  const title = titleMatch[2] || titleMatch[1].toLowerCase();
  const body = lines
    .slice(1)
    .map((line) => line.replace(/^>\s?/, "").trim())
    .filter(Boolean)
    .join(" ");

  return `<aside class="callout"><p><strong>${renderInline(
    title
  )}</strong></p><p>${renderInline(body)}</p></aside>`;
}

function flushParagraph(paragraph: string[], html: string[]) {
  if (paragraph.length === 0) {
    return;
  }

  html.push(`<p>${renderInline(paragraph.join(" "))}</p>`);
  paragraph.length = 0;
}

function flushList(list: string[], html: string[]) {
  if (list.length === 0) {
    return;
  }

  html.push(
    `<ul>${list.map((item) => `<li>${renderInline(item)}</li>`).join("")}</ul>`
  );
  list.length = 0;
}

export function renderMarkdown(markdown: string) {
  const html: string[] = [];
  const paragraph: string[] = [];
  const list: string[] = [];
  const lines = markdown.split("\n");
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();

    if (trimmed.startsWith("```")) {
      flushParagraph(paragraph, html);
      flushList(list, html);

      const language = trimmed.replace(/^```/, "").trim().toLowerCase();
      const code: string[] = [];
      index += 1;

      while (index < lines.length && !lines[index].trim().startsWith("```")) {
        code.push(lines[index]);
        index += 1;
      }

      if (language === "mermaid") {
        html.push(
          `<pre class="mermaid-diagram"><code>${escapeHtml(
            code.join("\n")
          )}</code></pre>`
        );
      } else {
        html.push(`<pre><code>${highlight(code.join("\n"))}</code></pre>`);
      }
      index += 1;
      continue;
    }

    if (!trimmed) {
      flushParagraph(paragraph, html);
      flushList(list, html);
      index += 1;
      continue;
    }

    const heading = /^(#{2,4})\s+(.+)$/.exec(trimmed);
    if (heading) {
      flushParagraph(paragraph, html);
      flushList(list, html);

      const level = heading[1].length;
      const text = renderInline(heading[2]);
      const id = slugify(heading[2]);

      html.push(
        `<h${level} id="${id}"><a href="#${id}" class="anchor"></a>${text}</h${level}>`
      );
      index += 1;
      continue;
    }

    if (isTableStart(lines, index)) {
      flushParagraph(paragraph, html);
      flushList(list, html);

      const tableLines: string[] = [];
      while (index < lines.length && lines[index].trim().startsWith("|")) {
        tableLines.push(lines[index]);
        index += 1;
      }

      html.push(renderTable(tableLines));
      continue;
    }

    if (trimmed.startsWith("> ")) {
      flushParagraph(paragraph, html);
      flushList(list, html);

      const quoteLines: string[] = [];
      while (index < lines.length && lines[index].trim().startsWith(">")) {
        quoteLines.push(lines[index]);
        index += 1;
      }

      html.push(renderCallout(quoteLines));
      continue;
    }

    const listItem = /^[-*]\s+(.+)$/.exec(trimmed);
    if (listItem) {
      flushParagraph(paragraph, html);
      list.push(listItem[1]);
      index += 1;
      continue;
    }

    paragraph.push(trimmed);
    index += 1;
  }

  flushParagraph(paragraph, html);
  flushList(list, html);

  return html.join("\n");
}

export function Markdown({ content }: { content: string }) {
  return (
    <div
      dangerouslySetInnerHTML={{
        __html: renderMarkdown(content),
      }}
    />
  );
}
