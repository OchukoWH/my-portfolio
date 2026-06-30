import Link from "next/link";

export function AuthorCard() {
  return (
    <section className="mt-12 rounded-md border border-neutral-200 p-5 dark:border-neutral-800">
      <p className="text-sm font-medium text-neutral-950 dark:text-neutral-50">
        Written by{" "}
        <Link href="/" className="underline underline-offset-4">
          Ochuko Whoro
        </Link>
      </p>
      <p className="mt-2 text-sm leading-6 text-neutral-600 dark:text-neutral-400">
        Ochuko is a cloud-native and platform engineering practitioner focused
        on Kubernetes, Linux, Go, AWS, Terraform, and technical writing for
        engineering teams.
      </p>
    </section>
  );
}
