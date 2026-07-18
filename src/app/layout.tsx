import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Viral Clips — AI highlight extractor",
  description: "Upload a video and get AI-powered highlight clips with viral potential.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, -apple-system, sans-serif", background: "#f5f5f5", color: "#111" }}>
        {children}
      </body>
    </html>
  );
}
