import { ImageResponse } from "next/og";

export const runtime = "edge";

export function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          alignItems: "center",
          background: "#0b1220",
          color: "#f8fafc",
          display: "flex",
          flexDirection: "column",
          fontFamily: "Arial, Helvetica, sans-serif",
          height: "100%",
          justifyContent: "center",
          padding: "72px",
          width: "100%",
        }}
      >
        <div
          style={{
            color: "#67e8f9",
            fontSize: 50,
            fontWeight: 800,
            letterSpacing: 0,
            marginBottom: 34,
            textAlign: "center",
          }}
        >
          Cloud Native Infrastructure
        </div>
        <div
          style={{
            alignItems: "center",
            color: "#f8fafc",
            display: "flex",
            flexWrap: "wrap",
            fontSize: 62,
            fontWeight: 800,
            gap: "24px 30px",
            justifyContent: "center",
            letterSpacing: 0,
            lineHeight: 1.12,
            textAlign: "center",
            width: "100%",
          }}
        >
          <span>Kubernetes</span>
          <span style={{ color: "#e2e8f0" }}>Linux</span>
          <span style={{ color: "#22c55e" }}>Go</span>
          <span style={{ color: "#f59e0b" }}>Containers</span>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
    }
  );
}
