import type { ReactNode } from 'react';

type PageProps = {
  title: string;
  children: ReactNode;
};

export function Page({ title, children }: PageProps) {
  return (
    <main id="main" className="page stack">
      <h1>{title}</h1>
      {children}
    </main>
  );
}
