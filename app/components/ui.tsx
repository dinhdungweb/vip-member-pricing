import type { ReactNode } from "react";

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div className="page-header__copy">
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions && <div className="page-header__actions">{actions}</div>}
    </header>
  );
}

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <section className={`card ${className}`.trim()}>{children}</section>;
}

export function SectionHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="section-header">
      <div>
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {action && <div className="section-header__action">{action}</div>}
    </div>
  );
}

export function Alert({
  tone,
  children,
}: {
  tone: "success" | "danger" | "info" | "warning";
  children: ReactNode;
}) {
  return (
    <div className={`alert alert--${tone}`} role="status">
      <span className="alert__dot" aria-hidden="true" />
      <div>{children}</div>
    </div>
  );
}

export function StatusBadge({
  tone,
  children,
}: {
  tone: "success" | "neutral" | "warning" | "danger" | "info";
  children: ReactNode;
}) {
  return <span className={`status status--${tone}`}>{children}</span>;
}

export function Metric({
  label,
  value,
  help,
}: {
  label: string;
  value: ReactNode;
  help?: string;
}) {
  return (
    <div className="metric">
      <div className="metric__label">{label}</div>
      <div className="metric__value">{value}</div>
      {help && <div className="metric__help">{help}</div>}
    </div>
  );
}

export function FlowSteps({
  steps,
}: {
  steps: Array<{
    label: string;
    description: string;
    state: "done" | "current" | "next";
    href: string;
  }>;
}) {
  return (
    <ol className="flow-steps">
      {steps.map((step, index) => (
        <li className={`flow-step flow-step--${step.state}`} key={step.label}>
          <a href={step.href}>
            <span className="flow-step__number">
              {step.state === "done" ? "✓" : index + 1}
            </span>
            <span>
              <strong>{step.label}</strong>
              <small>{step.description}</small>
            </span>
          </a>
        </li>
      ))}
    </ol>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-state__icon" aria-hidden="true">
        +
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
