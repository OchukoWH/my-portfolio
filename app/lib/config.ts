export const metaData = {
  baseUrl: "https://www.ochukowhoro.com",
  title: "Ochuko Whoro | Kubernetes & Cloud Native Infrastructure Engineer",
  name: "Ochuko Whoro",
  ogImage: "/og/home.png",
  defaultBlogOgImage: "/og/default-blog.png",
  defaultProjectOgImage: "/og/default-project.png",
  description:
    "Kubernetes and AWS certified cloud-native infrastructure engineer building platform tools, Kubernetes infrastructure, networking, storage, virtualization, and automation using Go, Linux, Terraform, and AWS.",
  keywords: [
    "Ochuko Whoro",
    "Cloud Native Engineer",
    "Platform Engineer",
    "Infrastructure Engineer",
    "DevOps Engineer",
    "Site Reliability Engineer",
    "SRE",
    "Kubernetes Engineer",
    "Golang",
    "Go",
    "Linux",
    "Terraform",
    "AWS",
    "Kubernetes",
    "Cloud Native",
    "Infrastructure Automation",
    "Networking",
    "Storage",
    "Virtualization",
    "Observability",
    "Technical Writing",
  ],
};

export function absoluteUrl(pathOrUrl: string) {
  if (/^https?:\/\//.test(pathOrUrl)) {
    return pathOrUrl;
  }

  return new URL(pathOrUrl, metaData.baseUrl).toString();
}

export const socialLinks = {
  twitter: "",
  github: "https://github.com/ochukowhoro",
  instagram: "",
  linkedin: "https://www.linkedin.com/in/ochukowhoro",
  email: "mailto:hello@ochukowhoro.com",
};

export const contactLinks = {
  email: "hello@ochukowhoro.com",
  bookSession:
    "https://calendar.google.com/calendar/render?action=TEMPLATE&text=Platform%20engineering%20consultation%20with%20Ochuko%20Whoro&details=Consultation%20about%20Kubernetes%2C%20platform%20engineering%2C%20cloud-native%20infrastructure%2C%20or%20technical%20writing.%0A%0APlease%20add%20Google%20Meet%20conferencing%20to%20this%20event.&location=Google%20Meet&add=hello%40ochukowhoro.com",
};

export const resumeUrl = "/resume/Ochuko_Whoro_Generic.pdf";
