import Footer from "@/app/_components/footer";
import type {Metadata} from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: `Knowledge Pill Blog`,
  description: `Programming, technology, and software development blog.`,
};

export default function RootLayout({
                                     children,
                                   }: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
    <body>
    <main>
      {children}
    </main>
    <footer className="bg-neutral-50 border-t border-neutral-200 dark:bg-slate-800">
      <Footer/>
    </footer>
    </body>
    </html>
  );
}
