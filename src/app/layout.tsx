import type { Metadata, Viewport } from "next";
import "@fontsource/titillium-web/400.css";
import "@fontsource/titillium-web/600.css";
import "@fontsource/titillium-web/700.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "F1 Underground",
  description: "The F1 Underground fantasy league",
};

export const viewport: Viewport = { themeColor: "#15151e" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
