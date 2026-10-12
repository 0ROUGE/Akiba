"use client";

// Last-resort boundary for errors in the root layout itself (it must render its own <html>/<body>).
export default function GlobalError({ reset }) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: "system-ui, sans-serif",
          display: "flex",
          minHeight: "100vh",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          padding: 24,
        }}
      >
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 600 }}>Something went wrong</h1>
          <p style={{ color: "#64748b", maxWidth: 320, margin: "8px auto 16px" }}>
            Your money and balance are safe. Please try again.
          </p>
          <button
            onClick={reset}
            style={{ background: "#0b2a6f", color: "#fff", border: 0, borderRadius: 12, padding: "10px 18px", fontSize: 14 }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
