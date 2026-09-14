export interface FoundationPageProps {
  readonly title: string;
  readonly subtitle: string;
}

export function FoundationPage({ title, subtitle }: FoundationPageProps) {
  return (
    <main className="foundation-page">
      <div className="foundation-page__content">
        <h1 className="foundation-page__title">{title}</h1>
        <p className="foundation-page__subtitle">{subtitle}</p>
      </div>
    </main>
  );
}
