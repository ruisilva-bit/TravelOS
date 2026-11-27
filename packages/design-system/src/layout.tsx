import { useId } from "react";
import type { ReactNode } from "react";

export function Card({
  title,
  actions,
  soft = false,
  headingLevel = 2,
  children,
  className,
  ...rest
}: {
  readonly title?: ReactNode;
  readonly actions?: ReactNode;
  readonly soft?: boolean;
  readonly headingLevel?: 2 | 3 | 4;
  readonly children: ReactNode;
  readonly className?: string;
  readonly "aria-busy"?: boolean;
}) {
  const titleId = useId();
  const Heading = `h${String(headingLevel)}` as "h2" | "h3" | "h4";
  return (
    <section
      {...rest}
      className={`ds-card${soft ? " ds-card--soft" : ""}${className ? ` ${className}` : ""}`}
      aria-labelledby={title ? titleId : undefined}
    >
      {title || actions ? (
        <div className="ds-card__header">
          {title ? (
            <Heading className="ds-card__title" id={titleId}>
              {title}
            </Heading>
          ) : (
            <span />
          )}
          {actions}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function PageHeader({
  id,
  title,
  description,
  actions,
  status,
  back,
}: {
  /** Id of the h1, for `aria-labelledby` on the surrounding section. */
  readonly id?: string;
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly actions?: ReactNode;
  /** Usually a StatusPill, shown beside the title. */
  readonly status?: ReactNode;
  readonly back?: { readonly href: string; readonly label: string };
}) {
  return (
    <header className="ds-page-header">
      {back ? (
        <a className="ds-page-header__back" href={back.href}>
          {back.label}
        </a>
      ) : null}
      <div className="ds-page-header__row">
        <div>
          <div className="ds-page-header__title-row">
            <h1 className="ds-page-header__title" id={id}>
              {title}
            </h1>
            {status}
          </div>
          {description ? <p className="ds-page-header__description">{description}</p> : null}
        </div>
        {actions ? <div className="ds-page-header__actions">{actions}</div> : null}
      </div>
    </header>
  );
}

/** Section title inside a page: h2 with optional meta text (counts, filters) on the right. */
export function SectionHeading({
  id,
  title,
  meta,
}: {
  readonly id?: string;
  readonly title: ReactNode;
  readonly meta?: ReactNode;
}) {
  return (
    <div className="ds-section-heading">
      <h2 id={id}>{title}</h2>
      {meta ? <span className="ds-section-heading__meta">{meta}</span> : null}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  tone = "neutral",
  headingLevel = 2,
  role,
}: {
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly action?: ReactNode;
  readonly tone?: "neutral" | "error";
  readonly headingLevel?: 1 | 2 | 3;
  /** Pass "alert" for failures that must be announced immediately. */
  readonly role?: "alert" | "status";
}) {
  const Heading = `h${String(headingLevel)}` as "h1" | "h2" | "h3";
  return (
    <div className={`ds-empty${tone === "error" ? " ds-empty--error" : ""}`} role={role}>
      <Heading className="ds-empty__title">{title}</Heading>
      {description ? <p className="ds-empty__description">{description}</p> : null}
      {action ? <div className="ds-empty__action">{action}</div> : null}
    </div>
  );
}

/** Short inline message: loading text, validation/failure summaries, success confirmations. */
export function StateMessage({
  tone = "neutral",
  role,
  action,
  children,
}: {
  readonly tone?: "neutral" | "error" | "success";
  /** "alert" interrupts (failures); "status" is polite (loading, success). */
  readonly role?: "alert" | "status";
  /** Optional recovery control, e.g. a retry Button. */
  readonly action?: ReactNode;
  readonly children: ReactNode;
}) {
  const className = `ds-message ds-message--${tone}`;
  if (action === undefined) {
    return (
      <p className={className} role={role}>
        {children}
      </p>
    );
  }
  return (
    <div className={className} role={role}>
      <p className="ds-message__text">{children}</p>
      <div className="ds-message__action">{action}</div>
    </div>
  );
}
