import type { Metadata } from "next";
import Image from "next/image";

const certifications = [
  {
    name: "Certified Kubernetes Administrator",
    shortName: "CKA",
    status: "Earned",
    issuedOn: "June 24, 2026",
    credentialUrl:
      "https://www.credly.com/badges/d2cbc70b-40ac-411c-9d3c-5cce83f059df/public_url",
    certificateUrl:
      "https://ti-user-certificates.s3.amazonaws.com/e0df7fbf-a057-42af-8a1f-590912be5460/3766f965-ef92-406e-9b85-40d52f7aa8ec-ochuko-whoro-d76fbc49-22bb-4da6-804d-c452030d05a4-certificate.pdf",
    previewImage: "/certs/cka.png",
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
];

export const metadata: Metadata = {
  title: "Certifications",
  description:
    "Cloud and Kubernetes certifications earned by Ochuko Whoro, including Certified Kubernetes Administrator.",
};

export default function Certifications() {
  return (
    <section className="mx-auto w-full max-w-[768px] space-y-8">
      <div className="space-y-3">
        <h1 className="text-3xl font-semibold">Certifications</h1>
        <p className="text-neutral-600 dark:text-neutral-400">
          Cloud and Kubernetes credentials supporting Ochuko Whoro's work in
          cloud-native infrastructure, platform engineering, and production
          Kubernetes systems.
        </p>
      </div>

      <div className="space-y-4">
        {certifications.map((certification) => (
          <article
            key={certification.shortName}
            className="rounded-md border border-neutral-200 p-5 dark:border-neutral-800"
          >
            <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_320px] md:items-start">
              <div className="space-y-4">
                <div>
                  <div>
                    <h2 className="font-medium">{certification.shortName}</h2>
                    <p className="text-sm text-neutral-600 dark:text-neutral-400">
                      {certification.name}
                    </p>
                  </div>
                </div>

                {certification.issuedOn ? (
                  <dl className="grid gap-1 text-sm">
                    <dt className="text-neutral-500 dark:text-neutral-400">
                      Issued on
                    </dt>
                    <dd className="font-medium">{certification.issuedOn}</dd>
                  </dl>
                ) : null}

                <div className="flex flex-wrap gap-3 text-sm">
                  {certification.credentialUrl ? (
                    <a
                      className="rounded-md border border-neutral-300 px-3 py-1.5 font-medium dark:border-neutral-700"
                      href={certification.credentialUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View Credly
                    </a>
                  ) : null}
                  {certification.certificateUrl ? (
                    <a
                      className="rounded-md border border-neutral-300 px-3 py-1.5 font-medium dark:border-neutral-700"
                      href={certification.certificateUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View Certificate
                    </a>
                  ) : null}
                </div>

                <span className="inline-flex w-fit rounded-md bg-neutral-100 px-2 py-1 text-xs text-neutral-700 dark:bg-neutral-900 dark:text-neutral-300">
                  {certification.status}
                </span>
              </div>

              {certification.previewImage ? (
                <a
                  className="group block overflow-hidden rounded-md border border-neutral-200 bg-neutral-50 transition-colors hover:border-neutral-300 dark:border-neutral-800 dark:bg-neutral-950 dark:hover:border-neutral-700"
                  href={certification.previewImage}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`View ${certification.shortName} certificate preview`}
                >
                  <Image
                    src={certification.previewImage}
                    alt={`${certification.name} certificate preview`}
                    width={1098}
                    height={851}
                    loading="eager"
                    className="h-auto w-full transition-transform duration-200 group-hover:scale-[1.015]"
                    sizes="(min-width: 768px) 320px, 100vw"
                  />
                </a>
              ) : null}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
