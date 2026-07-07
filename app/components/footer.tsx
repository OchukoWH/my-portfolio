"use client";

import React from "react";
import {
  FaXTwitter,
  FaGithub,
  FaInstagram,
  FaRss,
  FaLinkedinIn,
} from "react-icons/fa6";
import { TbMailFilled } from "react-icons/tb";
import { metaData, socialLinks } from "app/lib/config";

const YEAR = new Date().getFullYear();

function SocialLink({ href, icon: Icon }) {
  if (!href) {
    return null;
  }

  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      <Icon />
    </a>
  );
}

function SocialLinks() {
  return (
    <div className="flex flex-col items-start gap-2.5 transition-opacity duration-300 hover:opacity-90 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3.5">
      <SocialLink href={socialLinks.twitter} icon={FaXTwitter} />
      <SocialLink href={socialLinks.instagram} icon={FaInstagram} />
      <a className="inline-flex items-center gap-1" href={socialLinks.email}>
        <TbMailFilled />
        Email
      </a>
      <a
        className="inline-flex items-center gap-1"
        href={socialLinks.linkedin}
        target="_blank"
        rel="noopener noreferrer"
      >
        <FaLinkedinIn />
        LinkedIn
      </a>
      <a
        className="inline-flex items-center gap-1"
        href={socialLinks.github}
        target="_blank"
        rel="noopener noreferrer"
      >
        <FaGithub />
        GitHub
      </a>
    </div>
  );
}

export default function Footer() {
  return (
    <footer className="fixed inset-x-0 bottom-0 z-50 bg-white/95 px-6 py-4 text-sm text-[#1C1C1C] backdrop-blur dark:bg-neutral-950/95 dark:text-[#D4D4D4] sm:px-4 md:px-0">
      <div className="mx-auto flex w-full max-w-[768px] flex-col gap-4 border-t border-neutral-200/60 pt-4 dark:border-neutral-800/60 sm:flex-row sm:items-center sm:justify-between">
        <small>
          <time>© {YEAR}</time>{" "}
          <a className="no-underline" href="/">
            {metaData.name}
          </a>
        </small>
        <SocialLinks />
      </div>
      <style jsx>{`
        @media screen and (max-width: 480px) {
          article {
            padding-top: 2rem;
            padding-bottom: 4rem;
          }
        }
      `}</style>
    </footer>
  );
}
