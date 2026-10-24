import { Construction } from 'lucide-react';
import { Card, EmptyState } from '../components/ui.jsx';

/** Placeholder for modules that are built in later steps of the plan. */
export default function ComingSoonPage({ title }) {
  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="mb-6 text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
      <Card>
        <EmptyState icon={Construction} title={`${title} is on its way`}>
          This module is being built next.
        </EmptyState>
      </Card>
    </div>
  );
}
