import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import go from "highlight.js/lib/languages/go";
import ini from "highlight.js/lib/languages/ini";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import nginx from "highlight.js/lib/languages/nginx";
import python from "highlight.js/lib/languages/python";
import shell from "highlight.js/lib/languages/shell";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import type { Components } from "react-markdown";
import { CodeBlock } from "./code-block";

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/<[^>]*>/g, "")
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

function getText(children: unknown): string {
  if (typeof children === "string" || typeof children === "number") {
    return String(children);
  }

  if (Array.isArray(children)) {
    return children.map(getText).join("");
  }

  if (
    children &&
    typeof children === "object" &&
    "props" in children &&
    children.props &&
    typeof children.props === "object" &&
    "children" in children.props
  ) {
    return getText(children.props.children);
  }

  return "";
}

const markdownComponents: Components = {
  pre({ children }) {
    return <CodeBlock code={getText(children)}>{children}</CodeBlock>;
  },
  a({ href, children, node, ...props }) {
    const target = href?.startsWith("http")
      ? { target: "_blank", rel: "noopener noreferrer" }
      : {};

    return (
      <a href={href} {...target} {...props}>
        {children}
      </a>
    );
  },
  img({ alt, src, node, ...props }) {
    return <img src={src} alt={alt ?? ""} loading="lazy" {...props} />;
  },
  h2({ children, node, ...props }) {
    const id = slugify(getText(children));

    return (
      <h2 id={id} {...props}>
        <a href={`#${id}`} className="anchor" />
        {children}
      </h2>
    );
  },
  h3({ children, node, ...props }) {
    const id = slugify(getText(children));

    return (
      <h3 id={id} {...props}>
        <a href={`#${id}`} className="anchor" />
        {children}
      </h3>
    );
  },
  h4({ children, node, ...props }) {
    const id = slugify(getText(children));

    return (
      <h4 id={id} {...props}>
        <a href={`#${id}`} className="anchor" />
        {children}
      </h4>
    );
  },
};

const rehypeHighlightOptions = {
  aliases: {
    bash: ["sh"],
    shell: ["shell-session"],
    javascript: ["js"],
    typescript: ["ts"],
    yaml: ["yml"],
    xml: ["html"],
    ini: ["terraform", "hcl", "toml"],
    markdown: ["md"],
    plaintext: ["text"],
  },
  languages: {
    bash,
    css,
    dockerfile,
    go,
    ini,
    javascript,
    json,
    markdown,
    nginx,
    python,
    shell,
    sql,
    typescript,
    xml,
    yaml,
  },
  plainText: ["text", "plaintext"],
};

export function Markdown({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[[rehypeHighlight, rehypeHighlightOptions]]}
      components={markdownComponents}
    >
      {content}
    </ReactMarkdown>
  );
}
