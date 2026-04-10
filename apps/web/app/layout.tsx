import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "SlideSpeech MVP",
  description: "Interactive AI presenter MVP with modular providers.",
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
