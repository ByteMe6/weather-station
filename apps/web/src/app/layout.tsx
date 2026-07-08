import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Weather Station",
  description: "Hyperlocal weather monitoring",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
