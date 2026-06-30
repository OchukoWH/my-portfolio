import type { Metadata } from "next";

const certifications = [
  {
    name: "Certified Kubernetes Administrator",
    shortName: "CKA",
    status: "In progress",
  },
  {
    name: "Certified Kubernetes Security Specialist",
    shortName: "CKS",
    status: "In progress",
  },
  {
    name: "AWS Certified Solutions Architect",
    shortName: "AWS SAA",
    status: "In progress",
  },
  {
    name: "AWS Certified SysOps Administrator",
    shortName: "AWS SysOps",
    status: "In progress",
  },
];

export const metadata: Metadata = {
  title: "Certifications",
  description: "Cloud and Kubernetes certification track for Ochuko Whoro.",
};

export default function Certifications() {
  return (
    <section className="mx-auto w-full max-w-[720px] space-y-8">
      <div className="space-y-3">
        <h1 className="text-3xl font-semibold">Certifications</h1>
        <p className="text-neutral-600 dark:text-neutral-400">
          Current certification track across Kubernetes administration,
          Kubernetes security, and AWS operations.
        </p>
      </div>

      <div className="space-y-4">
        {certifications.map((certification) => (
          <article
            key={certification.shortName}
            className="rounded-md border border-neutral-200 p-5 dark:border-neutral-800"
          >
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="font-medium">{certification.shortName}</h2>
                <p className="text-sm text-neutral-600 dark:text-neutral-400">
                  {certification.name}
                </p>
              </div>
              <span className="w-fit rounded-md bg-neutral-100 px-2 py-1 text-xs text-neutral-700 dark:bg-neutral-900 dark:text-neutral-300">
                {certification.status}
              </span>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
