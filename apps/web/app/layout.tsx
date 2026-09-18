import type { Metadata } from "next";

import "./globals.css";
import "../../../packages/providers/assets/fonts/presenter.css";

export const metadata: Metadata = {
  title: "SlideSpeech | Presentation Studio",
  description: "Research, shape and present a story worth listening to.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="font-sans">{children}</body>
    </html>
  );
}
