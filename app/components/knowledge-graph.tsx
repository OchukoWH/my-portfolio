import Link from "next/link";
import type { KnowledgeGraph as KnowledgeGraphData } from "app/lib/related";

function GraphGroup({
  title,
  items,
}: {
  title: string;
  items: KnowledgeGraphData["articles"];
}) {
  if (items.length === 0) {
    return null;
  }

  return (
    <section className="space-y-3">
      <h2 className="text-xs font-medium uppercase tracking-[0.16em] text-neutral-500 dark:text-neutral-400">
        {title}
      </h2>
      <div className="space-y-3">
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="block rounded-md border border-neutral-200 p-3 transition-colors hover:border-neutral-400 dark:border-neutral-800 dark:hover:border-neutral-600"
          >
            <h3 className="text-sm font-medium leading-5 text-neutral-950 dark:text-neutral-50">
              {item.title}
            </h3>
            <p className="mt-1 line-clamp-2 text-xs leading-5 text-neutral-600 dark:text-neutral-400">
              {item.description}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {item.sharedTags.slice(0, 3).map((tag) => (
                <span
                  key={tag}
                  className="rounded-md bg-neutral-100 px-1.5 py-0.5 text-[11px] text-neutral-600 dark:bg-neutral-900 dark:text-neutral-400"
                >
                  {tag}
                </span>
              ))}
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

export function KnowledgeGraph({ graph }: { graph: KnowledgeGraphData }) {
  if (graph.articles.length === 0 && graph.projects.length === 0) {
    return null;
  }

  return (
    <aside className="space-y-6 lg:sticky lg:top-8">
      <div className="rounded-md border border-neutral-200 p-4 dark:border-neutral-800">
        <p className="mb-5 text-sm font-medium text-neutral-950 dark:text-neutral-50">
          Knowledge Graph
        </p>
        <div className="space-y-6">
          <GraphGroup title="Related Articles" items={graph.articles} />
          <GraphGroup title="Related Projects" items={graph.projects} />
        </div>
      </div>
    </aside>
  );
}
