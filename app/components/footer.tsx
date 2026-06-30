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
    <div className="flex flex-wrap items-center gap-3.5 transition-opacity duration-300 hover:opacity-90">
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
    <footer className="lg:mt-24 mt-16 text-sm text-[#1C1C1C] dark:text-[#D4D4D4]">
      <div className="mx-auto flex w-full max-w-[760px] flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <small>
          <time>© {YEAR}</time>{" "}
          <a className="no-underline" href="/">
            {metaData.title}
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
