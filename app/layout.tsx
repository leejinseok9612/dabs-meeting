import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/app/components/Toast";

const geist = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "DABs — 회의 자료 취합",
  description: "DABs 회의 자료 제출 및 관리 시스템",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko" className={`${geist.variable} h-full`}>
      <body className="min-h-full font-[family-name:var(--font-geist)] antialiased">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
