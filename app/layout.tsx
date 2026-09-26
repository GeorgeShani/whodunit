import type { Metadata } from "next";
import { Bangers, Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const bangers = Bangers({
  variable: "--font-bangers",
  weight: "400",
  subsets: ["latin"],
});

const description = "A perfectly normal dinner party. Until somebody got murdered.";

// Share images and icons come from the app/ file conventions (opengraph-image.jpg,
// twitter-image.jpg, favicon.ico, icon.png, apple-icon.png); don't add icons/images here.
export const metadata: Metadata = {
  title: "WHODUNIT?!",
  description,
  openGraph: { title: "WHODUNIT?!", description, type: "website", siteName: "WHODUNIT?!" },
  twitter: { card: "summary_large_image", title: "WHODUNIT?!", description },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${bangers.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
