import Link from "next/link";

export default function Home() {
  return (
    <main style={{ maxWidth: 700, margin: "80px auto", padding: "0 24px", textAlign: "center" }}>
      <h1 style={{ fontSize: "2.5rem", fontWeight: 700, margin: 0 }}>Viral Clips</h1>
      <p style={{ color: "#666", fontSize: "1.1rem", marginTop: 8, lineHeight: 1.5 }}>
        Upload a video and get AI-powered highlight clips with viral potential.
      </p>
      <Link
        href="/clips"
        style={{
          display: "inline-block",
          marginTop: 24,
          padding: "12px 32px",
          background: "#f97316",
          color: "#fff",
          borderRadius: 12,
          textDecoration: "none",
          fontWeight: 600,
          fontSize: "1.1rem",
        }}
      >
        Get started
      </Link>
    </main>
  );
}
