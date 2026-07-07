import "./globals.css";
import type { Metadata } from "next";
import { Navbar } from "./components/nav";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { Spectral } from "next/font/google";
import Footer from "./components/footer";
import { ThemeProvider } from "./components/theme-switch";
import { absoluteUrl, metaData } from "./lib/config";

const spectral = Spectral({
  subsets: ["latin"],
  weight: ["400"],
  variable: "--font-spectral",
});

export const metadata: Metadata = {
  metadataBase: new URL(metaData.baseUrl),
  title: {
    default: metaData.title,
    template: `%s | ${metaData.title}`,
  },
  description: metaData.description,
  keywords: metaData.keywords,
  alternates: {
    canonical: metaData.baseUrl,
  },
  openGraph: {
    images: [
      {
        url: absoluteUrl(metaData.ogImage),
        width: 1200,
        height: 630,
        alt: `${metaData.title} social preview`,
      },
    ],
    title: metaData.title,
    description: metaData.description,
    url: metaData.baseUrl,
    siteName: metaData.name,
    locale: "en_US",
    type: "website",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  twitter: {
    title: metaData.title,
    description: metaData.description,
    card: "summary_large_image",
    images: [absoluteUrl(metaData.ogImage)],
  },
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon.ico" },
    ],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link
          rel="alternate"
          type="application/rss+xml"
          href="/rss.xml"
          title="RSS Feed"
        />
        <link
          rel="alternate"
          type="application/atom+xml"
          href="/atom.xml"
          title="Atom Feed"
        />
        <link
          rel="alternate"
          type="application/feed+json"
          href="/feed.json"
          title="JSON Feed"
        />
      </head>
      <body
        className={`${spectral.variable} antialiased mx-auto flex flex-col items-center justify-center pb-24`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <main className="mt-0 flex w-full max-w-[768px] flex-auto flex-col px-6 sm:px-4 md:mt-3 md:px-0">
            <script
              type="application/ld+json"
              suppressHydrationWarning
              dangerouslySetInnerHTML={{
                __html: JSON.stringify({
                  "@context": "https://schema.org",
                  "@type": "Person",
                  name: metaData.name,
                  jobTitle: "Cloud Native Infrastructure Engineer",
                  email: "hello@ochukowhoro.com",
                  url: metaData.baseUrl,
                  knowsAbout: [
                    "Kubernetes",
                    "Go",
                    "Linux",
                    "AWS",
                    "Terraform",
                    "Platform Engineering",
                    "Infrastructure Engineering",
                    "DevOps",
                    "Site Reliability Engineering",
                    "Cloud Native",
                    "Networking",
                    "Storage",
                    "Virtualization",
                    "Infrastructure Automation",
                    "Observability",
                    "Technical Writing",
                  ],
                }),
              }}
            />
            <Navbar />
            {children}
            <Footer />
            <Analytics />
            <SpeedInsights />
          </main>
        </ThemeProvider>
      </body>
    </html>
  );
}
