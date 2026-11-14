import type { ReactNode } from 'react';

type PageProps = {
  title: string;
  leading?: ReactNode;
  children: ReactNode;
};

export function Page({ title, leading, children }: PageProps) {
  return (
    <main id="main" className="page stack">
      {leading}
      <h1>{title}</h1>
      {children}
    </main>
  );
}
