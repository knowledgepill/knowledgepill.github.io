import {HOME_OG_IMAGE_URL} from "@/lib/constants";
import type {Metadata} from "next";

import Container from "@/app/_components/container";
import Header from "@/app/_components/header";

export const metadata: Metadata = {
  title: `Knowledge Pill Blog`,
  description: `Programming, technology, and software development blog.`,
  openGraph: {
    images: [HOME_OG_IMAGE_URL],
  },
};

export default function RootLayout({
                                     children,
                                   }: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <Container>
      <Header/>
      <article className="mb-32">
        {children}
      </article>
    </Container>
  );
}
