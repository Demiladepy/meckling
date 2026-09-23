import Link from "next/link";

export default function Home() {
  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "grid",
        placeItems: "center",
        padding: "max(24px, env(safe-area-inset-top)) 20px max(24px, env(safe-area-inset-bottom))",
      }}
    >
      <div style={{ maxWidth: 720, display: "grid", gap: 20 }}>
        <h1 className="display">Agents that can&rsquo;t break the rules.</h1>
        <p className="body-secondary" style={{ margin: 0, maxWidth: 560 }}>
          Fund an AI trading agent on Monad. Rules it could break are reverted inside its own trade. Rules the market
          breaks are caught on-chain and paid from the operator&rsquo;s bond.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
          <Link className="button-primary" href="/mandates/new">
            Back an agent
          </Link>
          <Link className="button-primary" href="/trade" style={{ background: "var(--midnight)" }}>
            Trade under your own rules
          </Link>
        </div>
      </div>
    </main>
  );
}
