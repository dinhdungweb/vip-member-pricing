import { Card, PageHeader, SectionHeader, StatusBadge } from "../components/ui";

export default function AdditionalPage() {
  return (
    <main className="app-page">
      <PageHeader
        eyebrow="Operations"
        title="Pre-launch review"
        description="A concise checklist to verify the experience from Shopify Admin to the storefront."
        actions={<StatusBadge tone="info">Checklist</StatusBadge>}
      />
      <div className="content-grid">
        <div className="content-main">
          <Card>
            <SectionHeader title="Program configuration" />
            <ul className="plain-list">
              <li>An active pricing plan has been selected.</li>
              <li>Tier ranks and spend thresholds increase together.</li>
              <li>The program start time is correct in UTC.</li>
            </ul>
          </Card>
          <Card>
            <SectionHeader title="Storefront checks" />
            <ul className="plain-list">
              <li>VIP pricing is correct for a customer in each tier.</li>
              <li>Product rules block ineligible signed-out customers.</li>
              <li>Vietnamese and English blocked messages are clear.</li>
            </ul>
          </Card>
        </div>
        <aside className="content-aside">
          <Card className="card--accent">
            <SectionHeader
              title="Final step"
              description="After successful testing, return to Program and activate."
            />
            <a
              className="button button--primary button--full"
              href="/app/program"
            >
              Go to activation
            </a>
          </Card>
        </aside>
      </div>
    </main>
  );
}
