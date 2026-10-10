import { ImageResponse } from "next/og";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
// Read out by link previews and screen readers; the card itself is only the mark and the name.
export const alt = "Situs — Sovereign Capital System";

/**
 * Situs OG card — PT-palette Portal mark on the brand canvas, rectilinear,
 * no gradients (only flat fills; the Bauhaus language survives rasterization).
 */
export default function OgImage() {
  return new ImageResponse(
    <div
      style={{
        background: "#f6f0e4",
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        padding: "72px 80px",
        fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
        position: "relative",
        overflow: "hidden",
        border: "1px solid #ddd3c3",
      }}
    >
      {/* Brand lockup */}
      <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 76,
            height: 76,
            background: "#f1e8d8",
            border: "1px solid #ddd3c3",
          }}
        >
          <svg width="52" height="52" viewBox="0 0 100 100" fill="none">
            <circle
              cx="50"
              cy="50"
              r="44"
              fill="#006600"
              stroke="rgba(0,0,0,0.48)"
              strokeWidth="1.25"
              strokeDasharray="3 3"
              opacity="0.35"
            />
            <path
              d="M20 50 C20 33.4 33.4 20 50 20 C66.6 20 80 33.4 80 50"
              stroke="rgba(0,0,0,0.48)"
              strokeWidth="15"
              strokeLinecap="round"
            />
            <path
              d="M20 50 C20 33.4 33.4 20 50 20 C66.6 20 80 33.4 80 50"
              stroke="#006600"
              strokeWidth="12"
              strokeLinecap="round"
            />
            <path d="M20 72 H80" stroke="rgba(0,0,0,0.48)" strokeWidth="11" strokeLinecap="round" />
            <path d="M20 72 H80" stroke="#FF0000" strokeWidth="8" strokeLinecap="round" />
            <circle
              cx="50"
              cy="50"
              r="12"
              fill="#FFFF00"
              stroke="rgba(0,0,0,0.48)"
              strokeWidth="1.25"
            />
          </svg>
        </div>
        <span
          style={{
            color: "#221d16",
            fontSize: 28,
            fontWeight: 500,
            letterSpacing: 8,
          }}
        >
          SITUS
        </span>
      </div>

      {/* Hero tagline */}
      <div
        style={{
          marginTop: "auto",
          display: "flex",
          flexDirection: "column",
          color: "#221d16",
          fontSize: 64,
          fontWeight: 400,
          lineHeight: 1.02,
          letterSpacing: -3,
          maxWidth: 980,
        }}
      >
        <span>Property income, receipts</span>
        <span>and tax evidence under control.</span>
      </div>

      {/* Descriptor */}
      <div
        style={{
          marginTop: 28,
          color: "#756e63",
          fontSize: 22,
          lineHeight: 1.5,
        }}
      >
        Situs // Sovereign Capital System
      </div>

      {/* Feature chips — flat, square, mono voice */}
      <div style={{ display: "flex", gap: 12, marginTop: 40 }}>
        {[
          "Bank movement matching",
          "Receipt automation",
          "Document intelligence",
          "Tax connector ready",
        ].map((label) => (
          <div
            key={label}
            style={{
              padding: "9px 16px",
              border: "1px solid #ddd3c3",
              background: "rgba(0,0,0,0.025)",
              color: "#756e63",
              fontSize: 15,
              textTransform: "uppercase",
              letterSpacing: 1,
            }}
          >
            {label}
          </div>
        ))}
      </div>
    </div>,
    { width: 1200, height: 630 },
  );
}
